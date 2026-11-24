//! Push local changes, pull remote ones, converge.
//!
//! SQLite stays the source of truth. Triggers on the synced tables fill
//! `sync_outbox`; this engine drains that outbox to the backend, then pulls
//! everything newer than the stored cursor back into SQLite.

use super::auth;
use super::http::{encode_query_value, Api};
use super::state;
use crate::error::CommandError;
use chrono::SecondsFormat;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection, Transaction};
use serde::Serialize;
use serde_json::{json, Map, Value};

/// One synced table.
///
/// `name` doubles as the SQLite table name and the entity key on the wire.
/// Most tables key on `id`; the join tables carry a composite primary key and
/// no clock, so they describe their own id expression.
pub struct EntitySpec {
    pub name: &'static str,
    /// SQL expression over the table that yields the record id.
    pub id_expr: &'static str,
    /// Columns the upsert conflicts on.
    pub key_columns: &'static [&'static str],
    /// Whether the table carries an `updated_at` clock for last-write-wins.
    pub clocked: bool,
}

/// Every table the engine ships. Parents come first: a pull applies rows in
/// this order, so a kanban card never arrives before its lane.
///
/// Adding a table means a trigger set in the SQLite migration plus an entry
/// here, and nothing else.
pub const ENTITIES: &[EntitySpec] = &[
    EntitySpec { name: "contact_categories", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec { name: "contacts", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec { name: "projects", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec { name: "task_lanes", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec { name: "task_tags", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec { name: "tasks", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec { name: "task_steps", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec {
        name: "task_tag_links",
        id_expr: "task_id || '|' || tag_id",
        key_columns: &["task_id", "tag_id"],
        clocked: false,
    },
    EntitySpec { name: "events", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec { name: "event_exceptions", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec { name: "notes", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec { name: "meetings", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec {
        name: "meeting_attendees",
        id_expr: "meeting_id || '|' || contact_id",
        key_columns: &["meeting_id", "contact_id"],
        clocked: false,
    },
    EntitySpec { name: "meeting_items", id_expr: "id", key_columns: &["id"], clocked: false },
    EntitySpec { name: "books", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec { name: "plants", id_expr: "id", key_columns: &["id"], clocked: true },
    EntitySpec { name: "focus_sessions", id_expr: "id", key_columns: &["id"], clocked: false },
    EntitySpec { name: "custom_templates", id_expr: "id", key_columns: &["id"], clocked: true },
];

/// A workspace may be missing a module's tables entirely (an older build
/// numbered its migrations differently), so every SQL touch checks first.
pub(crate) fn table_exists(connection: &Connection, name: &str) -> bool {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            [name],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false)
}

pub fn spec(name: &str) -> Option<&'static EntitySpec> {
    ENTITIES.iter().find(|spec| spec.name == name)
}

/// Position in `ENTITIES`, used to order a pulled batch.
fn rank(name: &str) -> usize {
    ENTITIES
        .iter()
        .position(|spec| spec.name == name)
        .unwrap_or(ENTITIES.len())
}

const PUSH_BATCH: usize = 200;
const PULL_PAGE: usize = 500;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub pushed: usize,
    pub pulled: usize,
    /// Entities the pull actually touched, so the UI can reload just those.
    pub entities: Vec<String>,
    pub at: String,
}

struct Config {
    endpoint: String,
    anon_key: String,
}

fn config(connection: &Connection) -> Result<Config, CommandError> {
    let endpoint = state::get(connection, state::KEY_ENDPOINT)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CommandError::sync("سرور سینک هنوز تنظیم نشده است.".to_owned()))?;
    let anon_key = state::get(connection, state::KEY_ANON)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CommandError::sync("کلید عمومی سرویس سینک تنظیم نشده است.".to_owned()))?;
    Ok(Config { endpoint, anon_key })
}

fn access_token(connection: &Connection, api: &Api) -> Result<String, CommandError> {
    let credentials = state::load_credentials(connection)?
        .ok_or_else(|| CommandError::sync("برای سینک ابتدا وارد حساب خود شوید.".to_owned()))?;
    if credentials.expires_at > chrono::Utc::now().timestamp() + 120 {
        return Ok(credentials.access_token);
    }
    let session = auth::refresh(api, &credentials.refresh_token)?;
    state::save_credentials(
        connection,
        &session.access_token,
        &session.refresh_token,
        session.expires_at,
    )?;
    Ok(session.access_token)
}

pub fn run(connection: &mut Connection) -> Result<SyncOutcome, CommandError> {
    let config = config(connection)?;
    let api = Api::new(&config.endpoint, &config.anon_key)?;
    let token = access_token(connection, &api)?;
    let pushed = push(connection, &api, &token)?;
    let (pulled, entities) = pull(connection, &api, &token)?;
    let at = chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    state::set(connection, state::KEY_LAST_SYNC, &at).map_err(CommandError::database)?;
    Ok(SyncOutcome {
        pushed,
        pulled,
        entities,
        at,
    })
}

pub fn pending_changes(connection: &Connection) -> i64 {
    connection
        .query_row("SELECT COUNT(*) FROM sync_outbox", [], |row| row.get(0))
        .unwrap_or(0)
}

fn push(connection: &Connection, api: &Api, token: &str) -> Result<usize, CommandError> {
    let device = state::device_id(connection).map_err(CommandError::database)?;
    let queued: Vec<(String, String, String, String)> = {
        let mut statement = connection
            .prepare(
                "SELECT entity, record_id, op, changed_at FROM sync_outbox
                 ORDER BY changed_at LIMIT ?1",
            )
            .map_err(CommandError::database)?;
        let rows = statement
            .query_map([PUSH_BATCH as i64], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(CommandError::database)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(CommandError::database)?;
        rows
    };
    if queued.is_empty() {
        return Ok(0);
    }

    let mut items = Vec::with_capacity(queued.len());
    for (entity, record_id, op, changed_at) in &queued {
        if spec(entity).is_none() {
            continue;
        }
        if op == "delete" {
            items.push(json!({
                "entity": entity,
                "record_id": record_id,
                "deleted": true,
                "updated_at": changed_at,
                "device_id": device,
            }));
            continue;
        }
        match read_row(connection, entity, record_id)? {
            Some(payload) => {
                let updated_at = payload
                    .get("updated_at")
                    .and_then(Value::as_str)
                    .unwrap_or(changed_at);
                items.push(json!({
                    "entity": entity,
                    "record_id": record_id,
                    "payload": payload,
                    "deleted": false,
                    "updated_at": updated_at,
                    "device_id": device,
                }));
            }
            // The row was deleted between the trigger and the push.
            None => items.push(json!({
                "entity": entity,
                "record_id": record_id,
                "deleted": true,
                "updated_at": changed_at,
                "device_id": device,
            })),
        }
    }

    if !items.is_empty() {
        api.post_json(
            "/rest/v1/rpc/sync_push",
            Some(token),
            &json!({ "items": items }),
        )?;
    }

    let transaction = connection
        .unchecked_transaction()
        .map_err(CommandError::database)?;
    for (entity, record_id, _, _) in &queued {
        transaction
            .execute(
                "DELETE FROM sync_outbox WHERE entity = ?1 AND record_id = ?2",
                [entity, record_id],
            )
            .map_err(CommandError::database)?;
    }
    transaction.commit().map_err(CommandError::database)?;
    Ok(items.len())
}

fn read_row(connection: &Connection, entity: &str, id: &str) -> Result<Option<Value>, CommandError> {
    let Some(spec) = spec(entity) else {
        return Ok(None);
    };
    if !table_exists(connection, spec.name) {
        return Ok(None);
    }
    let mut statement = connection
        .prepare(&format!(
            "SELECT * FROM {} WHERE {} = ?1",
            spec.name, spec.id_expr
        ))
        .map_err(CommandError::database)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| (*name).to_owned())
        .collect();
    let mut rows = statement.query([id]).map_err(CommandError::database)?;
    let Some(row) = rows.next().map_err(CommandError::database)? else {
        return Ok(None);
    };
    let mut map = Map::new();
    for (index, name) in names.iter().enumerate() {
        let value = row.get_ref(index).map_err(CommandError::database)?;
        if let Some(value) = sql_to_json(value) {
            map.insert(name.clone(), value);
        }
    }
    Ok(Some(Value::Object(map)))
}

fn sql_to_json(value: ValueRef<'_>) -> Option<Value> {
    match value {
        ValueRef::Null => Some(Value::Null),
        ValueRef::Integer(number) => Some(json!(number)),
        ValueRef::Real(number) => Some(json!(number)),
        ValueRef::Text(bytes) => Some(Value::String(
            String::from_utf8_lossy(bytes).into_owned(),
        )),
        // No synced table stores blobs; skip rather than invent an encoding.
        ValueRef::Blob(_) => None,
    }
}

fn json_to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(flag) => SqlValue::Integer(i64::from(*flag)),
        Value::Number(number) => number
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| number.as_f64().map(SqlValue::Real))
            .unwrap_or(SqlValue::Null),
        Value::String(text) => SqlValue::Text(text.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn pull(
    connection: &mut Connection,
    api: &Api,
    token: &str,
) -> Result<(usize, Vec<String>), CommandError> {
    let mut cursor = state::get(connection, state::KEY_CURSOR).unwrap_or_default();
    let mut total = 0;
    let mut touched: Vec<String> = Vec::new();
    loop {
        let mut path = format!(
            "/rest/v1/sync_records?select=entity,record_id,payload,deleted,updated_at,server_updated_at\
             &order=server_updated_at.asc&limit={PULL_PAGE}"
        );
        if !cursor.is_empty() {
            path.push_str("&server_updated_at=gt.");
            path.push_str(&encode_query_value(&cursor));
        }
        let page = api.get_json(&path, Some(token))?;
        let rows = page.as_array().cloned().unwrap_or_default();
        if rows.is_empty() {
            break;
        }
        let count = rows.len();
        apply_batch(connection, &rows)?;
        for row in &rows {
            if let Some(entity) = row.get("entity").and_then(Value::as_str) {
                if !touched.iter().any(|seen| seen == entity) {
                    touched.push(entity.to_owned());
                }
            }
        }
        if let Some(last) = rows.last().and_then(|row| row.get("server_updated_at")) {
            if let Some(last) = last.as_str() {
                cursor = last.to_owned();
                state::set(connection, state::KEY_CURSOR, &cursor).map_err(CommandError::database)?;
            }
        }
        total += count;
        if count < PULL_PAGE {
            break;
        }
    }
    Ok((total, touched))
}

fn apply_batch(connection: &mut Connection, rows: &[Value]) -> Result<(), CommandError> {
    let transaction = connection.transaction().map_err(CommandError::database)?;
    // The guard row makes the triggers on the synced tables ignore our writes,
    // so applying a remote change never queues it back for upload.
    transaction
        .execute(
            "INSERT OR REPLACE INTO sync_guard(id, reason) VALUES (1, 'apply')",
            [],
        )
        .map_err(CommandError::database)?;
    let mut ordered: Vec<&Value> = rows.iter().collect();
    ordered.sort_by_key(|row| rank(row.get("entity").and_then(Value::as_str).unwrap_or_default()));
    for row in ordered {
        apply_one(&transaction, row)?;
    }
    transaction
        .execute("DELETE FROM sync_guard", [])
        .map_err(CommandError::database)?;
    transaction.commit().map_err(CommandError::database)?;
    Ok(())
}

fn local_updated_at(
    transaction: &Transaction<'_>,
    entity: &str,
    id: &str,
) -> Result<Option<String>, CommandError> {
    let Some(spec) = spec(entity) else {
        return Ok(None);
    };
    if !spec.clocked || !table_exists(transaction, spec.name) {
        return Ok(None);
    }
    transaction
        .query_row(
            &format!(
                "SELECT updated_at FROM {} WHERE {} = ?1",
                spec.name, spec.id_expr
            ),
            [id],
            |row| row.get::<_, String>(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(CommandError::database(other)),
        })
}

fn apply_one(transaction: &Transaction<'_>, row: &Value) -> Result<(), CommandError> {
    let entity = row.get("entity").and_then(Value::as_str).unwrap_or_default();
    let Some(spec) = spec(entity) else {
        return Ok(());
    };
    if !table_exists(transaction, spec.name) {
        return Ok(());
    }
    let record_id = row
        .get("record_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if record_id.is_empty() {
        return Ok(());
    }
    let remote_updated = row
        .get("updated_at")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let local_updated = local_updated_at(transaction, entity, record_id)?;
    // Last write wins. A local edit newer than the remote row stays put; the
    // outbox will push it on the next run.
    if let Some(local) = local_updated.as_deref() {
        if local > remote_updated {
            return Ok(());
        }
    }
    if row.get("deleted").and_then(Value::as_bool).unwrap_or(false) {
        transaction
            .execute(
                &format!("DELETE FROM {} WHERE {} = ?1", spec.name, spec.id_expr),
                [record_id],
            )
            .map_err(CommandError::database)?;
        drop_pending(transaction, entity, record_id)?;
        return Ok(());
    }
    let Some(payload) = row.get("payload").and_then(Value::as_object) else {
        return Ok(());
    };
    upsert(transaction, entity, payload)?;
    // The remote row is at least as new as anything queued locally, so the
    // pending upload for it is obsolete.
    drop_pending(transaction, entity, record_id)
}

fn drop_pending(
    transaction: &Transaction<'_>,
    entity: &str,
    record_id: &str,
) -> Result<(), CommandError> {
    transaction
        .execute(
            "DELETE FROM sync_outbox WHERE entity = ?1 AND record_id = ?2",
            [entity, record_id],
        )
        .map_err(CommandError::database)?;
    Ok(())
}

fn upsert(
    transaction: &Transaction<'_>,
    entity: &str,
    payload: &Map<String, Value>,
) -> Result<(), CommandError> {
    let Some(spec) = spec(entity) else {
        return Ok(());
    };
    let columns: Vec<String> = {
        let mut statement = transaction
            .prepare(&format!("PRAGMA table_info({})", spec.name))
            .map_err(CommandError::database)?;
        let names = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(CommandError::database)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(CommandError::database)?;
        names
    };
    let mut names = Vec::new();
    let mut values = Vec::new();
    for (key, value) in payload {
        if !columns.iter().any(|column| column == key) {
            continue;
        }
        names.push(key.clone());
        values.push(json_to_sql(value));
    }
    if !spec
        .key_columns
        .iter()
        .all(|key| names.iter().any(|name| name == key))
    {
        return Ok(());
    }
    let placeholders: Vec<String> = (1..=names.len()).map(|index| format!("?{index}")).collect();
    let updates: Vec<String> = names
        .iter()
        .filter(|name| !spec.key_columns.contains(&name.as_str()))
        .map(|name| format!("{name} = excluded.{name}"))
        .collect();
    let target = spec.key_columns.join(", ");
    let conflict = if updates.is_empty() {
        format!("ON CONFLICT({target}) DO NOTHING")
    } else {
        format!("ON CONFLICT({target}) DO UPDATE SET {}", updates.join(", "))
    };
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({}) {conflict}",
        spec.name,
        names.join(", "),
        placeholders.join(", ")
    );
    transaction
        .execute(&sql, params_from_iter(values))
        .map_err(CommandError::database)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::apply_batch;
    use crate::db::migrate;
    use rusqlite::Connection;
    use serde_json::json;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn outbox_count(connection: &Connection, record_id: &str) -> i64 {
        connection
            .query_row(
                "SELECT COUNT(*) FROM sync_outbox WHERE record_id = ?1",
                [record_id],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn note_row(record_id: &str, content: &str, updated_at: &str) -> serde_json::Value {
        json!({
            "entity": "notes",
            "record_id": record_id,
            "deleted": false,
            "updated_at": updated_at,
            "payload": {
                "id": record_id,
                "content": content,
                "color": "#4F55DA",
                "pinned": 0,
                "style_variant": 0,
                "icon": "",
                "created_at": updated_at,
                "updated_at": updated_at
            }
        })
    }

    #[test]
    fn local_writes_are_queued_for_upload() {
        let connection = database();
        connection
            .execute(
                "INSERT INTO notes(id,content,color,pinned,created_at,updated_at)
                 VALUES ('n1','محلی','#4F55DA',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')",
                [],
            )
            .unwrap();
        assert_eq!(outbox_count(&connection, "n1"), 1);
        let op: String = connection
            .query_row(
                "SELECT op FROM sync_outbox WHERE record_id = 'n1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(op, "upsert");
    }

    #[test]
    fn applying_a_remote_row_does_not_echo_back_into_the_outbox() {
        let mut connection = database();
        apply_batch(
            &mut connection,
            &[note_row("n2", "از سرور", "2026-02-01T00:00:00.000Z")],
        )
        .unwrap();
        let content: String = connection
            .query_row("SELECT content FROM notes WHERE id = 'n2'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(content, "از سرور");
        assert_eq!(outbox_count(&connection, "n2"), 0);
    }

    #[test]
    fn a_newer_local_edit_survives_an_older_remote_row() {
        let mut connection = database();
        connection
            .execute(
                "INSERT INTO notes(id,content,color,pinned,created_at,updated_at)
                 VALUES ('n3','تازه‌تر','#4F55DA',0,'2026-03-02T00:00:00.000Z','2026-03-02T00:00:00.000Z')",
                [],
            )
            .unwrap();
        apply_batch(
            &mut connection,
            &[note_row("n3", "قدیمی‌تر", "2026-03-01T00:00:00.000Z")],
        )
        .unwrap();
        let content: String = connection
            .query_row("SELECT content FROM notes WHERE id = 'n3'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(content, "تازه‌تر");
    }

    #[test]
    fn a_remote_delete_removes_the_local_row() {
        let mut connection = database();
        connection
            .execute(
                "INSERT INTO notes(id,content,color,pinned,created_at,updated_at)
                 VALUES ('n4','حذف‌شدنی','#4F55DA',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')",
                [],
            )
            .unwrap();
        apply_batch(
            &mut connection,
            &[json!({
                "entity": "notes",
                "record_id": "n4",
                "deleted": true,
                "updated_at": "2026-04-01T00:00:00.000Z"
            })],
        )
        .unwrap();
        let remaining: i64 = connection
            .query_row("SELECT COUNT(*) FROM notes WHERE id = 'n4'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(remaining, 0);
        assert_eq!(outbox_count(&connection, "n4"), 0);
    }

    #[test]
    fn unknown_entities_are_ignored() {
        let mut connection = database();
        apply_batch(
            &mut connection,
            &[json!({
                "entity": "secrets",
                "record_id": "x",
                "deleted": false,
                "updated_at": "2026-01-01T00:00:00.000Z",
                "payload": {"id": "x"}
            })],
        )
        .unwrap();
        assert_eq!(outbox_count(&connection, "x"), 0);
    }
}
