//! 会议协调：会议本体 + 参会人（来自通讯录）+ 议程 / 跟进事项。
//!
//! 一场会议是一个整体：编辑时前端提交完整草稿，后端在一个事务里重写子表，
//! 因此「谁参加、谁迟到、哪条议程变成了任务」永远不会出现半更新状态。
//! 议程变成任务时只记下 `task_id`，任务本身仍由任务模块负责，两边不会互相覆盖。

use crate::db::AppDb;
use crate::error::CommandError;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;
use uuid::Uuid;

pub const MEETING_STATUSES: &[&str] = &["planned", "held", "cancelled"];
pub const ATTENDANCE_STATES: &[&str] = &["unknown", "present", "late", "absent", "excused"];
pub const ITEM_KINDS: &[&str] = &["agenda", "followup"];

pub const MEETING_TITLE_MAX_CHARS: usize = 200;
pub const MEETING_TEXT_MAX_CHARS: usize = 20_000;
pub const MEETING_LOCATION_MAX_CHARS: usize = 200;
pub const MEETING_ITEM_TITLE_MAX_CHARS: usize = 300;
pub const MAX_ATTENDEES: usize = 200;
pub const MAX_ITEMS: usize = 200;
pub const MAX_LATE_MINUTES: i64 = 1_440;

const MEETING_COLUMNS: &str =
    "id,title,agenda,minutes,location,starts_at,ends_at,status,project_id,created_at,updated_at";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingAttendee {
    pub contact_id: String,
    pub required: bool,
    /// unknown | present | late | absent | excused
    pub attendance: String,
    pub late_minutes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingItem {
    pub id: String,
    /// agenda | followup
    pub kind: String,
    pub title: String,
    pub owner_contact_id: Option<String>,
    pub due_date: Option<String>,
    /// Set once the item has been turned into a task.
    pub task_id: Option<String>,
    pub position: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub id: String,
    pub title: String,
    /// دستور کار — free text, shown to the attendees.
    pub agenda: String,
    /// صورت‌جلسه و یادداشت‌های بعد از جلسه.
    pub minutes: String,
    pub location: String,
    /// Local wall clock, 'YYYY-MM-DDTHH:MM'.
    pub starts_at: String,
    pub ends_at: String,
    pub status: String,
    pub project_id: Option<String>,
    pub attendees: Vec<MeetingAttendee>,
    pub items: Vec<MeetingItem>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingItemDraft {
    /// None creates a new row.
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub owner_contact_id: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingDraft {
    pub title: String,
    #[serde(default)]
    pub agenda: String,
    #[serde(default)]
    pub minutes: String,
    #[serde(default)]
    pub location: String,
    pub starts_at: String,
    pub ends_at: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub attendees: Vec<MeetingAttendee>,
    #[serde(default)]
    pub items: Vec<MeetingItemDraft>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingExport {
    pub path: String,
    pub bytes: u64,
}

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn clean(text: &str, field: &str, max: usize) -> Result<String, CommandError> {
    let value = text.trim().to_owned();
    if value.chars().count() > max {
        return Err(CommandError::validation(field, "متن بیش از حد بلند است."));
    }
    Ok(value)
}

fn validate_stamp(value: &str, field: &str) -> Result<String, CommandError> {
    let raw = value.trim();
    chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M")
        .map_err(|_| CommandError::validation(field, "زمان جلسه معتبر نیست."))?;
    Ok(raw.to_owned())
}

fn validate_date(value: &str, field: &str) -> Result<String, CommandError> {
    let raw = value.trim();
    chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| CommandError::validation(field, "تاریخ معتبر نیست."))?;
    Ok(raw.to_owned())
}

fn validate_status(status: &str) -> Result<String, CommandError> {
    let status = status.trim();
    let status = if status.is_empty() { "planned" } else { status };
    if !MEETING_STATUSES.contains(&status) {
        return Err(CommandError::validation("status", "وضعیت جلسه معتبر نیست."));
    }
    Ok(status.to_owned())
}

fn validate_attendee(attendee: &MeetingAttendee) -> Result<MeetingAttendee, CommandError> {
    let contact_id = attendee.contact_id.trim();
    if contact_id.is_empty() || contact_id.chars().count() > 64 {
        return Err(CommandError::validation("attendees", "مخاطب جلسه معتبر نیست."));
    }
    let attendance = attendee.attendance.trim();
    let attendance = if attendance.is_empty() { "unknown" } else { attendance };
    if !ATTENDANCE_STATES.contains(&attendance) {
        return Err(CommandError::validation("attendance", "وضعیت حضور معتبر نیست."));
    }
    if !(0..=MAX_LATE_MINUTES).contains(&attendee.late_minutes) {
        return Err(CommandError::validation("lateMinutes", "دقیقه‌های تأخیر معتبر نیست."));
    }
    Ok(MeetingAttendee {
        contact_id: contact_id.to_owned(),
        required: attendee.required,
        attendance: attendance.to_owned(),
        late_minutes: if attendance == "late" { attendee.late_minutes } else { 0 },
    })
}

fn validate_item(item: &MeetingItemDraft) -> Result<MeetingItemDraft, CommandError> {
    let kind = item.kind.trim();
    let kind = if kind.is_empty() { "agenda" } else { kind };
    if !ITEM_KINDS.contains(&kind) {
        return Err(CommandError::validation("kind", "نوع بند جلسه معتبر نیست."));
    }
    let title = item.title.trim();
    if title.is_empty() {
        return Err(CommandError::validation("title", "عنوان بند جلسه خالی است."));
    }
    if title.chars().count() > MEETING_ITEM_TITLE_MAX_CHARS {
        return Err(CommandError::validation("title", "عنوان بند جلسه بیش از حد بلند است."));
    }
    let due_date = match item.due_date.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        Some(value) => Some(validate_date(value, "dueDate")?),
        None => None,
    };
    Ok(MeetingItemDraft {
        id: item.id.clone(),
        kind: kind.to_owned(),
        title: title.to_owned(),
        owner_contact_id: item
            .owner_contact_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_owned),
        due_date,
        task_id: item
            .task_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_owned),
    })
}

