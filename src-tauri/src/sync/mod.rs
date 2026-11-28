//! Optional online sync for RESA, backed by Arianet BaaS (Supabase-compatible).
//!
//! The app is offline-first: SQLite is the source of truth and nothing here
//! runs until the user configures a server and signs in. See
//! `src-tauri/migrations/baas/0001_sync.sql` for the remote half.

mod auth;
mod engine;
mod http;
mod state;

use crate::db::AppDb;
use crate::error::CommandError;
use rusqlite::Connection;
use serde::Serialize;
use tauri::{Emitter, Manager, State};

pub use engine::SyncOutcome;

/// True when the user turned background sync on and a session is present.
pub fn is_enabled(connection: &Connection) -> bool {
    state::get(connection, state::KEY_ENABLED).as_deref() == Some("true")
        && state::load_credentials(connection).ok().flatten().is_some()
}

pub fn run_engine(connection: &mut Connection) -> Result<SyncOutcome, CommandError> {
    engine::run(connection)
}

/// Tell the open window that pulled rows changed, so the modules reload.
fn notify_applied(app: &tauri::AppHandle, outcome: &SyncOutcome) {
    if outcome.pulled == 0 {
        return;
    }
    // One signal for the whole workspace: a pull can touch any module now, and
    // the window reloads the ones it keeps in memory.
    let _ = app.emit(
        "nowly-records-changed",
        serde_json::json!({ "kind": "all", "entities": outcome.entities }),
    );
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub configured: bool,
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub signed_in: bool,
    pub last_sync_at: Option<String>,
    pub pending_changes: i64,
    pub device_id: String,
    /// Workspace the account is syncing into, and its display name.
    pub workspace_id: Option<String>,
    pub workspace_name: Option<String>,
    /// True when this build carries a server address and public key, so the
    /// user never has to paste them.
    pub has_defaults: bool,
}

fn with_connection<T>(
    db: State<'_, AppDb>,
    operation: impl FnOnce(&Connection) -> Result<T, CommandError>,
) -> Result<T, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    operation(&connection)
}

fn build_status(connection: &Connection) -> Result<SyncStatus, CommandError> {
    let endpoint = state::get(connection, state::KEY_ENDPOINT);
    let signed_in = state::load_credentials(connection)?.is_some();
    Ok(SyncStatus {
        configured: endpoint.is_some() && state::get(connection, state::KEY_ANON).is_some(),
        enabled: state::get(connection, state::KEY_ENABLED).as_deref() == Some("true"),
        endpoint,
        email: state::get(connection, state::KEY_EMAIL),
        phone: state::get(connection, state::KEY_PHONE),
        user_id: state::get(connection, state::KEY_USER_ID),
        user_name: state::get(connection, state::KEY_USER_NAME),
        signed_in,
        last_sync_at: state::get(connection, state::KEY_LAST_SYNC),
        pending_changes: engine::pending_changes(connection),
        device_id: state::device_id(connection).map_err(CommandError::database)?,
        workspace_id: state::get(connection, state::KEY_WORKSPACE),
        workspace_name: state::get(connection, state::KEY_WORKSPACE_NAME),
        has_defaults: built_in_defaults().is_some(),
    })
}

/// Server address and public key baked into the build.
///
/// The people using RESA are not supposed to know what an endpoint or an anon
/// key is: the build is pointed at our own backend once, at compile time, and
/// the account screen only ever asks for an email and a password. Leaving the
/// variables unset keeps the feature visibly "not configured yet" instead of
/// pretending to work.
fn built_in_defaults() -> Option<(String, String)> {
    let endpoint = option_env!("RESA_SYNC_ENDPOINT")?.trim();
    let anon_key = option_env!("RESA_SYNC_ANON_KEY")?.trim();
    if endpoint.is_empty() || anon_key.is_empty() {
        return None;
    }
    Some((endpoint.to_owned(), anon_key.to_owned()))
}

