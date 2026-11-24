//! Local sync bookkeeping: settings, the device id, and the encrypted session.

use crate::error::CommandError;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

pub const KEY_ENDPOINT: &str = "sync.endpoint";
pub const KEY_ANON: &str = "sync.anon_key";
pub const KEY_ENABLED: &str = "sync.enabled";
pub const KEY_EMAIL: &str = "sync.email";
pub const KEY_USER_ID: &str = "sync.user_id";
pub const KEY_LAST_SYNC: &str = "sync.last_sync_at";
pub const KEY_CURSOR: &str = "sync.cursor";
pub const KEY_DEVICE: &str = "sync.device_id";
pub const KEY_PHONE: &str = "sync.phone";

pub fn get(connection: &Connection, key: &str) -> Option<String> {
    connection
        .query_row(
            "SELECT value FROM sync_state WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
}

pub fn set(connection: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO sync_state(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn remove(connection: &Connection, key: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM sync_state WHERE key = ?1", [key])?;
    Ok(())
}

/// Stable id for this installation. It only labels which device wrote a row.
pub fn device_id(connection: &Connection) -> rusqlite::Result<String> {
    if let Some(existing) = get(connection, KEY_DEVICE) {
        return Ok(existing);
    }
    let created = Uuid::new_v4().to_string();
    set(connection, KEY_DEVICE, &created)?;
    Ok(created)
}

pub struct Credentials {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

fn put_secret(connection: &Connection, key: &str, value: &str) -> Result<(), CommandError> {
    let cipher = crate::token_store::protect_secret(value)?;
    connection.execute(
        "INSERT INTO sync_credentials(key, cipher) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET cipher = excluded.cipher",
        params![key, cipher],
    )
    .map_err(CommandError::database)?;
    Ok(())
}

fn get_secret(connection: &Connection, key: &str) -> Result<Option<String>, CommandError> {
    let cipher: Option<Vec<u8>> = connection
        .query_row(
            "SELECT cipher FROM sync_credentials WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(CommandError::database)?;
    match cipher {
        Some(cipher) => crate::token_store::unprotect_secret(&cipher).map(Some),
        None => Ok(None),
    }
}

pub fn save_credentials(
    connection: &Connection,
    access_token: &str,
    refresh_token: &str,
    expires_at: i64,
) -> Result<(), CommandError> {
    put_secret(connection, "access_token", access_token)?;
    put_secret(connection, "refresh_token", refresh_token)?;
    set(connection, "expires_at", &expires_at.to_string()).map_err(CommandError::database)?;
    Ok(())
}

pub fn load_credentials(connection: &Connection) -> Result<Option<Credentials>, CommandError> {
    let Some(access_token) = get_secret(connection, "access_token")? else {
        return Ok(None);
    };
    let Some(refresh_token) = get_secret(connection, "refresh_token")? else {
        return Ok(None);
    };
    let expires_at = get(connection, "expires_at")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    Ok(Some(Credentials {
        access_token,
        refresh_token,
        expires_at,
    }))
}

pub fn clear_credentials(connection: &Connection) -> Result<(), CommandError> {
    connection
        .execute("DELETE FROM sync_credentials", [])
        .map_err(CommandError::database)?;
    for key in [KEY_EMAIL, KEY_USER_ID, KEY_CURSOR, KEY_LAST_SYNC] {
        remove(connection, key).map_err(CommandError::database)?;
    }
    Ok(())
}
