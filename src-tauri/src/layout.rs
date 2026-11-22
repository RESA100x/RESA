use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::ModuleLayoutEntry;
use rusqlite::{params, Connection, Row, TransactionBehavior};
use tauri::State;

// Rows saved before per-monitor layouts existed live on this monitor key. It is
// also the fallback shown on any monitor that has never been customised.
const LEGACY_MONITOR: &str = "";
// A row with an empty id is never rendered; it only records that a monitor has
// a saved layout, so clearing every module from a monitor stays empty instead
// of falling back to the legacy layout.
const CUSTOMISED_MARKER: &str = "";

fn read_entry(row: &Row<'_>) -> rusqlite::Result<ModuleLayoutEntry> {
    Ok(ModuleLayoutEntry {
        id: row.get(0)?,
        x: row.get(1)?,
        y: row.get(2)?,
        w: row.get(3)?,
        h: row.get(4)?,
    })
}

fn query(connection: &Connection, monitor: &str) -> Result<Vec<ModuleLayoutEntry>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT id, x, y, w, h FROM module_layout
             WHERE monitor = ?1 AND id <> ''
             ORDER BY position ASC, id ASC",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([monitor], read_entry)
        .map_err(CommandError::database)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

fn is_customised(connection: &Connection, monitor: &str) -> Result<bool, CommandError> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM module_layout WHERE monitor = ?1 AND id = '')",
            [monitor],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value != 0)
        .map_err(CommandError::database)
}

// `monitor = None` keeps the original single global layout. `Some(id)` reads
// that monitor's layout, falling back to the global one until the user edits
// that monitor for the first time.
pub fn list(
    connection: &Connection,
    monitor: Option<&str>,
) -> Result<Vec<ModuleLayoutEntry>, CommandError> {
    let Some(monitor) = monitor else {
        return query(connection, LEGACY_MONITOR);
    };
    if monitor != LEGACY_MONITOR && !is_customised(connection, monitor)? {
        return query(connection, LEGACY_MONITOR);
    }
    query(connection, monitor)
}

pub fn replace(
    connection: &mut Connection,
    entries: &[ModuleLayoutEntry],
    monitor: Option<&str>,
) -> Result<Vec<ModuleLayoutEntry>, CommandError> {
    let monitor = monitor.unwrap_or(LEGACY_MONITOR);
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    transaction
        .execute("DELETE FROM module_layout WHERE monitor = ?1", [monitor])
        .map_err(CommandError::database)?;
    transaction
        .execute(
            "INSERT INTO module_layout(id, monitor, x, y, w, h, position)
             VALUES (?1, ?2, 0, 0, 0, 0, -1)",
            params![CUSTOMISED_MARKER, monitor],
        )
        .map_err(CommandError::database)?;
    for (index, entry) in entries.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO module_layout(id, monitor, x, y, w, h, position)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    entry.id,
                    monitor,
                    entry.x,
                    entry.y,
                    entry.w,
                    entry.h,
                    index as i64
                ],
            )
            .map_err(CommandError::database)?;
    }
    transaction.commit().map_err(CommandError::database)?;
    list(connection, Some(monitor))
}

#[tauri::command]
pub fn list_module_layout(
    db: State<'_, AppDb>,
    monitor: Option<String>,
) -> Result<Vec<ModuleLayoutEntry>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection, monitor.as_deref())
}

#[tauri::command]
pub fn save_module_layout(
    db: State<'_, AppDb>,
    layout: Vec<ModuleLayoutEntry>,
    monitor: Option<String>,
) -> Result<Vec<ModuleLayoutEntry>, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    replace(&mut connection, &layout, monitor.as_deref())
}

#[cfg(test)]
mod tests {
    use super::{list, replace};
    use crate::db::migrate;
    use crate::models::ModuleLayoutEntry;
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    #[test]
    fn migration_seeds_the_default_layout() {
        let connection = database();
        let ids: Vec<String> = list(&connection, None)
            .unwrap()
            .into_iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(ids, vec!["calendar", "matrix", "notes"]);
    }

    #[test]
    fn replace_persists_and_orders_entries() {
        let mut connection = database();
        let entries = vec![
            ModuleLayoutEntry {
                id: "notes".into(),
                x: 0,
                y: 0,
                w: 4,
                h: 3,
            },
            ModuleLayoutEntry {
                id: "calendar".into(),
                x: 4,
                y: 0,
                w: 8,
                h: 8,
            },
        ];
        let saved = replace(&mut connection, &entries, None).unwrap();
        assert_eq!(saved, entries);
        assert_eq!(list(&connection, None).unwrap(), entries);
    }

    #[test]
    fn replace_with_empty_clears_the_layout() {
        let mut connection = database();
        assert!(replace(&mut connection, &[], None).unwrap().is_empty());
        assert!(list(&connection, None).unwrap().is_empty());
    }

    #[test]
    fn an_unedited_monitor_falls_back_to_the_global_layout() {
        let connection = database();
        let fallback = list(&connection, None).unwrap();
        assert_eq!(list(&connection, Some("\\\\.\\DISPLAY2")).unwrap(), fallback);
    }

    #[test]
    fn a_monitor_keeps_its_own_layout_without_touching_the_global_one() {
        let mut connection = database();
        let global = list(&connection, None).unwrap();
        let entries = vec![ModuleLayoutEntry {
            id: "calendar".into(),
            x: 0,
            y: 0,
            w: 12,
            h: 8,
        }];
        assert_eq!(
            replace(&mut connection, &entries, Some("\\\\.\\DISPLAY2")).unwrap(),
            entries
        );
        assert_eq!(
            list(&connection, Some("\\\\.\\DISPLAY2")).unwrap(),
            entries
        );
        assert_eq!(list(&connection, None).unwrap(), global);
    }

    #[test]
    fn clearing_a_monitor_keeps_it_empty_instead_of_falling_back() {
        let mut connection = database();
        replace(&mut connection, &[], Some("\\\\.\\DISPLAY2")).unwrap();
        assert!(list(&connection, Some("\\\\.\\DISPLAY2")).unwrap().is_empty());
        // The global layout is still intact for every other monitor.
        assert_eq!(list(&connection, None).unwrap().len(), 3);
    }
}