/// Applies the build's own server settings once, so the account screen can show
/// a login form instead of a configuration form.
#[tauri::command]
pub fn sync_apply_defaults(db: State<'_, AppDb>) -> Result<SyncStatus, CommandError> {
    let (endpoint, anon_key) =
        built_in_defaults().ok_or_else(|| CommandError::sync("This build has no sync server."))?;
    let endpoint = normalize_endpoint(&endpoint)?;
    with_connection(db, |connection| {
        if state::get(connection, state::KEY_ENDPOINT).is_none()
            || state::get(connection, state::KEY_ANON).is_none()
        {
            state::set(connection, state::KEY_ENDPOINT, &endpoint).map_err(CommandError::database)?;
            state::set(connection, state::KEY_ANON, &anon_key).map_err(CommandError::database)?;
        }
        build_status(connection)
    })
}

fn normalize_endpoint(endpoint: &str) -> Result<String, CommandError> {
    let endpoint = endpoint.trim().trim_end_matches('/');
    // Public servers must be https; a self-hosted box on the LAN or this
    // machine is reachable over http and that is the normal case while
    // bringing the stack up.
    let is_https = endpoint.starts_with("https://");
    let is_local_http = endpoint.starts_with("http://")
        && local_http_host(endpoint).is_some();
    if !is_https && !is_local_http {
        return Err(CommandError::validation(
            "endpoint",
            "آدرس سرور باید با https:// شروع شود (یا http:// برای سرور محلی).",
        ));
    }
    if endpoint.len() > 300 || endpoint.contains(char::is_whitespace) {
        return Err(CommandError::validation(
            "endpoint",
            "آدرس سرور معتبر نیست.",
        ));
    }
    if !is_local_http && !endpoint.contains('.') {
        return Err(CommandError::validation(
            "endpoint",
            "آدرس سرور معتبر نیست.",
        ));
    }
    Ok(endpoint.to_owned())
}

/// True when an `http://` endpoint points at this machine or a private
/// network, which is safe enough to allow without a certificate.
fn local_http_host(endpoint: &str) -> Option<&str> {
    let rest = endpoint.strip_prefix("http://")?;
    let host = rest.split(['/', ':']).next()?;
    let allowed = host == "localhost"
        || host == "127.0.0.1"
        || host == "0.0.0.0"
        || host.starts_with("192.168.")
        || host.starts_with("10.")
        || host.starts_with("172.16.")
        || host.starts_with("172.17.")
        || host.starts_with("172.18.")
        || host.starts_with("172.19.")
        || host.starts_with("172.2")
        || host.starts_with("172.30.")
        || host.starts_with("172.31.");
    allowed.then_some(host)
}

fn normalize_email(email: &str) -> Result<String, CommandError> {
    let email = email.trim();
    if !email.contains('@') || email.len() < 5 {
        return Err(CommandError::validation("email", "ایمیل معتبر نیست."));
    }
    Ok(email.to_owned())
}

/// A phone number is optional and only stored as profile metadata for now.
/// Empty means "not provided"; anything else must look like a number.
fn normalize_phone(phone: Option<String>) -> Result<Option<String>, CommandError> {
    let Some(phone) = phone else {
        return Ok(None);
    };
    let trimmed = phone.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let digits = trimmed.trim_start_matches('+');
    if !digits.chars().all(|character| character.is_ascii_digit())
        || !(10..=15).contains(&digits.len())
    {
        return Err(CommandError::validation(
            "phone",
            "شمارهٔ موبایل معتبر نیست؛ با کد کشور وارد کنید.",
        ));
    }
    Ok(Some(trimmed.to_owned()))
}

fn normalize_password(password: &str) -> Result<(), CommandError> {
    if password.len() < 6 {
        return Err(CommandError::validation(
            "password",
            "رمز عبور باید حداقل ۶ نویسه باشد.",
        ));
    }
    Ok(())
}

fn api_for(connection: &Connection) -> Result<http::Api, CommandError> {
    let endpoint = state::get(connection, state::KEY_ENDPOINT)
        .ok_or_else(|| CommandError::sync("سرور سینک هنوز تنظیم نشده است.".to_owned()))?;
    let anon_key = state::get(connection, state::KEY_ANON)
        .ok_or_else(|| CommandError::sync("کلید عمومی سرویس سینک تنظیم نشده است.".to_owned()))?;
    http::Api::new(&endpoint, &anon_key)
}

