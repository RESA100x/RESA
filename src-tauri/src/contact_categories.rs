//! 电话簿分组存储层：分组 CRUD。
//!
//! 分组是用户自定义记录，拥有名称与颜色 —— 和日历分类一样，「分组」与「颜色」
//! 是同一个概念，所以联系人只存 `category_id`，颜色永远来自分组本身，不需要
//! 在联系人上快照一份。
//!
//! 删除分组只影响引用它的联系人：把它们退回「无分组」，联系人本身一个都不删。

use crate::db::AppDb;
use crate::error::CommandError;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

pub const CATEGORY_NAME_MAX_CHARS: usize = 40;
/// 上限避免下拉失控。
pub const MAX_CATEGORIES: i64 = 100;

const CATEGORY_COLUMNS: &str = "id,name,color,position,created_at,updated_at";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ContactCategory {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ContactCategoryDraft {
    pub name: String,
    pub color: String,
}

fn read_category(row: &Row<'_>) -> rusqlite::Result<ContactCategory> {
    Ok(ContactCategory {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        position: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// 校验并规范化分组草稿，返回 (name, color)。
fn validate_draft(draft: &ContactCategoryDraft) -> Result<(String, String), CommandError> {
    let name = draft.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(CommandError::validation("name", "分组名称不能为空。"));
    }
    if name.chars().count() > CATEGORY_NAME_MAX_CHARS {
        return Err(CommandError::validation("name", "分组名称过长。"));
    }
    let color = crate::color::normalize_hex(&draft.color)
        .ok_or_else(|| CommandError::validation("color", "请选择有效颜色。"))?;
    Ok((name, color))
}

/// 列出全部分组，按 position 升序（创建时间兜底）。
pub fn list(connection: &Connection) -> Result<Vec<ContactCategory>, CommandError> {
    let sql = format!(
        "SELECT {CATEGORY_COLUMNS} FROM contact_categories ORDER BY position ASC, created_at ASC"
    );
    let mut statement = connection.prepare(&sql).map_err(CommandError::database)?;
    let rows = statement
        .query_map([], read_category)
        .map_err(CommandError::database)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(CommandError::database)?);
    }
    Ok(out)
}

fn fetch_one(connection: &Connection, id: &str) -> Result<ContactCategory, CommandError> {
    let sql = format!("SELECT {CATEGORY_COLUMNS} FROM contact_categories WHERE id = ?1");
    connection
        .query_row(&sql, params![id], read_category)
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => CommandError::validation("id", "分组不存在。"),
            other => CommandError::database(other),
        })
}

/// 新建分组，追加到列表末尾。超过 `MAX_CATEGORIES` 拒绝。
pub fn create(
    connection: &mut Connection,
    draft: ContactCategoryDraft,
) -> Result<ContactCategory, CommandError> {
    let (name, color) = validate_draft(&draft)?;
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM contact_categories", [], |row| {
            row.get(0)
        })
        .map_err(CommandError::database)?;
    if count >= MAX_CATEGORIES {
        return Err(CommandError::validation("name", "分组数量已达上限。"));
    }
    let next_position: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM contact_categories",
            [],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    let id = Uuid::new_v4().to_string();
    let now = now_utc();
    connection
        .execute(
            "INSERT INTO contact_categories(id,name,color,position,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?5)",
            params![id, name, color, next_position, now],
        )
        .map_err(CommandError::database)?;
    fetch_one(connection, &id)
}

pub fn update(
    connection: &mut Connection,
    id: &str,
    draft: ContactCategoryDraft,
) -> Result<ContactCategory, CommandError> {
    let (name, color) = validate_draft(&draft)?;
    let now = now_utc();
    let affected = connection
        .execute(
            "UPDATE contact_categories SET name=?2,color=?3,updated_at=?4 WHERE id=?1",
            params![id, name, color, now],
        )
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::validation("id", "分组不存在。"));
    }
    fetch_one(connection, id)
}

/// 删除分组并把引用它的联系人退回「无分组」。
///
/// 表上有 `ON DELETE SET NULL`，这里仍然显式更新一次：外键开关在某些连接上可能
/// 是关的，而「删分组不删联系人」是产品承诺，不能依赖会话设置。
pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection.transaction().map_err(CommandError::database)?;
    let affected = transaction
        .execute("DELETE FROM contact_categories WHERE id=?1", params![id])
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::validation("id", "分组不存在。"));
    }
    transaction
        .execute(
            "UPDATE contacts SET category_id=NULL WHERE category_id=?1",
            params![id],
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(CommandError::database)
}

#[tauri::command]
pub fn list_contact_categories(db: State<'_, AppDb>) -> Result<Vec<ContactCategory>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}

#[tauri::command]
pub fn create_contact_category(
    db: State<'_, AppDb>,
    draft: ContactCategoryDraft,
) -> Result<ContactCategory, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create(&mut connection, draft)
}

#[tauri::command]
pub fn update_contact_category(
    db: State<'_, AppDb>,
    id: String,
    draft: ContactCategoryDraft,
) -> Result<ContactCategory, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_contact_category(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)
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

    fn draft(name: &str, color: &str) -> ContactCategoryDraft {
        ContactCategoryDraft {
            name: name.into(),
            color: color.into(),
        }
    }

    #[test]
    fn create_list_update_delete_roundtrip() {
        let mut connection = memory_db();
        let work = create(&mut connection, draft("همکاران", "#4FC9DA")).unwrap();
        assert_eq!(work.name, "همکاران");
        assert_eq!(work.color, "#4FC9DA");
        assert_eq!(work.position, 0);

        let family = create(&mut connection, draft("خانواده", "#F06445")).unwrap();
        assert_eq!(family.position, 1);
        let listed = list(&connection).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, work.id);

        let updated = update(&mut connection, &work.id, draft("واحد فنی", "#4F55DA")).unwrap();
        assert_eq!(updated.name, "واحد فنی");
        assert_eq!(updated.color, "#4F55DA");

        delete(&mut connection, &work.id).unwrap();
        assert_eq!(list(&connection).unwrap().len(), 1);
    }

    #[test]
    fn create_rejects_blank_name_and_bad_color() {
        let mut connection = memory_db();
        assert_eq!(
            create(&mut connection, draft("   ", "#4FC9DA"))
                .unwrap_err()
                .field
                .as_deref(),
            Some("name")
        );
        assert_eq!(
            create(&mut connection, draft("همکاران", "not-a-color"))
                .unwrap_err()
                .field
                .as_deref(),
            Some("color")
        );
        assert!(list(&connection).unwrap().is_empty());
    }

    #[test]
    fn deleting_a_category_keeps_its_contacts_and_clears_the_link() {
        let mut connection = memory_db();
        let group = create(&mut connection, draft("همکاران", "#4FC9DA")).unwrap();
        let mut member = crate::contacts::ContactDraft {
            name: "مینا".into(),
            extension: "1012".into(),
            category_id: Some(group.id.clone()),
            is_internal: true,
            ..Default::default()
        };
        let contact = crate::contacts::create(&mut connection, member.clone()).unwrap();

        delete(&mut connection, &group.id).unwrap();
        let rows = crate::contacts::list(&connection).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, contact.id);
        assert_eq!(rows[0].category_id, None);

        // 分组没了以后，草稿里那个 id 就成了脏数据，必须被拒绝。
        member.category_id = Some(group.id);
        assert_eq!(
            crate::contacts::create(&mut connection, member)
                .unwrap_err()
                .field
                .as_deref(),
            Some("categoryId")
        );
    }
}
