//! Task reports.
//!
//! Everything here is derived from rows the app already stores: `tasks` for
//! creation, completion and priority, `task_lanes` for the board columns, and
//! `focus_sessions` for the time actually spent. Nothing is aggregated at write
//! time, so a report always reflects the current database.
//!
//! Two different windows live side by side on purpose:
//! - `created` / `completed` / `days` count what happened *inside* the range.
//! - `open` / `overdue` describe the state *right now*, because "how much is
//!   still on my plate" has no meaning inside a past window.

use crate::db::AppDb;
use crate::error::CommandError;
use chrono::{DateTime, Duration, Local, NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

const DEFAULT_DAYS: i64 = 30;
const MAX_DAYS: i64 = 366;
/// A task counts as "stuck" once it has been open this long, or this far past
/// its due date. Both thresholds are deliberately generous: the point is to
/// surface what has quietly rotted, not to nag about this week's work.
const STUCK_AGE_DAYS: i64 = 21;
const STUCK_OVERDUE_DAYS: i64 = 3;
const MAX_STUCK: usize = 50;
const MAX_ACTIVITY: usize = 100;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportDay {
    pub date: String,
    pub created: i64,
    pub completed: i64,
    pub focus_seconds: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportTotals {
    pub created: i64,
    pub completed: i64,
    pub open: i64,
    pub overdue: i64,
    pub archived: i64,
    /// Completed ÷ (completed + open) in the range, 0..1.
    pub completion_rate: f64,
    pub average_close_days: Option<f64>,
    pub median_close_days: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportQuadrant {
    pub priority: String,
    pub open: i64,
    pub completed: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportLane {
    pub id: String,
    pub name: String,
    pub open: i64,
    pub completed: i64,
}

/// One project's share of the range. `open` and `overdue` describe the state
/// right now, the same way the totals do.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportProject {
    pub id: String,
    pub name: String,
    pub open: i64,
    pub completed: i64,
    pub overdue: i64,
    pub completion_rate: f64,
    pub average_close_days: Option<f64>,
}

/// An open task that has been sitting too long or is well past its due date.
/// This is the actionable part of the report: the numbers above say how much
/// moved, this says what to pick up next.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportStuckTask {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub project_name: Option<String>,
    /// Only used to resolve `project_name` after the scan.
    #[serde(skip)]
    pub project_id: Option<String>,
    pub due_date: Option<String>,
    pub age_days: i64,
    pub overdue_days: Option<i64>,
}

/// Attendance and agenda follow-through for one meeting inside the range.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportMeeting {
    pub id: String,
    pub title: String,
    pub starts_at: String,
    pub status: String,
    pub attendees: i64,
    pub present: i64,
    pub late: i64,
    pub absent: i64,
    pub excused: i64,
    pub unknown: i64,
    pub late_minutes: i64,
    pub agenda_items: i64,
    pub agenda_tasks: i64,
    pub agenda_done: i64,
}

/// One row of the task timeline (`task_events`), newest first.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportActivity {
    pub id: String,
    pub at: String,
    pub task_id: String,
    pub task_title: String,
    pub kind: String,
    pub detail: Option<String>,
}

/// The same window shifted back by its own length, for "better or worse than
/// last month" comparisons. Open/overdue are deliberately absent: they describe
/// the present, so they cannot have a past value.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportComparison {
    pub created: i64,
    pub completed: i64,
    pub archived: i64,
    pub average_close_days: Option<f64>,
}

#[derive(Default)]
struct ProjectAccumulator {
    open: i64,
    completed: i64,
    overdue: i64,
    close_days: Vec<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReport {
    pub days: Vec<ReportDay>,
    pub totals: ReportTotals,
    pub quadrants: Vec<ReportQuadrant>,
    pub lanes: Vec<ReportLane>,
    pub projects: Vec<ReportProject>,
    pub stuck: Vec<ReportStuckTask>,
    pub meetings: Vec<ReportMeeting>,
    pub activity: Vec<ReportActivity>,
    pub previous: ReportComparison,
    pub generated_at: String,
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

// Stored instants are UTC; every bucket is a local calendar day, so a task
// finished at 01:00 Tehran time lands on the day the user saw, not the UTC one.
fn local_date(value: &str) -> Option<NaiveDate> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|instant| instant.with_timezone(&Local).date_naive())
}

