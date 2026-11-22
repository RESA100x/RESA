//! Projects group tasks that belong to the same piece of work, so the archive
//! and the report can answer "what did we do on this project" months later.
//!
//! A project is never deleted: archiving hides it from pickers while every task
//! keeps pointing at it, which is what makes the per-project history stable.
//! Restoring brings it back with the same id, so nothing has to be re-linked.
//!
//! The numbers on a project (open, in progress, done, overdue, meetings) are
//! always read from the tasks and meetings that point at it. They are never
//! stored, so a task moving on the board can never leave a stale counter behind.

use crate::db::AppDb;
use crate::error::CommandError;
use crate::write_scope::DomainWrite;
use chrono::{NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

pub const PROJECT_STATUSES: &[&str] = &["active", "paused", "done"];
const DEFAULT_COLOR: &str = "#4FC9DA";
const MAX_NAME: usize = 80;
const MAX_DESCRIPTION: usize = 2000;
const MAX_TAGS: usize = 12;
const MAX_TAG: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub color: String,
    pub status: String,
    // The person accountable for the project, from the phone book.
    pub owner_contact_id: Option<String>,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    // Every task ever attached, archived ones included: this is the number the
    // project list shows when someone asks "how much work went into this".
    pub task_count: i64,
    pub open_count: i64,
    pub in_progress_count: i64,
    pub done_count: i64,
    // Open work whose due date has already passed.
    pub overdue_count: i64,
    pub meeting_count: i64,
    // Newest touch on the project or any of its tasks; null for an untouched
    // project whose tasks have all been deleted.
    pub last_activity_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDraft {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub owner_contact_id: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// One SELECT for both the list and the single row, so the counters can never
/// disagree between the two views.
const PROJECT_SELECT: &str = "SELECT p.id,p.name,p.description,p.color,p.status,
        p.owner_contact_id,p.start_date,p.due_date,p.tags,
        p.created_at,p.updated_at,p.archived_at,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id),
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status='open' AND t.archived_at IS NULL),
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status='in_progress' AND t.archived_at IS NULL),
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status='done'),
        (SELECT COUNT(*) FROM tasks t
          WHERE t.project_id=p.id AND t.archived_at IS NULL
            AND t.status IN ('open','in_progress','delayed')
            AND t.due_date IS NOT NULL AND t.due_date < date('now')),
        (SELECT COUNT(*) FROM meetings m WHERE m.project_id=p.id),
        (SELECT MAX(t.updated_at) FROM tasks t WHERE t.project_id=p.id)
   FROM projects p";

fn read_tags(raw: Option<String>) -> Vec<String> {
    raw.and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .unwrap_or_default()
}

fn read_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    let updated_at: String = row.get(10)?;
    let last_task: Option<String> = row.get(18)?;
    // The project's own edit counts as activity; a task edit may be newer.
    let last_activity_at = match last_task {
        Some(task) if task > updated_at => Some(task),
        _ => Some(updated_at.clone()),
    };
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        color: row.get(3)?,
        status: row.get(4)?,
        owner_contact_id: row.get(5)?,
        start_date: row.get(6)?,
        due_date: row.get(7)?,
        tags: read_tags(row.get(8)?),
        created_at: row.get(9)?,
        updated_at,
        archived_at: row.get(11)?,
        task_count: row.get(12)?,
        open_count: row.get(13)?,
        in_progress_count: row.get(14)?,
        done_count: row.get(15)?,
        overdue_count: row.get(16)?,
        meeting_count: row.get(17)?,
        last_activity_at,
    })
}

fn normalize_name(name: &str) -> Result<String, CommandError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CommandError::validation("name", "نام پروژه را وارد کنید."));
    }
    if name.chars().count() > MAX_NAME {
        return Err(CommandError::validation("name", "نام پروژه بیش از حد بلند است."));
    }
    Ok(name.to_owned())
}

fn normalize_description(description: Option<String>) -> String {
    let value = description.unwrap_or_default();
    let value = value.trim();
    value.chars().take(MAX_DESCRIPTION).collect()
}

fn normalize_color(color: Option<&str>) -> Result<String, CommandError> {
    let Some(color) = color else {
        return Ok(DEFAULT_COLOR.to_owned());
    };
    let value = color.trim().to_ascii_uppercase();
    let valid = value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit());
    if valid {
        Ok(value)
    } else {
        Err(CommandError::validation("color", "قالب رنگ درست نیست."))
    }
}