/// Queue every existing row of the synced tables for upload. Used once, when a
/// workspace is linked to an account for the first time.
fn requeue_all(connection: &Connection) -> Result<(), CommandError> {
    for spec in engine::ENTITIES {
        if !engine::table_exists(connection, spec.name) {
            continue;
        }
        // Tables without a clock still need a timestamp for ordering.
        let clock = if spec.clocked {
            "updated_at"
        } else {
            "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
        };
        connection
            .execute(
                &format!(
                    "INSERT INTO sync_outbox(entity, record_id, op, changed_at)
                     SELECT '{name}', {id_expr}, 'upsert', {clock} FROM {name}
                     WHERE true
                     ON CONFLICT(entity, record_id) DO UPDATE
                        SET op = 'upsert', changed_at = excluded.changed_at",
                    name = spec.name,
                    id_expr = spec.id_expr,
                    clock = clock
                ),
                [],
            )
            .map_err(CommandError::database)?;
    }
    Ok(())
}

#[tauri::command]
pub fn sync_get_status(db: State<'_, AppDb>) -> Result<SyncStatus, CommandError> {
    with_connection(db, build_status)
}

#[tauri::command]
pub fn sync_configure(
    db: State<'_, AppDb>,
    endpoint: String,
    anon_key: String,
) -> Result<SyncStatus, CommandError> {
    let endpoint = normalize_endpoint(&endpoint)?;
    let anon_key = anon_key.trim().to_owned();
    if anon_key.len() < 20 {
        return Err(CommandError::validation(
            "anonKey",
            "کلید عمومی سرویس معتبر نیست.",
        ));
    }
    with_connection(db, |connection| {
        state::set(connection, state::KEY_ENDPOINT, &endpoint).map_err(CommandError::database)?;
        state::set(connection, state::KEY_ANON, &anon_key).map_err(CommandError::database)?;
        build_status(connection)
    })
}

#[tauri::command]
pub fn sync_sign_in(
    db: State<'_, AppDb>,
    email: String,
    password: String,
) -> Result<SyncStatus, CommandError> {
    let email = normalize_email(&email)?;
    normalize_password(&password)?;
    with_connection(db, |connection| {
        let api = api_for(connection)?;
        let session = auth::sign_in(&api, &email, &password)?;
        store_session(connection, &session, &email)?;
        prepare_account(connection)?;
        build_status(connection)
    })
}

#[tauri::command]
pub fn sync_sign_up(
    db: State<'_, AppDb>,
    email: String,
    password: String,
    phone: Option<String>,
) -> Result<SyncStatus, CommandError> {
    let email = normalize_email(&email)?;
    normalize_password(&password)?;
    let phone = normalize_phone(phone)?;
    with_connection(db, |connection| {
        let api = api_for(connection)?;
        let session = auth::sign_up(&api, &email, &password, phone.as_deref())?;
        store_session(connection, &session, &email)?;
        if let Some(phone) = phone.as_deref() {
            state::set(connection, state::KEY_PHONE, phone).map_err(CommandError::database)?;
        }
        prepare_account(connection)?;
        build_status(connection)
    })
}

/// Sends the signup confirmation mail again. The account exists but cannot be
/// used until the address is confirmed, so this is the recovery path.
#[tauri::command]
pub fn sync_resend_verification(
    db: State<'_, AppDb>,
    email: String,
) -> Result<SyncStatus, CommandError> {
    let email = normalize_email(&email)?;
    with_connection(db, |connection| {
        let api = api_for(connection)?;
        auth::resend_confirmation(&api, &email)?;
        build_status(connection)
    })
}

fn store_session(
    connection: &Connection,
    session: &auth::Session,
    email: &str,
) -> Result<(), CommandError> {
    let previous_user = state::get(connection, state::KEY_USER_ID);
    state::save_credentials(
        connection,
        &session.access_token,
        &session.refresh_token,
        session.expires_at,
    )?;
    state::set(connection, state::KEY_EMAIL, session.email.as_deref().unwrap_or(email))
        .map_err(CommandError::database)?;
    state::set(connection, state::KEY_USER_ID, &session.user_id).map_err(CommandError::database)?;
    match previous_user {
        None => requeue_all(connection)?,
        Some(previous) if previous != session.user_id => {
            state::remove(connection, state::KEY_CURSOR).map_err(CommandError::database)?;
        }
        Some(_) => {}
    }
    Ok(())
}