fn iso(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

fn median(mut values: Vec<f64>) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let middle = values.len() / 2;
    Some(if values.len() % 2 == 0 {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    })
}

/// Counts the comparison numbers for one window. The previous period only needs
/// these four values, so it skips the buckets, quadrants and lanes the current
/// window builds.
fn window_comparison(
    connection: &Connection,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<ReportComparison, CommandError> {
    let in_range = |date: NaiveDate| date >= from && date <= to;
    let mut created = 0;
    let mut completed = 0;
    let mut archived = 0;
    let mut close_days: Vec<f64> = Vec::new();

    let mut statement = connection
        .prepare("SELECT created_at,completed_at,archived_at FROM tasks")
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;

    for (created_at, completed_at, archived_at) in rows {
        let created_on = local_date(&created_at);
        if created_on.map(in_range).unwrap_or(false) {
            created += 1;
        }
        if let Some(date) = completed_at.as_deref().and_then(local_date).filter(|date| in_range(*date)) {
            completed += 1;
            if let Some(start) = created_on {
                let span = (date - start).num_days() as f64;
                if span >= 0.0 {
                    close_days.push(span);
                }
            }
        }
        if archived_at.as_deref().and_then(local_date).map(in_range).unwrap_or(false) {
            archived += 1;
        }
    }

    Ok(ReportComparison {
        created,
        completed,
        archived,
        average_close_days: if close_days.is_empty() {
            None
        } else {
            Some(close_days.iter().sum::<f64>() / close_days.len() as f64)
        },
    })
}

pub fn build(connection: &Connection, days: i64) -> Result<TaskReport, CommandError> {
    let days = days.clamp(1, MAX_DAYS);
    let today = Local::now().date_naive();
    let from = today - Duration::days(days - 1);
    let in_range = |date: NaiveDate| date >= from && date <= today;

    let mut buckets: HashMap<NaiveDate, ReportDay> = HashMap::new();
    let mut cursor = from;
    while cursor <= today {
        buckets.insert(
            cursor,
            ReportDay { date: iso(cursor), created: 0, completed: 0, focus_seconds: 0 },
        );
        cursor += Duration::days(1);
    }

    let mut totals = ReportTotals {
        created: 0,
        completed: 0,
        open: 0,
        overdue: 0,
        archived: 0,
        completion_rate: 0.0,
        average_close_days: None,
        median_close_days: None,
    };
    let mut close_days: Vec<f64> = Vec::new();
    let mut quadrants: HashMap<String, ReportQuadrant> = HashMap::new();
    let mut lanes: HashMap<String, ReportLane> = HashMap::new();
    let mut projects: HashMap<String, ProjectAccumulator> = HashMap::new();
    let mut stuck: Vec<ReportStuckTask> = Vec::new();

    let mut statement = connection
        .prepare(
            "SELECT id,title,status,priority,due_date,completed,completed_at,created_at,
                    archived_at,lane_id,project_id
             FROM tasks",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)? == 1,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
            ))
        })
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;

    for (id, title, status, priority, due_date, completed, completed_at, created_at, archived_at, lane_id, project_id) in rows {
        let created_on = local_date(&created_at);
        let completed_on = completed_at.as_deref().and_then(local_date);
        let archived_on = archived_at.as_deref().and_then(local_date);
        let archived = archived_at.is_some();

        if let Some(date) = created_on {
            if in_range(date) {
                totals.created += 1;
                if let Some(bucket) = buckets.get_mut(&date) {
                    bucket.created += 1;
                }
            }
        }
        if let Some(date) = completed_on {
            if in_range(date) {
                totals.completed += 1;
                if let Some(bucket) = buckets.get_mut(&date) {
                    bucket.completed += 1;
                }
                if let Some(start) = created_on {
                    let span = (date - start).num_days() as f64;
                    if span >= 0.0 {
                        close_days.push(span);
                    }
                }
            }
        }
        if let Some(date) = archived_on {
            if in_range(date) {
                totals.archived += 1;
            }
        }

        let open = !completed && !archived;
        let overdue_days = if open {
            due_date
                .as_deref()
                .and_then(|value| value.parse::<NaiveDate>().ok())
                .filter(|due| *due < today)
                .map(|due| (today - due).num_days())
        } else {
            None
        };
        if open {
            totals.open += 1;
            if overdue_days.is_some() {
                totals.overdue += 1;
            }
            // Stuck is independent of the range: a task rotting since last
            // winter is exactly the thing a 7-day window would hide.
            let age_days = created_on.map(|date| (today - date).num_days()).unwrap_or(0);
            if overdue_days.map(|days| days >= STUCK_OVERDUE_DAYS).unwrap_or(false)
                || age_days >= STUCK_AGE_DAYS
            {
                stuck.push(ReportStuckTask {
                    id: id.clone(),
                    title: title.clone(),
                    status: status.clone(),
                    priority: priority.clone(),
                    project_name: None,
                    project_id: project_id.clone(),
                    due_date: due_date.clone(),
                    age_days,
                    overdue_days,
                });
            }
        }

        // The quadrant and lane tables describe the range too: a task created
        // before it and closed inside it counts as completed, not as created.
        let created_in_range = created_on.map(in_range).unwrap_or(false);
        let completed_in_range = completed_on.map(in_range).unwrap_or(false);
        if !created_in_range && !completed_in_range && !(open && created_on.is_some()) {
            continue;
        }
        if let Some(project_id) = project_id.as_deref() {
            let project = projects.entry(project_id.to_owned()).or_default();
            if open {
                project.open += 1;
                if overdue_days.is_some() {
                    project.overdue += 1;
                }
            }
            if completed_in_range {
                project.completed += 1;
                if let (Some(start), Some(date)) = (created_on, completed_on) {
                    let span = (date - start).num_days() as f64;
                    if span >= 0.0 {
                        project.close_days.push(span);
                    }
                }
            }
        }
        let quadrant = quadrants.entry(priority.clone()).or_insert_with(|| ReportQuadrant {
            priority: priority.clone(),
            open: 0,
            completed: 0,
        });
        if open {
            quadrant.open += 1;
        }
        if completed_in_range {
            quadrant.completed += 1;
        }
        if let Some(lane_id) = lane_id.as_deref() {
            let lane = lanes.entry(lane_id.to_owned()).or_insert_with(|| ReportLane {
                id: lane_id.to_owned(),
                name: String::new(),
                open: 0,
                completed: 0,
            });
            if open {
                lane.open += 1;
            }
            if completed_in_range {
                lane.completed += 1;
            }
        }
    }

    let closed_total = totals.completed + totals.open;
    totals.completion_rate = if closed_total == 0 {
        0.0
    } else {
        totals.completed as f64 / closed_total as f64
    };
    totals.average_close_days = if close_days.is_empty() {
        None
    } else {
        Some(close_days.iter().sum::<f64>() / close_days.len() as f64)
    };
    totals.median_close_days = median(close_days);

    let mut lane_rows = connection
        .prepare("SELECT id,name FROM task_lanes ORDER BY position,id")
        .map_err(CommandError::database)?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    lane_rows.sort_by_key(|(id, _)| {
        lanes.get(id).map(|lane| -(lane.open + lane.completed)).unwrap_or(0)
    });
    let lane_report = lane_rows
        .into_iter()
        .filter_map(|(id, name)| lanes.remove(&id).map(|lane| ReportLane { name, ..lane }))
        .collect();

    let project_names: HashMap<String, String> = connection
        .prepare("SELECT id,name FROM projects")
        .map_err(CommandError::database)?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?
        .into_iter()
        .collect();

    let mut project_report: Vec<ReportProject> = projects
        .into_iter()
        .map(|(id, accum)| {
            let total = accum.open + accum.completed;
            ReportProject {
                name: project_names.get(&id).cloned().unwrap_or_else(|| id.clone()),
                id,
                open: accum.open,
                completed: accum.completed,
                overdue: accum.overdue,
                completion_rate: if total == 0 { 0.0 } else { accum.completed as f64 / total as f64 },
                average_close_days: if accum.close_days.is_empty() {
                    None
                } else {
                    Some(accum.close_days.iter().sum::<f64>() / accum.close_days.len() as f64)
                },
            }
        })
        .collect();
    project_report.sort_by(|a, b| {
        (b.open + b.completed)
            .cmp(&(a.open + a.completed))
            .then_with(|| a.name.cmp(&b.name))
    });

    stuck.sort_by(|a, b| {
        b.overdue_days
            .unwrap_or(-1)
            .cmp(&a.overdue_days.unwrap_or(-1))
            .then_with(|| b.age_days.cmp(&a.age_days))
    });
    stuck.truncate(MAX_STUCK);
    for task in &mut stuck {
        task.project_name = task
            .project_id
            .as_deref()
            .and_then(|id| project_names.get(id))
            .cloned();
    }

    let mut meeting_statement = connection
        .prepare(
            "SELECT id,title,starts_at,status FROM meetings
             WHERE substr(starts_at,1,10) >= ?1 AND substr(starts_at,1,10) <= ?2
             ORDER BY starts_at",
        )
        .map_err(CommandError::database)?;
    let meeting_rows = meeting_statement
        .query_map(params![iso(from), iso(today)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;

    let mut meetings: Vec<ReportMeeting> = Vec::with_capacity(meeting_rows.len());
    for (id, title, starts_at, status) in meeting_rows {
        let (attendees, present, late, absent, excused, unknown, late_minutes) = connection
            .query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN attendance='present' THEN 1 ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN attendance='late' THEN 1 ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN attendance='absent' THEN 1 ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN attendance='excused' THEN 1 ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN attendance='unknown' THEN 1 ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN attendance='late' THEN late_minutes ELSE 0 END),0)
                 FROM meeting_attendees WHERE meeting_id = ?1",
                params![id.as_str()],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                    ))
                },
            )
            .map_err(CommandError::database)?;
        let (agenda_items, agenda_tasks, agenda_done) = connection
            .query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN task_id IS NOT NULL THEN 1 ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN task_id IS NOT NULL
                                          AND EXISTS(SELECT 1 FROM tasks t
                                                     WHERE t.id = meeting_items.task_id AND t.completed = 1)
                                     THEN 1 ELSE 0 END),0)
                 FROM meeting_items WHERE meeting_id = ?1",
                params![id.as_str()],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
            )
            .map_err(CommandError::database)?;
        meetings.push(ReportMeeting {
            id,
            title,
            starts_at,
            status,
            attendees,
            present,
            late,
            absent,
            excused,
            unknown,
            late_minutes,
            agenda_items,
            agenda_tasks,
            agenda_done,
        });
    }

    let mut activity_statement = connection
        .prepare(
            "SELECT e.id,e.at,e.task_id,COALESCE(t.title,''),e.kind,e.detail
             FROM task_events e LEFT JOIN tasks t ON t.id = e.task_id
             ORDER BY e.at DESC",
        )
        .map_err(CommandError::database)?;
    let activity_rows = activity_statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    let mut activity: Vec<ReportActivity> = Vec::new();
    for (id, at, task_id, task_title, kind, detail) in activity_rows {
        if activity.len() >= MAX_ACTIVITY {
            break;
        }
        if !local_date(&at).map(in_range).unwrap_or(false) {
            continue;
        }
        activity.push(ReportActivity { id, at, task_id, task_title, kind, detail });
    }

    let previous = window_comparison(
        connection,
        from - Duration::days(days),
        from - Duration::days(1),
    )?;

    let mut focus_statement = connection
        .prepare("SELECT ended_at,focused_seconds FROM focus_sessions")
        .map_err(CommandError::database)?;
    let focus_rows = focus_statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    for (ended_at, seconds) in focus_rows {
        if let Some(date) = local_date(&ended_at) {
            if let Some(bucket) = buckets.get_mut(&date) {
                bucket.focus_seconds += seconds;
            }
        }
    }

    let mut day_list: Vec<ReportDay> = buckets.into_values().collect();
    day_list.sort_by(|a, b| a.date.cmp(&b.date));

    let mut quadrant_list: Vec<ReportQuadrant> = quadrants.into_values().collect();
    quadrant_list.sort_by(|a, b| a.priority.cmp(&b.priority));

    Ok(TaskReport {
        days: day_list,
        totals,
        quadrants: quadrant_list,
        lanes: lane_report,
        projects: project_report,
        stuck,
        meetings,
        activity,
        previous,
        generated_at: timestamp(),
    })
}