fn normalize_status(status: Option<&str>) -> Result<String, CommandError> {
    let status = status.unwrap_or("active").trim();
    if PROJECT_STATUSES.contains(&status) {
        Ok(status.to_owned())
    } else {
        Err(CommandError::validation("status", "وضعیت پروژه درست نیست."))
    }
}

/// An empty string clears the date; anything else must be a plain `YYYY-MM-DD`.
fn normalize_date(field: &str, value: Option<&str>) -> Result<Option<String>, CommandError> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| CommandError::validation(field, "تاریخ را به شکل ۲۰۲۶-۱۱-۲۲ وارد کنید."))?;
    Ok(Some(raw.to_owned()))
}

fn normalize_tags(tags: Option<Vec<String>>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags.unwrap_or_default() {
        let tag = tag.trim();
        if tag.is_empty() {
            continue;
        }
        let tag: String = tag.chars().take(MAX_TAG).collect();
        if !out.iter().any(|existing| existing.eq_ignore_ascii_case(&tag)) {
            out.push(tag);
        }
        if out.len() == MAX_TAGS {
            break;
        }
    }
    out
}

/// The owner must be a real contact; otherwise the project card would link to
/// a person who no longer exists.
fn normalize_owner(
    connection: &Connection,
    owner: Option<&str>,
) -> Result<Option<String>, CommandError> {
    let Some(owner) = owner else {
        return Ok(None);
    };
    let owner = owner.trim();
    if owner.is_empty() {
        return Ok(None);
    }
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM contacts WHERE id=?1)",
            [owner],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if !exists {
        return Err(CommandError::validation("ownerContactId", "این مخاطب پیدا نشد."));
    }
    Ok(Some(owner.to_owned()))
}

pub fn list(connection: &Connection) -> Result<Vec<Project>, CommandError> {
    connection
        .prepare(&format!(
            "{PROJECT_SELECT} ORDER BY p.archived_at IS NOT NULL, p.name COLLATE NOCASE, p.id"
        ))
        .map_err(CommandError::database)?
        .query_map([], read_project)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

fn by_id(connection: &Connection, id: &str) -> Result<Option<Project>, CommandError> {
    connection
        .query_row(&format!("{PROJECT_SELECT} WHERE p.id=?1"), [id], read_project)
        .optional()
        .map_err(CommandError::database)
}

pub fn create(connection: &Connection, draft: ProjectDraft) -> Result<Project, CommandError> {
    let name = normalize_name(&draft.name)?;
    let color = normalize_color(draft.color.as_deref())?;
    let status = normalize_status(draft.status.as_deref())?;
    let description = normalize_description(draft.description);
    let start_date = normalize_date("startDate", draft.start_date.as_deref())?;
    let due_date = normalize_date("dueDate", draft.due_date.as_deref())?;
    if let (Some(start), Some(due)) = (&start_date, &due_date) {
        if start > due {
            return Err(CommandError::validation(
                "dueDate",
                "تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.",
            ));
        }
    }
    let tags = normalize_tags(draft.tags);
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let owner = normalize_owner(&transaction, draft.owner_contact_id.as_deref())?;
    let duplicate: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE lower(name)=lower(?1) AND archived_at IS NULL)",
            [&name],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if duplicate {
        return Err(CommandError::validation("name", "پروژه‌ای با همین نام وجود دارد."));
    }
    let id = Uuid::new_v4().hyphenated().to_string();
    let now = timestamp();
    transaction
        .execute(
            "INSERT INTO projects(id,name,description,color,status,owner_contact_id,start_date,due_date,tags,
                                  created_at,updated_at,archived_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10,NULL)",
            params![
                id,
                name,
                description,
                color,
                status,
                owner,
                start_date,
                due_date,
                serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_owned()),
                now
            ],
        )
        .map_err(CommandError::database)?;
    let project = by_id(&transaction, &id)?
        .ok_or_else(|| CommandError::conflict("ذخیره پروژه انجام نشد؛ دوباره تلاش کنید."))?;
    transaction.commit().map_err(CommandError::database)?;
    Ok(project)
}