fn read_meeting(row: &Row<'_>) -> rusqlite::Result<Meeting> {
    Ok(Meeting {
        id: row.get(0)?,
        title: row.get(1)?,
        agenda: row.get(2)?,
        minutes: row.get(3)?,
        location: row.get(4)?,
        starts_at: row.get(5)?,
        ends_at: row.get(6)?,
        status: row.get(7)?,
        project_id: row.get(8)?,
        attendees: Vec::new(),
        items: Vec::new(),
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn meeting_links(connection: &Connection, meeting: &mut Meeting) -> Result<(), CommandError> {
    meeting.attendees = connection
        .prepare(
            "SELECT contact_id,required,attendance,late_minutes FROM meeting_attendees
             WHERE meeting_id=?1 ORDER BY required DESC,contact_id",
        )
        .map_err(CommandError::database)?
        .query_map([&meeting.id], |row| {
            Ok(MeetingAttendee {
                contact_id: row.get(0)?,
                required: row.get::<_, i64>(1)? == 1,
                attendance: row.get(2)?,
                late_minutes: row.get(3)?,
            })
        })
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    meeting.items = connection
        .prepare(
            "SELECT id,kind,title,owner_contact_id,due_date,task_id,position FROM meeting_items
             WHERE meeting_id=?1 ORDER BY kind,position,id",
        )
        .map_err(CommandError::database)?
        .query_map([&meeting.id], |row| {
            Ok(MeetingItem {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                owner_contact_id: row.get(3)?,
                due_date: row.get(4)?,
                task_id: row.get(5)?,
                position: row.get(6)?,
            })
        })
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    Ok(())
}

fn meeting_by_id(connection: &Connection, id: &str) -> Result<Option<Meeting>, CommandError> {
    let mut meeting = connection
        .query_row(
            &format!("SELECT {MEETING_COLUMNS} FROM meetings WHERE id=?1"),
            [id],
            read_meeting,
        )
        .optional()
        .map_err(CommandError::database)?;
    if let Some(meeting) = meeting.as_mut() {
        meeting_links(connection, meeting)?;
    }
    Ok(meeting)
}

pub fn list(connection: &Connection) -> Result<Vec<Meeting>, CommandError> {
    let mut meetings = connection
        .prepare(&format!(
            "SELECT {MEETING_COLUMNS} FROM meetings ORDER BY starts_at DESC,id"
        ))
        .map_err(CommandError::database)?
        .query_map([], read_meeting)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    for meeting in &mut meetings {
        meeting_links(connection, meeting)?;
    }
    Ok(meetings)
}

fn write_children(
    connection: &Connection,
    meeting_id: &str,
    draft: &MeetingDraft,
) -> Result<(), CommandError> {
    connection
        .execute("DELETE FROM meeting_attendees WHERE meeting_id=?1", [meeting_id])
        .map_err(CommandError::database)?;
    connection
        .execute("DELETE FROM meeting_items WHERE meeting_id=?1", [meeting_id])
        .map_err(CommandError::database)?;
    let mut seen = std::collections::HashSet::new();
    for attendee in &draft.attendees {
        if !seen.insert(attendee.contact_id.clone()) {
            continue;
        }
        connection
            .execute(
                "INSERT INTO meeting_attendees(meeting_id,contact_id,required,attendance,late_minutes)
                 VALUES (?1,?2,?3,?4,?5)",
                params![
                    meeting_id,
                    attendee.contact_id,
                    i64::from(attendee.required),
                    attendee.attendance,
                    attendee.late_minutes
                ],
            )
            .map_err(CommandError::database)?;
    }
    for (index, item) in draft.items.iter().enumerate() {
        let id = item
            .id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().hyphenated().to_string());
        connection
            .execute(
                "INSERT INTO meeting_items(id,meeting_id,kind,title,owner_contact_id,due_date,task_id,position,created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    id,
                    meeting_id,
                    item.kind,
                    item.title,
                    item.owner_contact_id,
                    item.due_date,
                    item.task_id,
                    index as i64,
                    now_utc()
                ],
            )
            .map_err(CommandError::database)?;
    }
    Ok(())
}

pub fn save(
    connection: &mut Connection,
    id: Option<&str>,
    draft: MeetingDraft,
) -> Result<Meeting, CommandError> {
    let title = clean(&draft.title, "title", MEETING_TITLE_MAX_CHARS)?;
    if title.is_empty() {
        return Err(CommandError::validation("title", "عنوان جلسه را وارد کنید."));
    }
    let agenda = clean(&draft.agenda, "agenda", MEETING_TEXT_MAX_CHARS)?;
    let minutes = clean(&draft.minutes, "minutes", MEETING_TEXT_MAX_CHARS)?;
    let location = clean(&draft.location, "location", MEETING_LOCATION_MAX_CHARS)?;
    let starts_at = validate_stamp(&draft.starts_at, "startsAt")?;
    let ends_at = validate_stamp(&draft.ends_at, "endsAt")?;
    if ends_at < starts_at {
        return Err(CommandError::validation("endsAt", "پایان جلسه پیش از شروع آن است."));
    }
    let status = validate_status(&draft.status)?;
    if draft.attendees.len() > MAX_ATTENDEES {
        return Err(CommandError::validation("attendees", "تعداد اعضای جلسه بیش از حد است."));
    }
    if draft.items.len() > MAX_ITEMS {
        return Err(CommandError::validation("items", "تعداد بندهای جلسه بیش از حد است."));
    }
    let attendees = draft
        .attendees
        .iter()
        .map(validate_attendee)
        .collect::<Result<Vec<_>, _>>()?;
    let items = draft
        .items
        .iter()
        .map(validate_item)
        .collect::<Result<Vec<_>, _>>()?;
    let project_id = draft
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    if let Some(project_id) = project_id.as_deref() {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1 AND archived_at IS NULL)",
                [project_id],
                |row| row.get(0),
            )
            .map_err(CommandError::database)?;
        if !exists {
            return Err(CommandError::validation("projectId", "پروژه پیدا نشد."));
        }
    }

    let transaction = connection.transaction().map_err(CommandError::database)?;
    let now = now_utc();
    let meeting_id = match id {
        Some(existing) => {
            let affected = transaction
                .execute(
                    "UPDATE meetings SET title=?2,agenda=?3,minutes=?4,location=?5,
                            starts_at=?6,ends_at=?7,status=?8,project_id=?9,updated_at=?10
                     WHERE id=?1",
                    params![
                        existing, title, agenda, minutes, location, starts_at, ends_at, status,
                        project_id, now
                    ],
                )
                .map_err(CommandError::database)?;
            if affected == 0 {
                return Err(CommandError::not_found("جلسه پیدا نشد."));
            }
            existing.to_owned()
        }
        None => {
            let created = Uuid::new_v4().hyphenated().to_string();
            transaction
                .execute(
                    "INSERT INTO meetings(id,title,agenda,minutes,location,starts_at,ends_at,status,project_id,created_at,updated_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
                    params![
                        created, title, agenda, minutes, location, starts_at, ends_at, status,
                        project_id, now
                    ],
                )
                .map_err(CommandError::database)?;
            created
        }
    };
    let normalized = MeetingDraft {
        title,
        agenda,
        minutes,
        location,
        starts_at,
        ends_at,
        status,
        project_id,
        attendees,
        items,
    };
    write_children(&transaction, &meeting_id, &normalized)?;
    transaction.commit().map_err(CommandError::database)?;
    meeting_by_id(connection, &meeting_id)?
        .ok_or_else(|| CommandError::not_found("جلسه پیدا نشد."))
}

pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let affected = connection
        .execute("DELETE FROM meetings WHERE id=?1", [id])
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::not_found("جلسه پیدا نشد."));
    }
    Ok(())
}

fn attendance_label(state: &str) -> &'static str {
    match state {
        "present" => "حاضر",
        "late" => "با تأخیر",
        "absent" => "غایب",
        "excused" => "با اطلاع",
        _ => "نامشخص",
    }
}

/// A plain Markdown file: the minutes are meant to be read, mailed or pasted
/// into a report, not re-imported.
pub fn export(connection: &Connection, id: &str, path: &Path) -> Result<MeetingExport, CommandError> {
    let meeting = meeting_by_id(connection, id)?
        .ok_or_else(|| CommandError::not_found("جلسه پیدا نشد."))?;
    let mut text = String::new();
    text.push_str(&format!("# {}\n\n", meeting.title));
    text.push_str(&format!("- زمان: {} تا {}\n", meeting.starts_at.replace('T', " "), meeting.ends_at.replace('T', " ")));
    if !meeting.location.is_empty() {
        text.push_str(&format!("- مکان: {}\n", meeting.location));
    }
    text.push_str(&format!("- وضعیت: {}\n\n", meeting.status));
    if !meeting.agenda.is_empty() {
        text.push_str("## دستور کار\n\n");
        text.push_str(&meeting.agenda);
        text.push_str("\n\n");
    }
    if !meeting.attendees.is_empty() {
        text.push_str("## اعضا و حضور\n\n");
        for attendee in &meeting.attendees {
            let late = if attendee.attendance == "late" && attendee.late_minutes > 0 {
                format!(" ({} دقیقه)", attendee.late_minutes)
            } else {
                String::new()
            };
            text.push_str(&format!(
                "- {} — {}{}\n",
                attendee.contact_id,
                attendance_label(&attendee.attendance),
                late
            ));
        }
        text.push('\n');
    }
    let agenda_items: Vec<_> = meeting.items.iter().filter(|item| item.kind == "agenda").collect();
    if !agenda_items.is_empty() {
        text.push_str("## بندهای دستور کار\n\n");
        for item in agenda_items {
            let task = if item.task_id.is_some() { " [تسک]" } else { "" };
            text.push_str(&format!("- {}{}\n", item.title, task));
        }
        text.push('\n');
    }
    let followups: Vec<_> = meeting.items.iter().filter(|item| item.kind == "followup").collect();
    if !followups.is_empty() {
        text.push_str("## پیگیری‌ها\n\n");
        for item in followups {
            let due = item.due_date.as_deref().map(|date| format!(" — تا {date}")).unwrap_or_default();
            text.push_str(&format!("- {}{}\n", item.title, due));
        }
        text.push('\n');
    }
    if !meeting.minutes.is_empty() {
        text.push_str("## صورت‌جلسه\n\n");
        text.push_str(&meeting.minutes);
        text.push('\n');
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(CommandError::system)?;
        }
    }
    std::fs::write(path, text.as_bytes()).map_err(CommandError::system)?;
    let bytes = std::fs::metadata(path).map_err(CommandError::system)?.len();
    Ok(MeetingExport {
        path: path.to_string_lossy().to_string(),
        bytes,
    })
}