#[tauri::command]
pub fn get_task_report(db: State<'_, AppDb>, days: Option<i64>) -> Result<TaskReport, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    build(&connection, days.unwrap_or(DEFAULT_DAYS))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportExportSummary {
    pub path: String,
    pub format: String,
}

fn csv_cell(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

fn csv_line(cells: &[String]) -> String {
    let mut line = cells.iter().map(|cell| csv_cell(cell)).collect::<Vec<_>>().join(",");
    line.push_str("\r\n");
    line
}

fn percent(value: f64) -> String {
    format!("{:.0}%", value * 100.0)
}

fn days_cell(value: Option<f64>) -> String {
    value.map(|days| format!("{days:.1}")).unwrap_or_default()
}

fn report_csv(report: &TaskReport, days: i64) -> String {
    let mut out = String::from("\u{feff}");
    out.push_str(&csv_line(&["بخش".into(), "شاخص".into(), "مقدار".into()]));
    for (label, value) in [
        ("بازه (روز)", days.to_string()),
        ("ایجادشده", report.totals.created.to_string()),
        ("انجام‌شده", report.totals.completed.to_string()),
        ("باز", report.totals.open.to_string()),
        ("عقب‌افتاده", report.totals.overdue.to_string()),
        ("بایگانی‌شده", report.totals.archived.to_string()),
        ("نرخ تکمیل", percent(report.totals.completion_rate)),
        ("میانگین زمان بستن (روز)", days_cell(report.totals.average_close_days)),
        ("میانه زمان بستن (روز)", days_cell(report.totals.median_close_days)),
        ("دوره قبل: ایجادشده", report.previous.created.to_string()),
        ("دوره قبل: انجام‌شده", report.previous.completed.to_string()),
    ] {
        out.push_str(&csv_line(&["خلاصه".into(), label.into(), value]));
    }

    out.push_str("\r\n");
    out.push_str(&csv_line(&[
        "پروژه".into(),
        "باز".into(),
        "انجام‌شده".into(),
        "عقب‌افتاده".into(),
        "نرخ تکمیل".into(),
        "میانگین زمان بستن (روز)".into(),
    ]));
    for project in &report.projects {
        out.push_str(&csv_line(&[
            project.name.clone(),
            project.open.to_string(),
            project.completed.to_string(),
            project.overdue.to_string(),
            percent(project.completion_rate),
            days_cell(project.average_close_days),
        ]));
    }

    out.push_str("\r\n");
    out.push_str(&csv_line(&[
        "کار گیرکرده".into(),
        "پروژه".into(),
        "وضعیت".into(),
        "اولویت".into(),
        "موعد".into(),
        "سن (روز)".into(),
        "تاخیر (روز)".into(),
    ]));
    for task in &report.stuck {
        out.push_str(&csv_line(&[
            task.title.clone(),
            task.project_name.clone().unwrap_or_default(),
            task.status.clone(),
            task.priority.clone(),
            task.due_date.clone().unwrap_or_default(),
            task.age_days.to_string(),
            task.overdue_days.map(|days| days.to_string()).unwrap_or_default(),
        ]));
    }

    out.push_str("\r\n");
    out.push_str(&csv_line(&[
        "جلسه".into(),
        "شروع".into(),
        "اعضا".into(),
        "حاضر".into(),
        "تاخیر".into(),
        "غایب".into(),
        "مجموع تاخیر (دقیقه)".into(),
        "دستور جلسه".into(),
        "تسک‌شده".into(),
        "بسته‌شده".into(),
    ]));
    for meeting in &report.meetings {
        out.push_str(&csv_line(&[
            meeting.title.clone(),
            meeting.starts_at.clone(),
            meeting.attendees.to_string(),
            meeting.present.to_string(),
            meeting.late.to_string(),
            meeting.absent.to_string(),
            meeting.late_minutes.to_string(),
            meeting.agenda_items.to_string(),
            meeting.agenda_tasks.to_string(),
            meeting.agenda_done.to_string(),
        ]));
    }
    out
}

fn report_markdown(report: &TaskReport, days: i64) -> String {
    let mut out = String::new();
    out.push_str(&format!("# گزارش کارها — {days} روز\n\n"));
    out.push_str("## خلاصه\n\n| شاخص | مقدار |\n| --- | --- |\n");
    for (label, value) in [
        ("ایجادشده", report.totals.created.to_string()),
        ("انجام‌شده", report.totals.completed.to_string()),
        ("باز", report.totals.open.to_string()),
        ("عقب‌افتاده", report.totals.overdue.to_string()),
        ("نرخ تکمیل", percent(report.totals.completion_rate)),
        ("میانگین زمان بستن (روز)", days_cell(report.totals.average_close_days)),
        ("دوره قبل: ایجادشده", report.previous.created.to_string()),
        ("دوره قبل: انجام‌شده", report.previous.completed.to_string()),
    ] {
        out.push_str(&format!("| {label} | {value} |\n"));
    }

    out.push_str("\n## پروژه‌ها\n\n| پروژه | باز | انجام‌شده | عقب‌افتاده | نرخ تکمیل |\n| --- | --- | --- | --- | --- |\n");
    for project in &report.projects {
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} |\n",
            project.name,
            project.open,
            project.completed,
            project.overdue,
            percent(project.completion_rate)
        ));
    }

    out.push_str("\n## کارهای گیرکرده\n\n| کار | پروژه | موعد | سن (روز) | تاخیر (روز) |\n| --- | --- | --- | --- | --- |\n");
    for task in &report.stuck {
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} |\n",
            task.title,
            task.project_name.clone().unwrap_or_default(),
            task.due_date.clone().unwrap_or_default(),
            task.age_days,
            task.overdue_days.map(|days| days.to_string()).unwrap_or_default()
        ));
    }

    out.push_str("\n## جلسات\n\n| جلسه | شروع | اعضا | حاضر | تاخیر | غایب | دستور جلسه |\n| --- | --- | --- | --- | --- | --- | --- |\n");
    for meeting in &report.meetings {
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} |\n",
            meeting.title,
            meeting.starts_at,
            meeting.attendees,
            meeting.present,
            meeting.late,
            meeting.absent,
            meeting.agenda_items
        ));
    }
    out
}

