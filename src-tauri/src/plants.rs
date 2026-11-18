//! 植物浇水记录存储层：植物 CRUD + 浇水打卡。
//!
//! 一次浇水只写 `last_watered_at`，不写历史流水：植物的外观完全由「上次浇水时间 +
//! 浇水间隔」实时推导，界面不需要读日志就能知道该不该浇水，也就不会出现「日志与状态
//! 不一致」的问题。
//!
//! 物种只存稳定 id（monstera / snakePlant / yucca / croton / zzPlant），插画与动画
//! 在界面层按 id 选择，因此改界面语言不会改变植物。

use crate::db::AppDb;
use crate::error::CommandError;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

/// 物种白名单：与前端 `src/plants/plant-model.ts` 保持一致。
pub const PLANT_SPECIES: &[&str] = &["monstera", "snakePlant", "yucca", "croton", "zzPlant"];

pub const PLANT_INTERVAL_MIN_DAYS: i64 = 1;
pub const PLANT_INTERVAL_MAX_DAYS: i64 = 60;
pub const PLANT_NAME_MAX_CHARS: usize = 60;
/// 上限避免模块变成一个无法浏览的长列表。
pub const MAX_PLANTS: i64 = 200;

const PLANT_COLUMNS: &str =
    "id,name,species,watering_interval_days,last_watered_at,created_at,updated_at";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct Plant {
    pub id: String,
    pub name: String,
    pub species: String,
    pub watering_interval_days: i64,
    pub last_watered_at: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct PlantDraft {
    pub name: String,
    pub species: String,
    pub watering_interval_days: i64,
    /// 新建时由前端给出当前时间；编辑时保留原值，只有「浇水」按钮会改写它。
    pub last_watered_at: String,
}

fn read_plant(row: &Row<'_>) -> rusqlite::Result<Plant> {
    Ok(Plant {
        id: row.get(0)?,
        name: row.get(1)?,
        species: row.get(2)?,
        watering_interval_days: row.get(3)?,
        last_watered_at: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// 时间戳必须是可解析的 RFC 3339：植物状态由它推导，脏数据会让整株植物永远「过干」。
fn validate_timestamp(value: &str, field: &str) -> Result<String, CommandError> {
    let raw = value.trim();
    let parsed = chrono::DateTime::parse_from_rfc3339(raw)
        .map_err(|_| CommandError::validation(field, "浇水时间无效。"))?;
    Ok(parsed.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn validate_draft(draft: &PlantDraft) -> Result<(String, String, i64, String), CommandError> {
    let name = draft.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(CommandError::validation("name", "植物名称不能为空。"));
    }
    if name.chars().count() > PLANT_NAME_MAX_CHARS {
        return Err(CommandError::validation("name", "植物名称过长。"));
    }
    let species = draft.species.trim();
    if !PLANT_SPECIES.contains(&species) {
        return Err(CommandError::validation("species", "请选择植物品种。"));
    }
    if !(PLANT_INTERVAL_MIN_DAYS..=PLANT_INTERVAL_MAX_DAYS)
        .contains(&draft.watering_interval_days)
    {
        return Err(CommandError::validation(
            "wateringIntervalDays",
            "浇水间隔需在 1 到 60 天之间。",
        ));
    }
    let last_watered_at = validate_timestamp(&draft.last_watered_at, "lastWateredAt")?;
    Ok((name, species.to_owned(), draft.watering_interval_days, last_watered_at))
}

pub fn list(connection: &Connection) -> Result<Vec<Plant>, CommandError> {
    let sql = format!("SELECT {PLANT_COLUMNS} FROM plants ORDER BY created_at ASC");
    let mut statement = connection.prepare(&sql).map_err(CommandError::database)?;
    let rows = statement
        .query_map([], read_plant)
        .map_err(CommandError::database)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(CommandError::database)?);
    }
    Ok(out)
}

fn fetch_one(connection: &Connection, id: &str) -> Result<Plant, CommandError> {
    let sql = format!("SELECT {PLANT_COLUMNS} FROM plants WHERE id = ?1");
    connection
        .query_row(&sql, params![id], read_plant)
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => CommandError::validation("id", "植物不存在。"),
            other => CommandError::database(other),
        })
}

pub fn create(connection: &mut Connection, draft: PlantDraft) -> Result<Plant, CommandError> {
    let (name, species, interval, last_watered_at) = validate_draft(&draft)?;
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM plants", [], |row| row.get(0))
        .map_err(CommandError::database)?;
    if count >= MAX_PLANTS {
        return Err(CommandError::validation("name", "植物数量已达上限。"));
    }
    let id = Uuid::new_v4().to_string();
    let now = now_utc();
    connection
        .execute(
            "INSERT INTO plants(id,name,species,watering_interval_days,last_watered_at,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?6)",
            params![id, name, species, interval, last_watered_at, now],
        )
        .map_err(CommandError::database)?;
    fetch_one(connection, &id)
}

pub fn update(connection: &mut Connection, id: &str, draft: PlantDraft) -> Result<Plant, CommandError> {
    let (name, species, interval, last_watered_at) = validate_draft(&draft)?;
    let now = now_utc();
    let affected = connection
        .execute(
            "UPDATE plants SET name=?2,species=?3,watering_interval_days=?4,last_watered_at=?5,updated_at=?6 WHERE id=?1",
            params![id, name, species, interval, last_watered_at, now],
        )
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::validation("id", "植物不存在。"));
    }
    fetch_one(connection, id)
}

pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let affected = connection
        .execute("DELETE FROM plants WHERE id=?1", params![id])
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::validation("id", "植物不存在。"));
    }
    Ok(())
}

