//! Global search behind the command palette.
//!
//! The palette needs one cheap round trip, so events, tasks and notes are
//! queried with `LIKE` (the local database is small enough that FTS would be
//! overkill) and returned as one typed list. Each kind is capped separately so
//! a busy calendar cannot hide matching tasks.

use crate::db::AppDb;
use crate::error::CommandError;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

const DEFAULT_LIMIT: usize = 8;
const MAX_LIMIT: usize = 20;
const SNIPPET_CHARS: usize = 120;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// `event`, `task` or `note`.
    pub kind: String,
    pub id: String,
    pub title: String,
    pub snippet: String,
    /// Event start, task due date or note update time; used as a hint only.
    pub date: Option<String>,
}

fn escape_like(query: &str) -> String {
    let mut escaped = String::with_capacity(query.len());
    for character in query.chars() {
        if matches!(character, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn snippet(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= SNIPPET_CHARS {
        return trimmed.to_owned();
    }
    let mut cut: String = trimmed.chars().take(SNIPPET_CHARS).collect();
    cut.push('…');
    cut
}

/// Notes store Quill Delta JSON; the palette wants readable text. Anything
/// that is not Delta is returned as-is so legacy plain notes still search well.
fn note_plain_text(content: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(content) else {
        return content.to_owned();
    };
    let Some(ops) = value.get("ops").and_then(serde_json::Value::as_array) else {
        return content.to_owned();
    };
    let mut text = String::new();
    for op in ops {
        match op.get("insert") {
            Some(serde_json::Value::String(value)) => text.push_str(value),
            Some(serde_json::Value::Object(_)) => text.push(' '),
            _ => {}
        }
    }
    text
}

fn note_title(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(60).collect())
        .unwrap_or_default()
}

pub fn search(
    connection: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchHit>, CommandError> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, MAX_LIMIT);
    let pattern = format!("%{}%", escape_like(query));
    let mut hits = Vec::new();

    let events = connection
        .prepare(
            "SELECT id,title,COALESCE(note,''),start_at FROM events
              WHERE title LIKE ?1 ESCAPE '\\' OR note LIKE ?1 ESCAPE '\\'
              ORDER BY start_at DESC LIMIT ?2",
        )
        .map_err(CommandError::database)?
        .query_map(params![pattern, limit as i64], |row| {
            Ok(SearchHit {
                kind: "event".into(),
                id: row.get(0)?,
                title: row.get(1)?,
                snippet: snippet(&row.get::<_, String>(2)?),
                date: Some(row.get(3)?),
            })
        })
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    hits.extend(events);

    let tasks = connection
        .prepare(
            "SELECT id,title,description,due_date FROM tasks
              WHERE title LIKE ?1 ESCAPE '\\' OR description LIKE ?1 ESCAPE '\\'
              ORDER BY completed, due_date IS NULL, due_date, updated_at DESC LIMIT ?2",
        )
        .map_err(CommandError::database)?
        .query_map(params![pattern, limit as i64], |row| {
            Ok(SearchHit {
                kind: "task".into(),
                id: row.get(0)?,
                title: row.get(1)?,
                snippet: snippet(&row.get::<_, String>(2)?),
                date: row.get(3)?,
            })
        })
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    hits.extend(tasks);

    let notes = connection
        .prepare(
            "SELECT id,content,updated_at FROM notes
              WHERE content LIKE ?1 ESCAPE '\\'
              ORDER BY pinned DESC, updated_at DESC LIMIT ?2",
        )
        .map_err(CommandError::database)?
        .query_map(params![pattern, limit as i64], |row| {
            let text = note_plain_text(&row.get::<_, String>(1)?);
            Ok(SearchHit {
                kind: "note".into(),
                id: row.get(0)?,
                title: note_title(&text),
                snippet: snippet(&text),
                date: Some(row.get(2)?),
            })
        })
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    hits.extend(notes);

    Ok(hits)
}

#[tauri::command]
pub fn search_all(
    db: State<'_, AppDb>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    search(&connection, &query, limit.unwrap_or(DEFAULT_LIMIT))
}

#[cfg(test)]
mod tests {
    use super::{search, snippet};
    use crate::db::migrate;
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrate(&mut connection).unwrap();
        connection
            .execute_batch(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at)
                   VALUES ('e1','تیم طراحی','2026-03-02T09:00','2026-03-02T10:00',0,'work','#2563EB','بررسی تقویم','t','t');
                 INSERT INTO tasks(id,title,description,priority,due_date,completed,lane_id,board_position,linked_event_id,created_at,updated_at)
                   VALUES ('t1','گزارش طراحی','','important_urgent','2026-03-03',0,NULL,0,NULL,'t','t');
                 INSERT INTO notes(id,content,color,pinned,style_variant,icon,created_at,updated_at)
                   VALUES ('n1','{\"ops\":[{\"insert\":\"طراحی جدید\\n\"}]}','#F5E6A8',0,0,'','t','t');",
            )
            .unwrap();
        connection
    }

    #[test]
    fn finds_each_kind_and_keeps_them_separate() {
        let connection = database();
        let hits = search(&connection, "طراحی", 8).unwrap();
        let kinds: Vec<&str> = hits.iter().map(|hit| hit.kind.as_str()).collect();
        assert_eq!(kinds, ["event", "task", "note"]);
        assert_eq!(hits[0].date.as_deref(), Some("2026-03-02T09:00"));
        assert_eq!(hits[1].date.as_deref(), Some("2026-03-03"));
    }

    #[test]
    fn empty_and_unknown_queries_return_nothing() {
        let connection = database();
        assert!(search(&connection, "   ", 8).unwrap().is_empty());
        assert!(search(&connection, "不存在", 8).unwrap().is_empty());
    }

    #[test]
    fn wildcards_are_literal() {
        let connection = database();
        assert!(search(&connection, "%", 8).unwrap().is_empty());
        assert!(search(&connection, "_", 8).unwrap().is_empty());
    }

    #[test]
    fn snippets_are_trimmed() {
        assert_eq!(snippet("  hi  "), "hi");
        let long = "x".repeat(200);
        let cut = snippet(&long);
        assert_eq!(cut.chars().count(), 121);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn notes_are_shown_as_plain_text() {
        let connection = database();
        let hits = search(&connection, "طراحی", 8).unwrap();
        let note = hits.iter().find(|hit| hit.kind == "note").unwrap();
        assert_eq!(note.title, "طراحی جدید");
        assert_eq!(note.snippet, "طراحی جدید");
    }
}
