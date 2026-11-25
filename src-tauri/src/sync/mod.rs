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
    pub signed_in: bool,
    pub last_sync_at: Option<String>,
    pub pending_changes: i64,
    pub device_id: String,
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
        signed_in,
        last_sync_at: state::get(connection, state::KEY_LAST_SYNC),
        pending_changes: engine::pending_changes(connection),
        device_id: state::device_id(connection).map_err(CommandError::database)?,
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
