//! Projects group tasks that belong to the same piece of work, so the archive
//! and the report can answer "what did we do on this project" months later.
//!
//! A project is never deleted: archiving hides it from pickers while every task
//! keeps pointing at it, which is what makes the per-project history stable.

use crate::db::AppDb;
use crate::error::CommandError;
use crate::write_scope::DomainWrite;
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

pub const PROJECT_STATUSES: &[&str] = &["active", "paused", "done"];
const DEFAULT_COLOR: &str = "#4FC9DA";
const MAX_NAME: usize = 80;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub color: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    // Every task ever attached, archived ones included: this is the number the
    // project list shows when someone asks "how much work went into this".
    pub task_count: i64,
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
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn read_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        color: row.get(3)?,
        status: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        archived_at: row.get(7)?,
        task_count: row.get(8)?,
    })
}

fn normalize_name(name: &str) -> Result<String, CommandError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CommandError::validation("name", "请输入项目名称。"));
    }
    if name.chars().count() > MAX_NAME {
        return Err(CommandError::validation("name", "项目名称过长。"));
    }
    Ok(name.to_owned())
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
        Err(CommandError::validation("color", "颜色格式无效。"))
    }
}

fn normalize_status(status: Option<&str>) -> Result<String, CommandError> {
    let status = status.unwrap_or("active").trim();
    if PROJECT_STATUSES.contains(&status) {
        Ok(status.to_owned())
    } else {
        Err(CommandError::validation("status", "项目状态无效。"))
    }
}

pub fn list(connection: &Connection) -> Result<Vec<Project>, CommandError> {
    connection
        .prepare(
            "SELECT p.id,p.name,p.description,p.color,p.status,p.created_at,p.updated_at,p.archived_at,
                    (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id)
             FROM projects p ORDER BY p.archived_at IS NOT NULL, p.name COLLATE NOCASE, p.id",
        )
        .map_err(CommandError::database)?
        .query_map([], read_project)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

fn by_id(connection: &Connection, id: &str) -> Result<Option<Project>, CommandError> {
    connection
        .query_row(
            "SELECT p.id,p.name,p.description,p.color,p.status,p.created_at,p.updated_at,p.archived_at,
                    (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id)
             FROM projects p WHERE p.id=?1",
            [id],
            read_project,
        )
        .optional()
        .map_err(CommandError::database)
}

pub fn create(connection: &Connection, draft: ProjectDraft) -> Result<Project, CommandError> {
    let name = normalize_name(&draft.name)?;
    let color = normalize_color(draft.color.as_deref())?;
    let status = normalize_status(draft.status.as_deref())?;
    let description = draft.description.unwrap_or_default().trim().to_owned();
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let duplicate: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE lower(name)=lower(?1) AND archived_at IS NULL)",
            [&name],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if duplicate {
        return Err(CommandError::validation("name", "同名项目已存在。"));
    }
    let id = Uuid::new_v4().hyphenated().to_string();
    let now = timestamp();
    transaction
        .execute(
            "INSERT INTO projects(id,name,description,color,status,created_at,updated_at,archived_at)
             VALUES (?1,?2,?3,?4,?5,?6,?6,NULL)",
            params![id, name, description, color, status, now],
        )
        .map_err(CommandError::database)?;
    let project = by_id(&transaction, &id)?
        .ok_or_else(|| CommandError::conflict("项目保存失败，请重试。"))?;
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
    let description = draft.description.unwrap_or_default().trim().to_owned();
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let duplicate: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects
                           WHERE lower(name)=lower(?1) AND id<>?2 AND archived_at IS NULL)",
            params![name, id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if duplicate {
        return Err(CommandError::validation("name", "同名项目已存在。"));
    }
    let affected = transaction
        .execute(
            "UPDATE projects SET name=?2,description=?3,color=?4,status=?5,updated_at=?6
             WHERE id=?1",
            params![id, name, description, color, status, timestamp()],
        )
        .map_err(CommandError::database)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该项目。"));
    }
    let project = by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该项目。"))?;
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
        return Err(CommandError::not_found("未找到该项目。"));
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

#[cfg(test)]
mod tests {
    use super::{archive, create, list, update, ProjectDraft};
    use crate::db::migrate;
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn draft(name: &str) -> ProjectDraft {
        ProjectDraft { name: name.into(), description: None, color: None, status: None }
    }

    #[test]
    fn creates_lists_and_renames_a_project() {
        let connection = database();
        let project = create(&connection, draft("  عتبات  ")).unwrap();
        assert_eq!(project.name, "عتبات");
        assert_eq!(project.status, "active");
        assert_eq!(project.color, "#4FC9DA");
        assert_eq!(list(&connection).unwrap().len(), 1);

        let renamed = update(&connection, &project.id, ProjectDraft {
            name: "عتبات عالیات".into(),
            description: Some("فاز اول".into()),
            color: Some("#F06445".into()),
            status: Some("paused".into()),
        })
        .unwrap();
        assert_eq!(renamed.name, "عتبات عالیات");
        assert_eq!(renamed.status, "paused");
        assert_eq!(renamed.color, "#F06445");
    }

    #[test]
    fn rejects_duplicates_empty_names_and_bad_colors() {
        let connection = database();
        create(&connection, draft("الف")).unwrap();
        assert!(create(&connection, draft("الف")).is_err());
        assert!(create(&connection, draft("   ")).is_err());
        assert!(create(&connection, ProjectDraft {
            name: "ب".into(),
            description: None,
            color: Some("red".into()),
            status: None,
        })
        .is_err());
    }

    #[test]
    fn archiving_keeps_the_row_and_hides_it_from_the_active_list() {
        let connection = database();
        let project = create(&connection, draft("پروژه")).unwrap();
        archive(&connection, &project.id).unwrap();
        let rows = list(&connection).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].archived_at.is_some());
    }
}