pub fn write_report_file(
    report: &TaskReport,
    path: &str,
    days: i64,
) -> Result<ReportExportSummary, CommandError> {
    let is_markdown = path.to_ascii_lowercase().ends_with(".md")
        || path.to_ascii_lowercase().ends_with(".markdown");
    let content = if is_markdown {
        report_markdown(report, days)
    } else {
        report_csv(report, days)
    };
    if let Some(parent) = std::path::Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(CommandError::system)?;
        }
    }
    std::fs::write(path, content).map_err(CommandError::system)?;
    Ok(ReportExportSummary {
        path: path.to_owned(),
        format: if is_markdown { "markdown".into() } else { "csv".into() },
    })
}

#[tauri::command]
pub fn export_task_report(
    db: State<'_, AppDb>,
    path: String,
    days: Option<i64>,
) -> Result<ReportExportSummary, CommandError> {
    let days = days.unwrap_or(DEFAULT_DAYS).clamp(1, MAX_DAYS);
    let connection = db.0.lock().map_err(CommandError::database)?;
    let report = build(&connection, days)?;
    write_report_file(&report, &path, days)
}

#[cfg(test)]
mod tests {
    use super::build;
    use crate::db::migrate;
    use chrono::{Duration, Local, SecondsFormat, Utc};
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn stamp(days_ago: i64) -> String {
        (Utc::now() - Duration::days(days_ago)).to_rfc3339_opts(SecondsFormat::Millis, true)
    }

