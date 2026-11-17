//! Axelor 接入（只读同步）。
//!
//! Axelor 是自建 ERP/CRM：任务、日程都是它自己的模型（如
//! `com.axelor.apps.project.db.ProjectTask`）。这里不碰它的数据库，而是走官方
//! REST 接口 `GET /ws/rest/<model>`（`API-KEY` 头认证，见 Axelor ADK 文档），
//! 把记录映射成与 ICS 相同的 `ExternalInstance`，于是日历渲染、提醒、去重全部
//! 复用现有管线。
//!
//! 写入（把 RESA 的日程推回 Axelor）需要 `PUT /ws/rest/<model>/<id>` 加乐观锁
//! `version`，且各实例的字段权限不同，因此本版只做读取；订阅在界面上是只读的。

use crate::db::AppDb;
use crate::error::CommandError;
use crate::ics_parser::ExternalInstance;
use crate::models::{AxelorModel, AxelorServer, CalendarSubscription};
use rusqlite::{params, Connection};
use serde_json::Value;
use tauri::{Manager, State};
use uuid::Uuid;

/// 默认模型：Axelor 的 Project 模块任务。用户可在界面上换成任意模型。
pub const DEFAULT_MODEL: &str = "com.axelor.apps.project.db.ProjectTask";

/// 每页条数与最多翻页数：200 × 10 = 2000 条，足够覆盖一个人的任务/日程，
/// 同时给一次同步设了硬上限，避免超大实例把内存和 UI 拖死。
const PAGE_LIMIT: usize = 200;
const MAX_PAGES: usize = 10;

/// 记录里可能承载标题的字段，按优先级排列。
const TITLE_FIELDS: &[&str] = &["name", "subject", "title", "fullName", "reference"];
/// 起始时间字段（任务用 plannedStartDate，日程用 startDateTime/startDate）。
const START_FIELDS: &[&str] = &[
    "plannedStartDate",
    "startDateTime",
    "startDate",
    "fromDate",
    "date",
];
/// 结束时间字段。
const END_FIELDS: &[&str] = &[
    "plannedEndDate",
    "endDateTime",
    "endDate",
    "toDate",
    "dueDate",
    "deadline",
];

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// 规范化并校验用户填写的服务器地址：只接受 http/https，去掉末尾 `/`，
/// 不允许查询串/片段（`net::get_axelor_json` 还会再校验一次）。
pub fn normalize_base_url(raw: &str) -> Result<String, CommandError> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(CommandError::validation("baseUrl", "请填写服务器地址。"));
    }
    let parsed =
        reqwest::Url::parse(trimmed).map_err(|_| CommandError::validation("baseUrl", "服务器地址无效。"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(CommandError::validation(
            "baseUrl",
            "服务器地址需形如 https://axelor.example.com。",
        ));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(CommandError::validation(
            "baseUrl",
            "服务器地址不能带查询参数。",
        ));
    }
    Ok(trimmed.to_owned())
}

fn read_server(row: &rusqlite::Row<'_>) -> rusqlite::Result<AxelorServer> {
    Ok(AxelorServer {
        id: row.get(0)?,
        name: row.get(1)?,
        base_url: row.get(2)?,
        username: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

pub fn list_servers(connection: &Connection) -> Result<Vec<AxelorServer>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT id,name,base_url,username,created_at,updated_at
               FROM axelor_servers ORDER BY created_at ASC",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], read_server)
        .map_err(CommandError::database)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(CommandError::database)?);
    }
    Ok(out)
}