pub fn migrate(transaction: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS meetings (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            agenda TEXT NOT NULL DEFAULT '',
            minutes TEXT NOT NULL DEFAULT '',
            location TEXT NOT NULL DEFAULT '',
            starts_at TEXT NOT NULL,
            ends_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'planned',
            project_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_meetings_starts ON meetings(starts_at);
         CREATE TABLE IF NOT EXISTS meeting_attendees (
            meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
            contact_id TEXT NOT NULL,
            required INTEGER NOT NULL DEFAULT 1,
            attendance TEXT NOT NULL DEFAULT 'unknown',
            late_minutes INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (meeting_id, contact_id)
         );
         CREATE TABLE IF NOT EXISTS meeting_items (
            id TEXT PRIMARY KEY,
            meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
            kind TEXT NOT NULL DEFAULT 'agenda',
            title TEXT NOT NULL,
            owner_contact_id TEXT,
            due_date TEXT,
            task_id TEXT,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_meeting_items_meeting ON meeting_items(meeting_id, position);
         CREATE INDEX IF NOT EXISTS idx_meeting_items_task ON meeting_items(task_id);",
    )
}

#[tauri::command]
pub fn list_meetings(db: State<'_, AppDb>) -> Result<Vec<Meeting>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}

#[tauri::command]
pub fn save_meeting(
    db: State<'_, AppDb>,
    id: Option<String>,
    draft: MeetingDraft,
) -> Result<Meeting, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    save(&mut connection, id.as_deref(), draft)
}

#[tauri::command]
pub fn delete_meeting(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)
}

