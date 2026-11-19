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
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

const DEFAULT_DAYS: i64 = 30;
const MAX_DAYS: i64 = 366;

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReport {
    pub days: Vec<ReportDay>,
    pub totals: ReportTotals,
    pub quadrants: Vec<ReportQuadrant>,
    pub lanes: Vec<ReportLane>,
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

    let mut statement = connection
        .prepare(
            "SELECT priority,due_date,completed,completed_at,created_at,archived_at,lane_id
             FROM tasks",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)? == 1,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;

    for (priority, due_date, completed, completed_at, created_at, archived_at, lane_id) in rows {
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
        if open {
            totals.open += 1;
            if let Some(due) = due_date.as_deref().and_then(|value| value.parse::<NaiveDate>().ok()) {
                if due < today {
                    totals.overdue += 1;
                }
            }
        }

        // The quadrant and lane tables describe the range too: a task created
        // before it and closed inside it counts as completed, not as created.
        let created_in_range = created_on.map(in_range).unwrap_or(false);
        let completed_in_range = completed_on.map(in_range).unwrap_or(false);
        if !created_in_range && !completed_in_range && !(open && created_on.is_some()) {
            continue;
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
        generated_at: timestamp(),
    })
}

#[tauri::command]
pub fn get_task_report(db: State<'_, AppDb>, days: Option<i64>) -> Result<TaskReport, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    build(&connection, days.unwrap_or(DEFAULT_DAYS))
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
}