pub fn update(
    connection: &Connection,
    id: &str,
    draft: ProjectDraft,
) -> Result<Project, CommandError> {
    let name = normalize_name(&draft.name)?;
    let color = normalize_color(draft.color.as_deref())?;
    let status = normalize_status(draft.status.as_deref())?;
    let description = normalize_description(draft.description);
    let start_date = normalize_date("startDate", draft.start_date.as_deref())?;
    let due_date = normalize_date("dueDate", draft.due_date.as_deref())?;
    if let (Some(start), Some(due)) = (&start_date, &due_date) {
        if start > due {
            return Err(CommandError::validation(
                "dueDate",
                "تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.",
            ));
        }
    }
    let tags = normalize_tags(draft.tags);
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let owner = normalize_owner(&transaction, draft.owner_contact_id.as_deref())?;
    let duplicate: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects
                           WHERE lower(name)=lower(?1) AND id<>?2 AND archived_at IS NULL)",
            params![name, id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if duplicate {
        return Err(CommandError::validation("name", "پروژه‌ای با همین نام وجود دارد."));
    }
    let affected = transaction
        .execute(
            "UPDATE projects SET name=?2,description=?3,color=?4,status=?5,owner_contact_id=?6,
                                 start_date=?7,due_date=?8,tags=?9,updated_at=?10
             WHERE id=?1",
            params![
                id,
                name,
                description,
                color,
                status,
                owner,
                start_date,
                due_date,
                serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_owned()),
                timestamp()
            ],
        )
        .map_err(CommandError::database)?;
    if affected != 1 {
        return Err(CommandError::not_found("این پروژه پیدا نشد."));
    }
    let project = by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("این پروژه پیدا نشد."))?;
    transaction.commit().map_err(CommandError::database)?;
    Ok(project)
}

/// Hide a project from pickers. Tasks keep their `project_id`, so the archive
/// and the per-project report still work after the project is closed.
pub fn archive(connection: &Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let affected = transaction
        .execute(
            "UPDATE projects SET archived_at=COALESCE(archived_at,?2),updated_at=?2 WHERE id=?1",
            params![id, timestamp()],
        )
        .map_err(CommandError::database)?;
    if affected != 1 {
        return Err(CommandError::not_found("این پروژه پیدا نشد."));
    }
    transaction.commit().map_err(CommandError::database)
}

/// Bring an archived project back. The id never changed, so every task and
/// meeting that pointed at it is still attached.
pub fn restore(connection: &Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let affected = transaction
        .execute(
            "UPDATE projects SET archived_at=NULL,updated_at=?2 WHERE id=?1",
            params![id, timestamp()],
        )
        .map_err(CommandError::database)?;
    if affected != 1 {
        return Err(CommandError::not_found("این پروژه پیدا نشد."));
    }
    transaction.commit().map_err(CommandError::database)
}

#[tauri::command]
pub fn list_projects(db: State<'_, AppDb>) -> Result<Vec<Project>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}

#[tauri::command]
pub fn create_project(db: State<'_, AppDb>, draft: ProjectDraft) -> Result<Project, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    create(&connection, draft)
}

#[tauri::command]
pub fn update_project(
    db: State<'_, AppDb>,
    id: String,
    draft: ProjectDraft,
) -> Result<Project, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    update(&connection, &id, draft)
}

#[tauri::command]
pub fn archive_project(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    archive(&connection, &id)
}

#[tauri::command]
pub fn restore_project(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    restore(&connection, &id)
}

#[cfg(test)]
mod tests {
    use super::{archive, create, list, restore, update, ProjectDraft};
    use crate::db::migrate;
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn draft(name: &str) -> ProjectDraft {
        ProjectDraft {
            name: name.into(),
            description: None,
            color: None,
            status: None,
            owner_contact_id: None,
            start_date: None,
            due_date: None,
            tags: None,
        }
    }