/// 按地址复用服务器记录：同一地址再次订阅时更新 API key / 用户名，而不是
/// 每建一个订阅就多一条服务器。API key 用 DPAPI 加密后落库。
pub fn upsert_server(
    connection: &mut Connection,
    base_url: &str,
    api_key: &str,
    username: Option<&str>,
    name: &str,
) -> Result<AxelorServer, CommandError> {
    let base_url = normalize_base_url(base_url)?;
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(CommandError::validation("apiKey", "请填写 API key。"));
    }
    let name = name.trim();
    let name = if name.is_empty() { "Axelor" } else { name };
    let sealed = crate::token_store::protect_secret(api_key)?;
    let now = now_utc();
    let existing: Option<String> = connection
        .query_row(
            "SELECT id FROM axelor_servers WHERE base_url = ?1",
            params![base_url],
            |row| row.get(0),
        )
        .ok();
    let id = match existing {
        Some(id) => {
            connection
                .execute(
                    "UPDATE axelor_servers
                        SET name=?2, api_key_enc=?3, username=?4, updated_at=?5
                      WHERE id=?1",
                    params![id, name, sealed, username, now],
                )
                .map_err(CommandError::database)?;
            id
        }
        None => {
            let id = Uuid::new_v4().to_string();
            connection
                .execute(
                    "INSERT INTO axelor_servers
                        (id,name,base_url,api_key_enc,username,created_at,updated_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?6)",
                    params![id, name, base_url, sealed, username, now],
                )
                .map_err(CommandError::database)?;
            id
        }
    };
    connection
        .query_row(
            "SELECT id,name,base_url,username,created_at,updated_at
               FROM axelor_servers WHERE id=?1",
            params![id],
            read_server,
        )
        .map_err(CommandError::database)
}

/// 读出服务器地址与解密后的 API key（只在后端使用，不返回给前端）。
pub fn server_credentials(
    connection: &Connection,
    server_id: &str,
) -> Result<(String, String), CommandError> {
    let (base_url, sealed): (String, Option<Vec<u8>>) = connection
        .query_row(
            "SELECT base_url, api_key_enc FROM axelor_servers WHERE id=?1",
            params![server_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                CommandError::validation("serverId", "Axelor 服务器不存在。")
            }
            other => CommandError::database(other),
        })?;
    let sealed = sealed.ok_or_else(|| CommandError::validation("apiKey", "该服务器缺少 API key。"))?;
    let api_key = crate::token_store::unprotect_secret(&sealed)?;
    Ok((base_url, api_key))
}

fn http_error(status: u16) -> CommandError {
    let message = match status {
        401 | 403 => "Axelor 拒绝了请求：请检查 API key 与用户权限。",
        404 => "Axelor 找不到该地址或模型。",
        _ => "Axelor 返回了错误状态。",
    };
    CommandError::validation("baseUrl", message)
}

/// 拉取实例里所有可访问的模型名，供用户从下拉框挑选要同步的模型。
pub fn list_models(base_url: &str, api_key: &str) -> Result<Vec<AxelorModel>, CommandError> {
    let base_url = normalize_base_url(base_url)?;
    let (status, body) = crate::net::get_axelor_json(&base_url, "/ws/meta/models", api_key.trim())?;
    if !(200..300).contains(&status) {
        return Err(http_error(status));
    }
    let parsed: Value = serde_json::from_str(&body)
        .map_err(|_| CommandError::validation("baseUrl", "Axelor 返回的不是 JSON。"))?;
    // 元服务直接返回数组；部分版本包在 `data` 里，两种都接受。
    let list = parsed
        .as_array()
        .cloned()
        .or_else(|| parsed.get("data").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    let mut models: Vec<AxelorModel> = list
        .iter()
        .filter_map(|item| {
            let name = item.get("name").and_then(Value::as_str)?.to_owned();
            let title = item
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            Some(AxelorModel { name, title })
        })
        .collect();
    models.sort_by(|a, b| a.name.cmp(&b.name));
    models.dedup_by(|a, b| a.name == b.name);
    Ok(models)
}

/// 一个时间点解析结果：钟面时间、时区、UTC 缓存、是否全天。
struct Point {
    wall: String,
    tz: Option<String>,
    utc: Option<String>,
    all_day: bool,
}

/// Axelor 的日期字段可能是 `2026-11-17`（日期）、`2026-11-17T10:00:00`
/// （无时区）或带偏移的 ISO 时间。带偏移的按 UTC 归一（与 Google/Graph 一致），
/// 无时区的按浮动时间原样展示。
fn parse_point(raw: &str) -> Option<Point> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.len() == 10 {
        let date = chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d").ok()?;
        return Some(Point {
            wall: format!("{}T00:00", date.format("%Y-%m-%d")),
            tz: None,
            utc: None,
            all_day: true,
        });
    }
    if let Ok(instant) = chrono::DateTime::parse_from_rfc3339(raw) {
        let utc = instant.with_timezone(&chrono::Utc);
        return Some(Point {
            wall: crate::timezone::format_wall(utc.naive_utc()),
            tz: Some("UTC".to_owned()),
            utc: Some(crate::timezone::format_utc(utc)),
            all_day: false,
        });
    }
    let naive = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M"))
        .ok()?;
    Some(Point {
        wall: crate::timezone::format_wall(naive),
        tz: None,
        utc: None,
        all_day: false,
    })
}

