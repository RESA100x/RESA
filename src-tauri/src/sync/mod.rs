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
    for kind in ["task", "event", "note"] {
        let _ = app.emit("nowly-records-changed", serde_json::json!({ "kind": kind }));
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub configured: bool,
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub email: Option<String>,
    pub signed_in: bool,
    pub last_sync_at: Option<String>,
    pub pending_changes: i64,
    pub device_id: String,
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
        signed_in,
        last_sync_at: state::get(connection, state::KEY_LAST_SYNC),
        pending_changes: engine::pending_changes(connection),
        device_id: state::device_id(connection).map_err(CommandError::database)?,
    })
}

fn normalize_endpoint(endpoint: &str) -> Result<String, CommandError> {
    let endpoint = endpoint.trim().trim_end_matches('/');
    if !endpoint.starts_with("https://") {
        return Err(CommandError::validation(
            "endpoint",
            "آدرس سرور باید با https:// شروع شود.",
        ));
    }
    if endpoint.len() > 300 || endpoint.contains(char::is_whitespace) || !endpoint.contains('.') {
        return Err(CommandError::validation(
            "endpoint",
            "آدرس سرور معتبر نیست.",
        ));
    }
    Ok(endpoint.to_owned())
}

fn normalize_email(email: &str) -> Result<String, CommandError> {
    let email = email.trim();
    if !email.contains('@') || email.len() < 5 {
        return Err(CommandError::validation("email", "ایمیل معتبر نیست."));
    }
    Ok(email.to_owned())
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
    for entity in engine::ENTITIES {
        connection
            .execute(
                &format!(
                    "INSERT INTO sync_outbox(entity, record_id, op, changed_at)
                     SELECT '{entity}', id, 'upsert', updated_at FROM {entity}
                     WHERE true
                     ON CONFLICT(entity, record_id) DO UPDATE
                        SET op = 'upsert', changed_at = excluded.changed_at"
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
        build_status(connection)
    })
}

#[tauri::command]
pub fn sync_sign_up(
    db: State<'_, AppDb>,
    email: String,
    password: String,
) -> Result<SyncStatus, CommandError> {
    let email = normalize_email(&email)?;
    normalize_password(&password)?;
    with_connection(db, |connection| {
        let api = api_for(connection)?;
        let session = auth::sign_up(&api, &email, &password)?;
        store_session(connection, &session, &email)?;
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