#[tauri::command]
pub fn sync_sign_out(db: State<'_, AppDb>) -> Result<SyncStatus, CommandError> {
    with_connection(db, |connection| {
        state::clear_credentials(connection)?;
        state::set(connection, state::KEY_ENABLED, "false").map_err(CommandError::database)?;
        state::remove(connection, state::KEY_PHONE).map_err(CommandError::database)?;
        build_status(connection)
    })
}

#[tauri::command]
pub fn sync_set_enabled(db: State<'_, AppDb>, enabled: bool) -> Result<SyncStatus, CommandError> {
    with_connection(db, |connection| {
        if enabled && state::load_credentials(connection)?.is_none() {
            return Err(CommandError::sync(
                "برای فعال کردن سینک ابتدا وارد حساب خود شوید.".to_owned(),
            ));
        }
        state::set(
            connection,
            state::KEY_ENABLED,
            if enabled { "true" } else { "false" },
        )
        .map_err(CommandError::database)?;
        build_status(connection)
    })
}

#[tauri::command]
pub async fn sync_now(app: tauri::AppHandle) -> Result<SyncOutcome, CommandError> {
    let handle = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<AppDb>();
        let mut connection = db.0.lock().map_err(CommandError::database)?;
        engine::run(&mut connection)
    })
    .await
    .map_err(CommandError::system)??;
    notify_applied(&handle, &outcome);
    Ok(outcome)
}

// ------------------------------------------------------------- workspaces
//
// An account always owns a personal workspace, so a solo user never sees any
// of this. A team shares one workspace: everyone signed into it reads and
// writes the same records, which is what makes delegation visible to the
// person a task was handed to.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    pub role: String,
    pub member_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMember {
    pub user_id: String,
    pub role: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
}

fn auth_context(
    connection: &Connection,
) -> Result<(http::Api, String), CommandError> {
    let api = api_for(connection)?;
    let token = engine::access_token(connection, &api)?;
    Ok((api, token))
}

/// Creates the personal workspace on first use and remembers its id.
fn ensure_personal_workspace(
    connection: &Connection,
    api: &http::Api,
    token: &str,
) -> Result<String, CommandError> {
    let value = api.post_json(
        "/rest/v1/rpc/ensure_personal_workspace",
        Some(token),
        &serde_json::json!({}),
    )?;
    let id = value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.get("ensure_personal_workspace").and_then(|v| v.as_str()).map(str::to_owned))
        .ok_or_else(|| CommandError::sync("ساخت فضای کاری ممکن نشد.".to_owned()))?;
    if state::get(connection, state::KEY_WORKSPACE).as_deref() != Some(id.as_str()) {
        state::set(connection, state::KEY_WORKSPACE, &id).map_err(CommandError::database)?;
        // A different workspace means the pull cursor no longer applies.
        state::remove(connection, state::KEY_CURSOR).map_err(CommandError::database)?;
    }
    Ok(id)
}