    #[test]
    fn creates_lists_and_renames_a_project() {
        let connection = database();
        let project = create(&connection, draft("  عتبات  ")).unwrap();
        assert_eq!(project.name, "عتبات");
        assert_eq!(project.status, "active");
        assert_eq!(project.color, "#4FC9DA");
        assert!(project.tags.is_empty());
        assert_eq!(list(&connection).unwrap().len(), 1);

        let renamed = update(&connection, &project.id, ProjectDraft {
            name: "عتبات عالیات".into(),
            description: Some("فاز اول".into()),
            color: Some("#F06445".into()),
            status: Some("paused".into()),
            owner_contact_id: None,
            start_date: Some("2026-01-01".into()),
            due_date: Some("2026-06-30".into()),
            tags: Some(vec!["فاز اول".into(), "  فاز اول ".into(), "مالی".into()]),
        })
        .unwrap();
        assert_eq!(renamed.name, "عتبات عالیات");
        assert_eq!(renamed.status, "paused");
        assert_eq!(renamed.color, "#F06445");
        assert_eq!(renamed.start_date.as_deref(), Some("2026-01-01"));
        assert_eq!(renamed.due_date.as_deref(), Some("2026-06-30"));
        // Duplicates (case-insensitive, trimmed) collapse to one tag.
        assert_eq!(renamed.tags, vec!["فاز اول".to_string(), "مالی".to_string()]);
    }

    #[test]
    fn rejects_duplicates_empty_names_bad_colors_and_bad_dates() {
        let connection = database();
        create(&connection, draft("الف")).unwrap();
        assert!(create(&connection, draft("الف")).is_err());
        assert!(create(&connection, draft("   ")).is_err());
        assert!(create(&connection, ProjectDraft {
            name: "ب".into(),
            description: None,
            color: Some("red".into()),
            status: None,
            owner_contact_id: None,
            start_date: None,
            due_date: None,
            tags: None,
        })
        .is_err());
        assert!(create(&connection, ProjectDraft {
            name: "ج".into(),
            description: None,
            color: None,
            status: None,
            owner_contact_id: None,
            start_date: Some("2026-13-40".into()),
            due_date: None,
            tags: None,
        })
        .is_err());
        // The end cannot precede the start.
        assert!(create(&connection, ProjectDraft {
            name: "د".into(),
            description: None,
            color: None,
            status: None,
            owner_contact_id: None,
            start_date: Some("2026-05-01".into()),
            due_date: Some("2026-04-01".into()),
            tags: None,
        })
        .is_err());
    }

    #[test]
    fn archiving_keeps_the_row_and_restoring_brings_it_back() {
        let connection = database();
        let project = create(&connection, draft("پروژه")).unwrap();
        archive(&connection, &project.id).unwrap();
        let rows = list(&connection).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].archived_at.is_some());

        restore(&connection, &project.id).unwrap();
        let rows = list(&connection).unwrap();
        assert!(rows[0].archived_at.is_none());
        assert_eq!(rows[0].id, project.id);
    }

    #[test]
    fn counts_open_done_overdue_and_meetings_from_the_linked_rows() {
        let connection = database();
        let project = create(&connection, draft("شمارنده")).unwrap();
        connection
            .execute_batch(&format!(
                "INSERT INTO tasks(id,title,description,priority,due_date,completed,lane_id,board_position,
                                   linked_event_id,created_at,updated_at,completed_at,status,project_id)
                 VALUES
                   ('t-open','باز','','important_urgent','2020-01-01',0,NULL,0,NULL,'t','t',NULL,'open','{id}'),
                   ('t-doing','در جریان','','important_urgent',NULL,0,NULL,0,NULL,'t','t',NULL,'in_progress','{id}'),
                   ('t-done','انجام شد','','important_urgent',NULL,1,NULL,0,NULL,'t','t','t','done','{id}');
                 INSERT INTO meetings(id,title,agenda,minutes,location,starts_at,ends_at,status,project_id,created_at,updated_at)
                 VALUES ('m1','جلسه','','','','2026-01-01T09:00','2026-01-01T10:00','planned','{id}','t','t');",
                id = project.id
            ))
            .unwrap();
        let project_id = project.id.clone();
        let row = list(&connection)
            .unwrap()
            .into_iter()
            .find(|project| project.id == project_id)
            .unwrap();
        assert_eq!(row.task_count, 3);
        assert_eq!(row.open_count, 1);
        assert_eq!(row.in_progress_count, 1);
        assert_eq!(row.done_count, 1);
        assert_eq!(row.overdue_count, 1);
        assert_eq!(row.meeting_count, 1);
        assert!(row.last_activity_at.is_some());
    }
}