    fn insert(
        connection: &Connection,
        id: &str,
        priority: &str,
        completed: bool,
        created_days_ago: i64,
        closed_days_ago: Option<i64>,
        archived: bool,
    ) {
        connection
            .execute(
                "INSERT INTO tasks(id,title,description,priority,due_date,completed,lane_id,
                                   board_position,linked_event_id,created_at,updated_at,
                                   completed_at,archived_at)
                 VALUES (?1,?1,'',?2,NULL,?3,NULL,0,NULL,?4,?4,?5,?6)",
                rusqlite::params![
                    id,
                    priority,
                    i64::from(completed),
                    stamp(created_days_ago),
                    closed_days_ago.map(stamp),
                    archived.then(|| stamp(1)),
                ],
            )
            .unwrap();
    }

    #[test]
    fn counts_created_completed_and_open_in_the_window() {
        let connection = database();
        insert(&connection, "a", "important_urgent", true, 5, Some(2), false);
        insert(&connection, "b", "important_urgent", false, 3, None, false);
        insert(&connection, "c", "not_important_not_urgent", true, 40, Some(39), false);

        let report = build(&connection, 30).unwrap();
        assert_eq!(report.totals.created, 2);
        assert_eq!(report.totals.completed, 1);
        assert_eq!(report.totals.open, 1);
        assert_eq!(report.days.len(), 30);
        assert_eq!(report.days.iter().map(|day| day.created).sum::<i64>(), 2);
        let urgent = report
            .quadrants
            .iter()
            .find(|row| row.priority == "important_urgent")
            .unwrap();
        assert_eq!((urgent.open, urgent.completed), (1, 1));
    }

    #[test]
    fn measures_time_to_close_and_ignores_archived_tasks() {
        let connection = database();
        insert(&connection, "a", "important_urgent", true, 10, Some(6), false);
        insert(&connection, "b", "important_urgent", true, 8, Some(4), false);
        insert(&connection, "gone", "important_urgent", false, 2, None, true);

        let report = build(&connection, 30).unwrap();
        assert_eq!(report.totals.completed, 2);
        assert_eq!(report.totals.archived, 1);
        assert_eq!(report.totals.open, 0);
        assert_eq!(report.totals.average_close_days, Some(4.0));
        assert_eq!(report.totals.median_close_days, Some(4.0));
        assert_eq!(report.totals.completion_rate, 1.0);
        assert!(report.days.iter().all(|day| day.date <= Local::now().date_naive().to_string()));
    }

    #[test]
    fn reports_overdue_open_tasks_and_focus_minutes() {
        let connection = database();
        insert(&connection, "late", "important_urgent", false, 9, None, false);
        connection
            .execute("UPDATE tasks SET due_date=?2 WHERE id=?1", rusqlite::params![
                "late",
                (Local::now().date_naive() - Duration::days(2)).to_string()
            ])
            .unwrap();
        connection
            .execute(
                "INSERT INTO focus_sessions(id,planned_seconds,focused_seconds,status,
                                            started_at,ended_at,created_at)
                 VALUES ('f',1500,900,'completed',?1,?1,?1)",
                [stamp(0)],
            )
            .unwrap();

        let report = build(&connection, 7).unwrap();
        assert_eq!(report.totals.overdue, 1);
        assert_eq!(report.days.iter().map(|day| day.focus_seconds).sum::<i64>(), 900);
    }

    fn project(connection: &Connection, id: &str, name: &str) {
        connection
            .execute(
                "INSERT INTO projects(id,name,description,color,status,created_at,updated_at)
                 VALUES (?1,?2,'','#4FC9DA','active',?3,?3)",
                rusqlite::params![id, name, stamp(0)],
            )
            .unwrap();
    }

    #[test]
    fn breaks_the_range_down_by_project() {
        let connection = database();
        project(&connection, "p1", "سایت");
        project(&connection, "p2", "اپلیکیشن");
        insert(&connection, "a", "important_urgent", true, 6, Some(2), false);
        insert(&connection, "b", "important_urgent", false, 4, None, false);
        insert(&connection, "c", "important_urgent", false, 3, None, false);
        connection
            .execute("UPDATE tasks SET project_id='p1' WHERE id IN ('a','b')", [])
            .unwrap();
        connection
            .execute("UPDATE tasks SET project_id='p2' WHERE id='c'", [])
            .unwrap();

        let report = build(&connection, 30).unwrap();
        let site = report.projects.iter().find(|row| row.id == "p1").unwrap();
        assert_eq!(site.name, "سایت");
        assert_eq!((site.open, site.completed, site.overdue), (1, 1, 0));
        assert_eq!(site.completion_rate, 0.5);
        let app = report.projects.iter().find(|row| row.id == "p2").unwrap();
        assert_eq!((app.open, app.completed), (1, 0));
    }

    #[test]
    fn flags_tasks_that_sat_too_long_or_blew_the_deadline() {
        let connection = database();
        insert(&connection, "old", "important_urgent", false, 40, None, false);
        insert(&connection, "late", "important_urgent", false, 5, None, false);
        insert(&connection, "fresh", "important_urgent", false, 2, None, false);
        connection
            .execute(
                "UPDATE tasks SET due_date=?2 WHERE id=?1",
                rusqlite::params![
                    "late",
                    (Local::now().date_naive() - Duration::days(5)).to_string()
                ],
            )
            .unwrap();

        let report = build(&connection, 7).unwrap();
        let ids: Vec<&str> = report.stuck.iter().map(|task| task.id.as_str()).collect();
        assert_eq!(ids, vec!["late", "old"]);
        assert_eq!(report.stuck[0].overdue_days, Some(5));
        assert_eq!(report.stuck[1].age_days, 40);
    }

    #[test]
    fn compares_the_window_with_the_one_before_it() {
        let connection = database();
        insert(&connection, "now", "important_urgent", true, 3, Some(1), false);
        insert(&connection, "before", "important_urgent", true, 40, Some(35), false);
        insert(&connection, "older", "important_urgent", false, 70, None, false);

        let report = build(&connection, 30).unwrap();
        assert_eq!(report.previous.created, 1);
        assert_eq!(report.previous.completed, 1);
        assert_eq!(report.previous.average_close_days, Some(5.0));
    }

    #[test]
    fn summarizes_meeting_attendance_and_agenda_follow_through() {
        let connection = database();
        insert(&connection, "a", "important_urgent", true, 5, Some(1), false);
        connection
            .execute(
                "INSERT INTO meetings(id,title,agenda,minutes,location,starts_at,ends_at,status,
                                      project_id,created_at,updated_at)
                 VALUES ('m','جلسه','','','',?1,?1,'done',NULL,?2,?2)",
                rusqlite::params![format!("{}T10:00", Local::now().date_naive()), stamp(1)],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO meeting_attendees(meeting_id,contact_id,required,attendance,late_minutes)
                 VALUES ('m','c1',1,'present',0),('m','c2',1,'late',12),('m','c3',0,'absent',0)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO meeting_items(id,meeting_id,kind,title,owner_contact_id,due_date,task_id,position,created_at)
                 VALUES ('i1','m','agenda','الف',NULL,NULL,'a',0,?1),('i2','m','followup','ب',NULL,NULL,NULL,1,?1)",
                rusqlite::params![stamp(1)],
            )
            .unwrap();

        let report = build(&connection, 30).unwrap();
        let meeting = report.meetings.first().unwrap();
        assert_eq!(
            (meeting.attendees, meeting.present, meeting.late, meeting.absent),
            (3, 1, 1, 1)
        );
        assert_eq!(meeting.late_minutes, 12);
        assert_eq!(
            (meeting.agenda_items, meeting.agenda_tasks, meeting.agenda_done),
            (2, 1, 1)
        );
    }

    #[test]
    fn lists_task_activity_inside_the_range() {
        let connection = database();
        insert(&connection, "a", "important_urgent", true, 4, Some(1), false);
        connection
            .execute(
                "INSERT INTO task_events(id,task_id,kind,detail,at)
                 VALUES ('e1','a','completed',NULL,?1),('e2','a','created',NULL,?2)",
                rusqlite::params![stamp(1), stamp(30)],
            )
            .unwrap();

        let report = build(&connection, 7).unwrap();
        assert_eq!(report.activity.len(), 1);
        assert_eq!(report.activity[0].kind, "completed");
        assert_eq!(report.activity[0].task_title, "a");
    }

    #[test]
    fn exports_csv_and_markdown_files() {
        let connection = database();
        insert(&connection, "a", "important_urgent", true, 5, Some(2), false);
        let report = build(&connection, 30).unwrap();
        let dir = std::env::temp_dir().join(format!("resa-report-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let csv = super::write_report_file(&report, &dir.join("r.csv").to_string_lossy(), 30).unwrap();
        assert_eq!(csv.format, "csv");
        let text = std::fs::read_to_string(&csv.path).unwrap();
        assert!(text.contains("خلاصه"));
        assert!(text.contains("پروژه"));

        let markdown =
            super::write_report_file(&report, &dir.join("r.md").to_string_lossy(), 30).unwrap();
        assert_eq!(markdown.format, "markdown");
        assert!(std::fs::read_to_string(&markdown.path)
            .unwrap()
            .starts_with("# گزارش کارها"));

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