#[tauri::command]
pub fn export_meeting(
    db: State<'_, AppDb>,
    id: String,
    path: String,
) -> Result<MeetingExport, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    export(&connection, &id, Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrate(&mut connection).unwrap();
        connection
    }

    fn draft() -> MeetingDraft {
        MeetingDraft {
            title: "جلسه هفتگی".into(),
            agenda: "بررسی پیشرفت".into(),
            minutes: String::new(),
            location: "اتاق جلسات".into(),
            starts_at: "2026-11-20T10:00".into(),
            ends_at: "2026-11-20T11:00".into(),
            status: "planned".into(),
            project_id: None,
            attendees: vec![
                MeetingAttendee {
                    contact_id: "c1".into(),
                    required: true,
                    attendance: "late".into(),
                    late_minutes: 12,
                },
                MeetingAttendee {
                    contact_id: "c2".into(),
                    required: false,
                    attendance: "unknown".into(),
                    late_minutes: 0,
                },
            ],
            items: vec![
                MeetingItemDraft {
                    id: None,
                    kind: "agenda".into(),
                    title: "بودجه".into(),
                    owner_contact_id: Some("c1".into()),
                    due_date: None,
                    task_id: None,
                },
                MeetingItemDraft {
                    id: None,
                    kind: "followup".into(),
                    title: "ارسال صورت‌جلسه".into(),
                    owner_contact_id: None,
                    due_date: Some("2026-11-22".into()),
                    task_id: None,
                },
            ],
        }
    }

    #[test]
    fn saves_attendees_and_items_together() {
        let mut connection = memory_db();
        let saved = save(&mut connection, None, draft()).unwrap();
        assert_eq!(saved.attendees.len(), 2);
        assert_eq!(saved.items.len(), 2);
        assert_eq!(saved.attendees.iter().find(|a| a.contact_id == "c1").unwrap().late_minutes, 12);
        assert_eq!(saved.items.iter().filter(|i| i.kind == "followup").count(), 1);
        assert_eq!(list(&connection).unwrap().len(), 1);
    }

    #[test]
    fn updating_replaces_children_and_keeps_the_id() {
        let mut connection = memory_db();
        let saved = save(&mut connection, None, draft()).unwrap();
        let mut next = draft();
        next.title = "جلسه فوق‌العاده".into();
        next.attendees.truncate(1);
        next.attendees[0].attendance = "present".into();
        next.attendees[0].late_minutes = 0;
        let updated = save(&mut connection, Some(&saved.id), next).unwrap();
        assert_eq!(updated.id, saved.id);
        assert_eq!(updated.title, "جلسه فوق‌العاده");
        assert_eq!(updated.attendees.len(), 1);
        assert_eq!(updated.attendees[0].attendance, "present");
    }

    #[test]
    fn rejects_an_end_before_the_start() {
        let mut connection = memory_db();
        let mut bad = draft();
        bad.ends_at = "2026-11-20T09:00".into();
        assert!(save(&mut connection, None, bad).is_err());
    }

    #[test]
    fn deleting_a_meeting_removes_its_children() {
        let mut connection = memory_db();
        let saved = save(&mut connection, None, draft()).unwrap();
        delete(&mut connection, &saved.id).unwrap();
        let attendees: i64 = connection
            .query_row("SELECT COUNT(*) FROM meeting_attendees", [], |row| row.get(0))
            .unwrap();
        assert_eq!(attendees, 0);
    }

    #[test]
    fn exports_a_markdown_minute_file() {
        let mut connection = memory_db();
        let saved = save(&mut connection, None, draft()).unwrap();
        let dir = std::env::temp_dir().join(format!("resa-meeting-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("meeting.md");
        let summary = export(&connection, &saved.id, &path).unwrap();
        assert!(summary.bytes > 0);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("جلسه هفتگی"));
        assert!(text.contains("دستور کار"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