fn string_field(record: &Value, names: &[&str]) -> Option<String> {
    for name in names {
        if let Some(value) = record.get(*name) {
            if let Some(text) = value.as_str() {
                let text = text.trim();
                if !text.is_empty() {
                    return Some(text.to_owned());
                }
            }
        }
    }
    None
}

/// 关系字段（assignedTo / project / location）可能是 `{id,name}` 或纯字符串。
fn relation_name(record: &Value, field: &str) -> Option<String> {
    let value = record.get(field)?;
    if let Some(text) = value.as_str() {
        let text = text.trim();
        return (!text.is_empty()).then(|| text.to_owned());
    }
    for key in ["name", "fullName", "title"] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            let text = text.trim();
            if !text.is_empty() {
                return Some(text.to_owned());
            }
        }
    }
    None
}

/// 把一条 Axelor 记录映射成日历实例。没有可用起始时间的记录跳过（任务里
/// 允许「无计划日期」，这类条目在日历上无处可放）。
pub fn record_to_instance(model: &str, record: &Value) -> Option<ExternalInstance> {
    let id = record.get("id").and_then(Value::as_u64).map(|n| n.to_string());
    let title = string_field(record, TITLE_FIELDS)
        .or_else(|| id.as_ref().map(|id| format!("{model} #{id}")))
        .unwrap_or_else(|| model.to_owned());
    let start_raw = string_field(record, START_FIELDS)?;
    let start = parse_point(&start_raw)?;
    let end = string_field(record, END_FIELDS).and_then(|raw| parse_point(&raw));

    // 结束时间缺失或早于起点时给一个合理默认：全天 +1 天，定时 +1 小时。
    let (end_wall, end_tz, end_utc, all_day) = match end {
        Some(end) if end.wall > start.wall => (end.wall, end.tz, end.utc, start.all_day),
        _ => {
            if start.all_day {
                let date = chrono::NaiveDate::parse_from_str(&start.wall[..10], "%Y-%m-%d").ok()?;
                let next = date + chrono::Duration::days(1);
                (
                    format!("{}T00:00", next.format("%Y-%m-%d")),
                    None,
                    None,
                    true,
                )
            } else {
                let naive = crate::timezone::parse_wall(&start.wall).ok()?;
                let next = naive + chrono::Duration::hours(1);
                let utc = start
                    .utc
                    .as_deref()
                    .and_then(|raw| chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%MZ").ok())
                    .map(|naive| naive + chrono::Duration::hours(1))
                    .map(|naive| naive.format("%Y-%m-%dT%H:%MZ").to_string());
                (
                    crate::timezone::format_wall(next),
                    start.tz.clone(),
                    utc,
                    false,
                )
            }
        }
    };

    // 描述里补上负责人与项目：日历弹窗里一眼能看出这是谁的任务。
    let mut description = string_field(record, &["description", "notes", "internalDescription"])
        .unwrap_or_default();
    for (label, field) in [("负责人", "assignedTo"), ("项目", "project")] {
        if let Some(name) = relation_name(record, field) {
            if !description.is_empty() {
                description.push('\n');
            }
            description.push_str(&format!("{label}: {name}"));
        }
    }
    let description = (!description.trim().is_empty()).then_some(description);

    Some(ExternalInstance {
        uid: id.map(|id| format!("axelor:{model}:{id}")),
        title,
        location: relation_name(record, "location"),
        description,
        reminders: Vec::new(),
        start_wall: start.wall,
        end_wall,
        start_tz: start.tz,
        end_tz,
        start_utc: start.utc,
        end_utc,
        all_day,
    })
}

/// 拉取一个模型下的全部记录（分页），映射成日历实例。单条记录解析失败只跳过
/// 该条，不影响整源；HTTP/JSON 级失败向上传播，调用方保留上次数据并记失败。
pub fn fetch_events(
    base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<Vec<ExternalInstance>, CommandError> {
    let base_url = normalize_base_url(base_url)?;
    let model = model.trim();
    if model.is_empty() || model.contains('/') || model.contains('?') {
        return Err(CommandError::validation("model", "模型名无效。"));
    }
    let mut out = Vec::new();
    for page in 0..MAX_PAGES {
        let offset = page * PAGE_LIMIT;
        let path = format!("/ws/rest/{model}?offset={offset}&limit={PAGE_LIMIT}");
        let (status, body) = crate::net::get_axelor_json(&base_url, &path, api_key)?;
        if !(200..300).contains(&status) {
            return Err(http_error(status));
        }
        let parsed: Value = serde_json::from_str(&body)
            .map_err(|_| CommandError::validation("baseUrl", "Axelor 返回的不是 JSON。"))?;
        let data = parsed
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let total = parsed.get("total").and_then(Value::as_u64).unwrap_or(0) as usize;
        for record in &data {
            if let Some(instance) = record_to_instance(model, record) {
                out.push(instance);
            }
        }
        if data.len() < PAGE_LIMIT || out.len() + offset >= total {
            break;
        }
    }
    Ok(out)
}

/// 同步一个 Axelor 订阅：短锁读凭证 → 锁外拉取 → 由调用方写库。
pub fn fetch_source_events(
    db: &AppDb,
    source: &CalendarSubscription,
) -> Result<Vec<ExternalInstance>, CommandError> {
    let server_id = source
        .axelor_server_id
        .as_deref()
        .ok_or_else(|| CommandError::validation("serverId", "该订阅缺少 Axelor 服务器。"))?;
    let model = source
        .axelor_model
        .as_deref()
        .ok_or_else(|| CommandError::validation("model", "该订阅缺少 Axelor 模型。"))?;
    let (base_url, api_key) = {
        let connection = db.0.lock().map_err(CommandError::database)?;
        server_credentials(&connection, server_id)?
    };
    fetch_events(&base_url, &api_key, model)
}

// ---- Tauri 命令 -----------------------------------------------------------

/// 用地址 + API key 试连，返回实例里的模型清单。
#[tauri::command]
pub async fn list_axelor_models(
    base_url: String,
    api_key: String,
) -> Result<Vec<AxelorModel>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || list_models(&base_url, &api_key))
        .await
        .map_err(|_| CommandError::system("Axelor 请求任务执行失败。"))?
}