/// 打卡浇水：把「上次浇水」推到给定时刻。时间由调用方给出，测试才能固定时钟。
pub fn water(connection: &mut Connection, id: &str, watered_at: &str) -> Result<Plant, CommandError> {
    let last_watered_at = validate_timestamp(watered_at, "wateredAt")?;
    let now = now_utc();
    let affected = connection
        .execute(
            "UPDATE plants SET last_watered_at=?2,updated_at=?3 WHERE id=?1",
            params![id, last_watered_at, now],
        )
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::validation("id", "植物不存在。"));
    }
    fetch_one(connection, id)
}

pub fn migrate(transaction: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(
        "CREATE TABLE plants (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            species TEXT NOT NULL,
            watering_interval_days INTEGER NOT NULL CHECK (watering_interval_days BETWEEN 1 AND 60),
            last_watered_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE INDEX idx_plants_last_watered ON plants(last_watered_at);",
    )
}

#[tauri::command]
pub fn list_plants(db: State<'_, AppDb>) -> Result<Vec<Plant>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}

#[tauri::command]
pub fn create_plant(db: State<'_, AppDb>, draft: PlantDraft) -> Result<Plant, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create(&mut connection, draft)
}

#[tauri::command]
pub fn update_plant(db: State<'_, AppDb>, id: String, draft: PlantDraft) -> Result<Plant, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_plant(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)
}

#[tauri::command]
pub fn water_plant(db: State<'_, AppDb>, id: String, watered_at: String) -> Result<Plant, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    water(&mut connection, &id, &watered_at)
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

    fn draft(name: &str, species: &str, days: i64, watered_at: &str) -> PlantDraft {
        PlantDraft {
            name: name.into(),
            species: species.into(),
            watering_interval_days: days,
            last_watered_at: watered_at.into(),
        }
    }

    #[test]
    fn create_list_update_delete_roundtrip() {
        let mut connection = memory_db();
        let monstera = create(
            &mut connection,
            draft("客厅龟背竹", "monstera", 7, "2026-03-02T10:00:00Z"),
        )
        .unwrap();
        assert_eq!(monstera.name, "客厅龟背竹");
        assert_eq!(monstera.species, "monstera");
        assert_eq!(monstera.watering_interval_days, 7);

        create(&mut connection, draft("虎尾兰", "snakePlant", 14, "2026-03-01T08:00:00Z")).unwrap();
        assert_eq!(list(&connection).unwrap().len(), 2);

        let updated = update(
            &mut connection,
            &monstera.id,
            draft("客厅龟背竹", "monstera", 10, "2026-03-02T10:00:00Z"),
        )
        .unwrap();
        assert_eq!(updated.watering_interval_days, 10);

        delete(&mut connection, &monstera.id).unwrap();
        let remaining = list(&connection).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].species, "snakePlant");
    }

    #[test]
    fn create_rejects_blank_name_unknown_species_and_bad_interval() {
        let mut connection = memory_db();
        let cases = [
            (draft("   ", "monstera", 7, "2026-03-02T10:00:00Z"), "name"),
            (draft("绿萝", "pothos", 7, "2026-03-02T10:00:00Z"), "species"),
            (draft("绿萝", "monstera", 0, "2026-03-02T10:00:00Z"), "wateringIntervalDays"),
            (draft("绿萝", "monstera", 61, "2026-03-02T10:00:00Z"), "wateringIntervalDays"),
            (draft("绿萝", "monstera", 7, "not-a-date"), "lastWateredAt"),
        ];
        for (case, field) in cases {
            let error = create(&mut connection, case).unwrap_err();
            assert_eq!(error.field.as_deref(), Some(field));
        }
        assert!(list(&connection).unwrap().is_empty());
    }

    #[test]
    fn names_are_collapsed_and_trimmed() {
        let mut connection = memory_db();
        let plant = create(
            &mut connection,
            draft("  龟背   竹  ", "monstera", 7, "2026-03-02T10:00:00Z"),
        )
        .unwrap();
        assert_eq!(plant.name, "龟背 竹");
    }

    #[test]
    fn watering_moves_the_last_watered_timestamp_only() {
        let mut connection = memory_db();
        let plant = create(
            &mut connection,
            draft("柠檬树", "croton", 5, "2026-03-01T09:00:00Z"),
        )
        .unwrap();
        let watered = water(&mut connection, &plant.id, "2026-03-06T07:30:00Z").unwrap();
        assert_eq!(watered.last_watered_at, "2026-03-06T07:30:00Z");
        assert_eq!(watered.watering_interval_days, 5);
        assert_eq!(watered.name, "柠檬树");
        assert_eq!(watered.created_at, plant.created_at);
    }

    #[test]
    fn unknown_ids_report_a_validation_error() {
        let mut connection = memory_db();
        let cases = [
            update(&mut connection, "missing", draft("x", "monstera", 7, "2026-03-02T10:00:00Z"))
                .unwrap_err(),
            delete(&mut connection, "missing").unwrap_err(),
            water(&mut connection, "missing", "2026-03-02T10:00:00Z").unwrap_err(),
        ];
        for error in cases {
            assert_eq!(error.field.as_deref(), Some("id"));
        }
    }

    #[test]
    fn migration_keeps_existing_rows_when_reapplied_from_scratch() {
        // 迁移只建表：重复执行旧版本迁移后再跑一次 plants 迁移，表内容不受影响。
        let mut connection = memory_db();
        let plant = create(
            &mut connection,
            draft("龟背竹", "monstera", 7, "2026-03-02T10:00:00Z"),
        )
        .unwrap();
        assert_eq!(fetch_one(&connection, &plant.id).unwrap(), plant);
    }
}