/// Called right after a successful sign-in so the account is usable at once.
fn prepare_account(connection: &Connection) -> Result<(), CommandError> {
    if state::load_credentials(connection)?.is_none() {
        return Ok(());
    }
    let (api, token) = auth_context(connection)?;
    let id = ensure_personal_workspace(connection, &api, &token)?;
    // Best effort: a name is cosmetic, so never fail sign-in over it.
    if let Ok(rows) = api.get_json(
        &format!("/rest/v1/workspaces?select=id,name&id=eq.{id}"),
        Some(&token),
    ) {
        if let Some(name) = rows
            .as_array()
            .and_then(|rows| rows.first())
            .and_then(|row| row.get("name"))
            .and_then(|value| value.as_str())
        {
            let _ = state::set(connection, state::KEY_WORKSPACE_NAME, name);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn sync_workspace_list(db: State<'_, AppDb>) -> Result<Vec<WorkspaceSummary>, CommandError> {
    with_connection(db, |connection| {
        let (api, token) = auth_context(connection)?;
        let rows = api.get_json(
            "/rest/v1/workspace_members?select=role,workspace_id,workspaces(id,name)&order=created_at.asc",
            Some(&token),
        )?;
        let mut out = Vec::new();
        for row in rows.as_array().cloned().unwrap_or_default() {
            let workspace = row.get("workspaces").cloned().unwrap_or_default();
            let Some(id) = workspace.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            let name = workspace
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("فضای کاری")
                .to_owned();
            let role = row
                .get("role")
                .and_then(|v| v.as_str())
                .unwrap_or("member")
                .to_owned();
            let member_count = api
                .get_json(
                    &format!(
                        "/rest/v1/workspace_members?select=user_id&workspace_id=eq.{id}"
                    ),
                    Some(&token),
                )
                .ok()
                .and_then(|value| value.as_array().map(Vec::len))
                .unwrap_or(1) as i64;
            out.push(WorkspaceSummary {
                id: id.to_owned(),
                name,
                role,
                member_count,
            });
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn sync_workspace_create(
    db: State<'_, AppDb>,
    name: String,
) -> Result<SyncStatus, CommandError> {
    let name = name.trim().to_owned();
    if name.is_empty() || name.len() > 80 {
        return Err(CommandError::validation("name", "نام فضای کاری معتبر نیست."));
    }
    with_connection(db, |connection| {
        let (api, token) = auth_context(connection)?;
        let user_id = state::get(connection, state::KEY_USER_ID)
            .ok_or_else(|| CommandError::sync("ابتدا وارد حساب خود شوید.".to_owned()))?;
        let created = api.post_json(
            "/rest/v1/workspaces",
            Some(&token),
            &serde_json::json!({ "name": name, "owner_id": user_id }),
        )?;
        let id = created
            .as_array()
            .and_then(|rows| rows.first())
            .and_then(|row| row.get("id"))
            .and_then(|value| value.as_str())
            .ok_or_else(|| CommandError::sync("ساخت فضای کاری ممکن نشد.".to_owned()))?;
        api.post_json(
            "/rest/v1/workspace_members",
            Some(&token),
            &serde_json::json!({
                "workspace_id": id,
                "user_id": user_id,
                "role": "owner",
            }),
        )?;
        state::set(connection, state::KEY_WORKSPACE, id).map_err(CommandError::database)?;
        state::set(connection, state::KEY_WORKSPACE_NAME, &name).map_err(CommandError::database)?;
        state::remove(connection, state::KEY_CURSOR).map_err(CommandError::database)?;
        build_status(connection)
    })
}

#[tauri::command]
pub fn sync_workspace_switch(
    db: State<'_, AppDb>,
    workspace_id: String,
) -> Result<SyncStatus, CommandError> {
    with_connection(db, |connection| {
        let (api, token) = auth_context(connection)?;
        let rows = api.get_json(
            &format!(
                "/rest/v1/workspace_members?select=role,workspaces(id,name)&workspace_id=eq.{workspace_id}"
            ),
            Some(&token),
        )?;
        let Some(row) = rows.as_array().and_then(|rows| rows.first()) else {
            return Err(CommandError::sync("شما عضو این فضای کاری نیستید.".to_owned()));
        };
        let name = row
            .get("workspaces")
            .and_then(|value| value.get("name"))
            .and_then(|value| value.as_str())
            .unwrap_or("فضای کاری")
            .to_owned();
        state::set(connection, state::KEY_WORKSPACE, &workspace_id)
            .map_err(CommandError::database)?;
        state::set(connection, state::KEY_WORKSPACE_NAME, &name)
            .map_err(CommandError::database)?;
        state::remove(connection, state::KEY_CURSOR).map_err(CommandError::database)?;
        build_status(connection)
    })
}

#[tauri::command]
pub fn sync_workspace_members(
    db: State<'_, AppDb>,
) -> Result<Vec<WorkspaceMember>, CommandError> {
    with_connection(db, |connection| {
        let workspace = current_workspace(connection)?;
        let (api, token) = auth_context(connection)?;
        let rows = api.get_json(
            &format!(
                "/rest/v1/workspace_members?select=user_id,role,display_name&workspace_id=eq.{workspace}&order=created_at.asc"
            ),
            Some(&token),
        )?;
        let mut out = Vec::new();
        for row in rows.as_array().cloned().unwrap_or_default() {
            let Some(user_id) = row.get("user_id").and_then(|v| v.as_str()) else {
                continue;
            };
            out.push(WorkspaceMember {
                user_id: user_id.to_owned(),
                role: row
                    .get("role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("member")
                    .to_owned(),
                display_name: row
                    .get("display_name")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
                email: None,
            });
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn sync_workspace_invite(
    db: State<'_, AppDb>,
    email: String,
    role: Option<String>,
) -> Result<String, CommandError> {
    let email = normalize_email(&email)?;
    let role = match role.as_deref() {
        Some("manager") => "manager",
        _ => "member",
    };
    with_connection(db, |connection| {
        let workspace = current_workspace(connection)?;
        let (api, token) = auth_context(connection)?;
        // Re-inviting the same address replaces the old, unaccepted invite so
        // the unique (workspace, email) row never blocks a second attempt.
        let _ = api.delete_json(
            &format!(
                "/rest/v1/workspace_invites?workspace_id=eq.{workspace}&email=eq.{}&accepted_at=is.null",
                http::encode_query_value(&email)
            ),
            Some(&token),
        );
        let created = api.post_json(
            "/rest/v1/workspace_invites",
            Some(&token),
            &serde_json::json!({
                "workspace_id": workspace,
                "email": email,
                "role": role,
            }),
        )?;
        created
            .as_array()
            .and_then(|rows| rows.first())
            .and_then(|row| row.get("token"))
            .and_then(|value| value.as_str())
            .map(str::to_owned)
            .ok_or_else(|| CommandError::sync("ساخت دعوت‌نامه ممکن نشد.".to_owned()))
    })
}

#[tauri::command]
pub fn sync_workspace_accept(
    db: State<'_, AppDb>,
    token: String,
) -> Result<SyncStatus, CommandError> {
    let token = token.trim().to_owned();
    if token.len() < 8 {
        return Err(CommandError::validation("token", "کد دعوت‌نامه معتبر نیست."));
    }
    with_connection(db, |connection| {
        let (api, auth_token) = auth_context(connection)?;
        let value = api.post_json(
            "/rest/v1/rpc/accept_invite",
            Some(&auth_token),
            &serde_json::json!({ "p_token": token }),
        )?;
        let workspace = value
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| CommandError::sync("این دعوت‌نامه معتبر نیست.".to_owned()))?;
        state::set(connection, state::KEY_WORKSPACE, &workspace)
            .map_err(CommandError::database)?;
        state::remove(connection, state::KEY_CURSOR).map_err(CommandError::database)?;
        build_status(connection)
    })
}

#[tauri::command]
pub fn sync_set_display_name(
    db: State<'_, AppDb>,
    name: String,
) -> Result<SyncStatus, CommandError> {
    let name = name.trim().to_owned();
    if name.len() > 80 {
        return Err(CommandError::validation("name", "نام بیش از حد بلند است."));
    }
    with_connection(db, |connection| {
        state::set(connection, state::KEY_USER_NAME, &name).map_err(CommandError::database)?;
        // Mirror it onto the membership row so teammates see a real name.
        if let (Ok(workspace), Ok(user_id), Ok((api, token))) = (
            current_workspace(connection),
            state::get(connection, state::KEY_USER_ID)
                .ok_or_else(|| CommandError::sync("no user".to_owned())),
            auth_context(connection),
        ) {
            let _ = api.patch_json(
                &format!(
                    "/rest/v1/workspace_members?workspace_id=eq.{workspace}&user_id=eq.{user_id}"
                ),
                Some(&token),
                &serde_json::json!({ "display_name": name }),
            );
        }
        build_status(connection)
    })
}

fn current_workspace(connection: &Connection) -> Result<String, CommandError> {
    if let Some(id) = state::get(connection, state::KEY_WORKSPACE) {
        return Ok(id);
    }
    let (api, token) = auth_context(connection)?;
    ensure_personal_workspace(connection, &api, &token)
}