#[tauri::command]
pub fn list_axelor_servers(db: State<'_, AppDb>) -> Result<Vec<AxelorServer>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list_servers(&connection)
}

/// 新建 Axelor 订阅：保存/更新服务器 → 建订阅 → 立刻同步一次。
#[tauri::command]
pub async fn create_axelor_subscription<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    base_url: String,
    api_key: String,
    model: String,
    name: String,
    color: String,
    refresh_interval_minutes: i64,
    category_id: Option<String>,
) -> Result<CalendarSubscription, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<AppDb>();
        create_axelor_subscription_blocking(
            db.inner(),
            &base_url,
            &api_key,
            &model,
            &name,
            &color,
            refresh_interval_minutes,
            category_id.as_deref(),
        )
    })
    .await
    .map_err(|_| CommandError::system("Axelor 订阅任务执行失败。"))?
}

fn create_axelor_subscription_blocking(
    db: &AppDb,
    base_url: &str,
    api_key: &str,
    model: &str,
    name: &str,
    color: &str,
    refresh_interval_minutes: i64,
    category_id: Option<&str>,
) -> Result<CalendarSubscription, CommandError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CommandError::validation("name", "名称不能为空。"));
    }
    if !(1..=30).contains(&refresh_interval_minutes) {
        return Err(CommandError::validation(
            "refreshIntervalMinutes",
            "刷新间隔需在 1 到 30 分钟之间。",
        ));
    }
    let model = model.trim();
    if model.is_empty() {
        return Err(CommandError::validation("model", "请选择要同步的模型。"));
    }
    let created = {
        let mut connection = db.0.lock().map_err(CommandError::database)?;
        let server = upsert_server(&mut connection, base_url, api_key, None, name)?;
        crate::subscriptions::create_axelor(
            &mut connection,
            &server.id,
            model,
            name,
            color,
            refresh_interval_minutes,
            category_id,
        )?
    };
    // 首次同步失败不阻塞订阅创建：状态会记为 failed，后台按间隔重试。
    if crate::subscription_sync::sync_one_db(db, &created).is_ok() {
        crate::status_island::invalidate_registered()?;
    }
    let connection = db.0.lock().map_err(CommandError::database)?;
    crate::subscriptions::fetch_one(&connection, &created.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn base_url_requires_scheme_and_host() {
        assert_eq!(
            normalize_base_url("https://axelor.example.com/").unwrap(),
            "https://axelor.example.com"
        );
        assert_eq!(
            normalize_base_url("http://192.168.1.10:8080").unwrap(),
            "http://192.168.1.10:8080"
        );
        assert_eq!(
            normalize_base_url("axelor.example.com").unwrap_err().field.as_deref(),
            Some("baseUrl")
        );
        assert_eq!(
            normalize_base_url("https://a.example.com/?x=1").unwrap_err().field.as_deref(),
            Some("baseUrl")
        );
    }

    #[test]
    fn timed_record_maps_to_utc_instance() {
        let record = json!({
            "id": 7,
            "name": "设计评审",
            "plannedStartDate": "2026-11-17T10:00:00+03:30",
            "plannedEndDate": "2026-11-17T11:30:00+03:30",
            "assignedTo": { "id": 2, "name": "رضا" },
            "project": { "id": 3, "name": "RESA" }
        });
        let inst = record_to_instance("com.axelor.apps.project.db.ProjectTask", &record).unwrap();
        assert_eq!(inst.title, "设计评审");
        assert_eq!(inst.uid.as_deref(), Some("axelor:com.axelor.apps.project.db.ProjectTask:7"));
        assert_eq!(inst.start_wall, "2026-11-17T06:30");
        assert_eq!(inst.end_wall, "2026-11-17T08:00");
        assert_eq!(inst.start_tz.as_deref(), Some("UTC"));
        assert!(!inst.all_day);
        let description = inst.description.unwrap();
        assert!(description.contains("负责人: رضا"));
        assert!(description.contains("项目: RESA"));
    }

    #[test]
    fn date_only_record_is_all_day_and_defaults_to_one_day() {
        let record = json!({
            "id": 9,
            "name": "盘点",
            "plannedStartDate": "2026-11-17"
        });
        let inst = record_to_instance("com.axelor.apps.project.db.ProjectTask", &record).unwrap();
        assert!(inst.all_day);
        assert_eq!(inst.start_wall, "2026-11-17T00:00");
        assert_eq!(inst.end_wall, "2026-11-18T00:00");
        assert_eq!(inst.start_tz, None);
    }

    #[test]
    fn record_without_dates_is_skipped() {
        let record = json!({ "id": 11, "name": "无日期任务" });
        assert!(record_to_instance("m", &record).is_none());
    }

    #[test]
    fn floating_datetime_keeps_wall_clock() {
        let record = json!({
            "id": 12,
            "name": "周会",
            "startDateTime": "2026-11-17T09:15:00",
            "endDateTime": "2026-11-17T10:00:00"
        });
        let inst = record_to_instance("m", &record).unwrap();
        assert_eq!(inst.start_wall, "2026-11-17T09:15");
        assert_eq!(inst.end_wall, "2026-11-17T10:00");
        assert_eq!(inst.start_tz, None);
    }

    #[test]
    fn upsert_server_reuses_row_per_address() {
        let mut connection = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut connection).unwrap();
        let first =
            upsert_server(&mut connection, "https://a.example.com", "key-1", None, "A").unwrap();
        let second =
            upsert_server(&mut connection, "https://a.example.com/", "key-2", None, "A2").unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(second.name, "A2");
        assert_eq!(list_servers(&connection).unwrap().len(), 1);
        let (_, key) = server_credentials(&connection, &first.id).unwrap();
        assert_eq!(key, "key-2");
    }

    #[test]
    fn blank_api_key_is_rejected() {
        let mut connection = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut connection).unwrap();
        let err = upsert_server(&mut connection, "https://a.example.com", "  ", None, "A")
            .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("apiKey"));
    }
}
