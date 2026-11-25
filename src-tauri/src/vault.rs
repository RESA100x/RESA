//! Encrypted document vault.
//!
//! The vault holds the paperwork a person actually needs to keep — ID scans,
//! diplomas, insurance records, contracts — and it is the one part of RESA that
//! is deliberately not readable from disk. Every file is sealed with
//! AES-256-GCM under a key derived from a PIN the user types, so a copied
//! database or a stolen laptop folder yields nothing but noise.
//!
//! Design notes:
//!
//! * The PIN is never stored. `vault_meta` keeps a random salt and one sealed
//!   check block; unlocking means "can this PIN open the check block".
//! * The derived key lives only in memory (`VaultSession`) and disappears when
//!   the app closes or the user locks the vault.
//! * Only the app can reach the bytes. Files are addressed by an id that the
//!   command layer builds itself, so no caller-supplied path ever reaches the
//!   filesystem, and the plaintext is only ever produced on demand (preview,
//!   save-as, zip) and then dropped.
//! * Metadata (title, category, dates) is stored in SQLite in the clear so the
//!   list can be shown while locked; the file contents are what is protected.

use crate::db::AppDb;
use crate::error::CommandError;
use aes_gcm::aead::{rand_core::RngCore, Aead, OsRng};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::Engine as _;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

pub const VAULT_DIR: &str = "vault";
const PREVIEW_DIR: &str = "vault-preview";
const PBKDF2_ROUNDS: u32 = 150_000;
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const CHECK_PLAINTEXT: &[u8] = b"resa-vault-check";
const MIN_PIN_CHARS: usize = 6;
const MAX_PIN_CHARS: usize = 128;
/// A single document may not exceed this; scans and contracts stay well under
/// it, and the ceiling keeps a stray video from filling the disk.
const MAX_DOCUMENT_BYTES: usize = 64 * 1024 * 1024;
/// Preview hands the bytes to the webview as base64, so it is capped lower than
/// what can be stored: past this, "save a copy" is the honest path.
const MAX_PREVIEW_BYTES: usize = 20 * 1024 * 1024;

const CATEGORIES: &[&str] = &[
    "identity",
    "education",
    "insurance",
    "contract",
    "financial",
    "medical",
    "other",
];

/// The unlocked key, held for the lifetime of the session only.
#[derive(Default)]
pub struct VaultSession(pub Mutex<Option<[u8; KEY_LEN]>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
    pub document_count: i64,
    pub total_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultDocument {
    pub id: String,
    pub title: String,
    pub category: String,
    pub doc_number: String,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub tags: String,
    pub notes: String,
    pub file_name: String,
    pub mime: String,
    pub byte_size: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultDraft {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub doc_number: String,
    #[serde(default)]
    pub issued_at: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub tags: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFile {
    pub mime: String,
    pub file_name: String,
    pub base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultExport {
    pub path: String,
    pub count: usize,
}

// ---- crypto ---------------------------------------------------------------

fn derive_key(pin: &str, salt: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2::pbkdf2_hmac::<Sha256>(pin.as_bytes(), salt, PBKDF2_ROUNDS, &mut key);
    key
}

/// `[nonce][ciphertext+tag]`. The nonce is random per write, which is what
/// keeps two identical documents from producing identical files.
fn seal(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<Vec<u8>, CommandError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(CommandError::system)?;
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| CommandError::reported("Sealing the document failed."))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn open_sealed(key: &[u8; KEY_LEN], blob: &[u8]) -> Result<Vec<u8>, CommandError> {
    if blob.len() <= NONCE_LEN {
        return Err(CommandError::reported("The stored document is damaged."));
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(CommandError::system)?;
    let (nonce, ciphertext) = blob.split_at(NONCE_LEN);
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| CommandError::reported("The stored document is damaged."))
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

fn session_key(session: &VaultSession) -> Result<[u8; KEY_LEN], CommandError> {
    let guard = session.0.lock().map_err(CommandError::system)?;
    guard
        .as_ref()
        .copied()
        .ok_or_else(|| CommandError::validation("pin", "The vault is locked."))
}

// ---- storage helpers ------------------------------------------------------

fn vault_dir_for(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    let base = app.path().app_data_dir().map_err(CommandError::system)?;
    Ok(base.join(VAULT_DIR))
}

fn stored_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.vault"))
}

fn clean_text(value: &str, field: &str, limit: usize) -> Result<String, CommandError> {
    let trimmed = value.trim();
    if trimmed.chars().count() > limit {
        return Err(CommandError::validation(field, "This value is too long."));
    }
    Ok(trimmed.to_owned())
}

fn clean_date(value: &Option<String>, field: &str) -> Result<Option<String>, CommandError> {
    let Some(raw) = value.as_deref().map(str::trim).filter(|text| !text.is_empty()) else {
        return Ok(None);
    };
    let parsed = chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| CommandError::validation(field, "Use a valid date."))?;
    Ok(Some(parsed.format("%Y-%m-%d").to_string()))
}

fn clean_draft(draft: VaultDraft, fallback_title: &str) -> Result<VaultDraft, CommandError> {
    let title = clean_text(&draft.title, "title", 200)?;
    let title = if title.is_empty() {
        clean_text(fallback_title, "title", 200)?
    } else {
        title
    };
    if title.is_empty() {
        return Err(CommandError::validation("title", "A title is required."));
    }
    let category = draft.category.trim().to_ascii_lowercase();
    let category = if CATEGORIES.contains(&category.as_str()) {
        category
    } else {
        "other".to_owned()
    };
    Ok(VaultDraft {
        title,
        category,
        doc_number: clean_text(&draft.doc_number, "docNumber", 120)?,
        issued_at: clean_date(&draft.issued_at, "issuedAt")?,
        expires_at: clean_date(&draft.expires_at, "expiresAt")?,
        tags: clean_text(&draft.tags, "tags", 300)?,
        notes: clean_text(&draft.notes, "notes", 4000)?,
    })
}

fn mime_for(name: &str) -> &'static str {
    let extension = name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "txt" => "text/plain",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

fn read_row(row: &Row<'_>) -> rusqlite::Result<VaultDocument> {
    Ok(VaultDocument {
        id: row.get(0)?,
        title: row.get(1)?,
        category: row.get(2)?,
        doc_number: row.get(3)?,
        issued_at: row.get(4)?,
        expires_at: row.get(5)?,
        tags: row.get(6)?,
        notes: row.get(7)?,
        file_name: row.get(8)?,
        mime: row.get(9)?,
        byte_size: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn load_meta(connection: &Connection) -> Result<Option<(Vec<u8>, Vec<u8>, String)>, CommandError> {
    connection
        .query_row("SELECT salt, check_blob, hint FROM vault_meta WHERE id=1", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .optional()
        .map_err(CommandError::database)
}

fn load_document(connection: &Connection, id: &str) -> Result<VaultDocument, CommandError> {
    connection
        .query_row(
            "SELECT id,title,category,doc_number,issued_at,expires_at,tags,notes,file_name,mime,byte_size,created_at,updated_at
             FROM vault_documents WHERE id=?1",
            [id],
            read_row,
        )
        .optional()
        .map_err(CommandError::database)?
        .ok_or_else(|| CommandError::not_found("The document was not found."))
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn validate_pin(pin: &str) -> Result<(), CommandError> {
    let length = pin.chars().count();
    if length < MIN_PIN_CHARS {
        return Err(CommandError::validation("pin", "The PIN needs at least 6 characters."));
    }
    if length > MAX_PIN_CHARS {
        return Err(CommandError::validation("pin", "The PIN is too long."));
    }
    Ok(())
}

/// Writes the decrypted bytes of one document into `target`.
fn write_plaintext(
    dir: &Path,
    key: &[u8; KEY_LEN],
    id: &str,
    target: &Path,
) -> Result<(), CommandError> {
    let sealed = std::fs::read(stored_path(dir, id)).map_err(CommandError::system)?;
    let plaintext = open_sealed(key, &sealed)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(CommandError::system)?;
    }
    std::fs::write(target, plaintext).map_err(CommandError::system)
}

/// A file name that is safe on every platform and still recognisable to the
/// user when it lands in a folder or a zip.
fn safe_export_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '.' | '-' | '_' | ' ') {
                character
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_owned();
    if trimmed.is_empty() {
        "document".to_owned()
    } else {
        trimmed
    }
}

fn unique_name(used: &mut std::collections::HashSet<String>, name: String) -> String {
    if used.insert(name.clone()) {
        return name;
    }
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) => (stem.to_owned(), format!(".{extension}")),
        None => (name, String::new()),
    };
    let mut index = 2;
    loop {
        let candidate = format!("{stem} ({index}){extension}");
        if used.insert(candidate.clone()) {
            return candidate;
        }
        index += 1;
    }
}

// ---- commands -------------------------------------------------------------

#[tauri::command]
pub fn vault_status(
    db: State<'_, AppDb>,
    session: State<'_, VaultSession>,
) -> Result<VaultStatus, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    status_of(&connection, &session)
}

fn status_of(
    connection: &Connection,
    session: &VaultSession,
) -> Result<VaultStatus, CommandError> {
    let initialized = load_meta(connection)?.is_some();
    let (document_count, total_bytes): (i64, i64) = connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(byte_size),0) FROM vault_documents",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(CommandError::database)?;
    let unlocked = session
        .0
        .lock()
        .map_err(CommandError::system)?
        .is_some();
    Ok(VaultStatus { initialized, unlocked, document_count, total_bytes })
}

#[tauri::command]
pub fn vault_setup(
    db: State<'_, AppDb>,
    session: State<'_, VaultSession>,
    pin: String,
    hint: String,
) -> Result<VaultStatus, CommandError> {
    validate_pin(&pin)?;
    let hint = clean_text(&hint, "hint", 200)?;
    let connection = db.0.lock().map_err(CommandError::database)?;
    if load_meta(&connection)?.is_some() {
        return Err(CommandError::conflict("The vault is already set up."));
    }
    let salt = random_bytes::<16>().to_vec();
    let key = derive_key(&pin, &salt);
    let check = seal(&key, CHECK_PLAINTEXT)?;
    let stamp = now();
    connection
        .execute(
            "INSERT INTO vault_meta (id, salt, check_blob, hint, created_at, updated_at)
             VALUES (1, ?1, ?2, ?3, ?4, ?4)",
            params![salt, check, hint, stamp],
        )
        .map_err(CommandError::database)?;
    *session.0.lock().map_err(CommandError::system)? = Some(key);
    status_of(&connection, &session)
}

#[tauri::command]
pub fn vault_unlock(
    db: State<'_, AppDb>,
    session: State<'_, VaultSession>,
    pin: String,
) -> Result<VaultStatus, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let (salt, check, _) =
        load_meta(&connection)?.ok_or_else(|| CommandError::not_found("The vault is not set up."))?;
    let key = derive_key(&pin, &salt);
    match open_sealed(&key, &check) {
        Ok(plaintext) if plaintext == CHECK_PLAINTEXT => {}
        _ => return Err(CommandError::validation("pin", "The PIN is not correct.")),
    }
    *session.0.lock().map_err(CommandError::system)? = Some(key);
    status_of(&connection, &session)
}

#[tauri::command]
pub fn vault_lock(session: State<'_, VaultSession>) -> Result<(), CommandError> {
    *session.0.lock().map_err(CommandError::system)? = None;
    Ok(())
}

/// Re-seals every stored file under a new key. Done in place, one document at a
/// time, so a failure leaves the rest untouched and still readable by the old
/// PIN only if the metadata update did not run.
#[tauri::command]
pub fn vault_change_pin(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    session: State<'_, VaultSession>,
    old_pin: String,
    new_pin: String,
) -> Result<(), CommandError> {
    validate_pin(&new_pin)?;
    let directory = vault_dir_for(&app)?;
    let connection = db.0.lock().map_err(CommandError::database)?;
    let (salt, check, hint) =
        load_meta(&connection)?.ok_or_else(|| CommandError::not_found("The vault is not set up."))?;
    let old_key = derive_key(&old_pin, &salt);
    match open_sealed(&old_key, &check) {
        Ok(plaintext) if plaintext == CHECK_PLAINTEXT => {}
        _ => return Err(CommandError::validation("oldPin", "The current PIN is not correct.")),
    }

    let new_salt = random_bytes::<16>().to_vec();
    let new_key = derive_key(&new_pin, &new_salt);
    let ids: Vec<String> = {
        let mut statement = connection
            .prepare("SELECT id FROM vault_documents")
            .map_err(CommandError::database)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(CommandError::database)?;
        let collected = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(CommandError::database)?;
        collected
    };
    for id in &ids {
        let path = stored_path(&directory, id);
        if !path.is_file() {
            continue;
        }
        let sealed = std::fs::read(&path).map_err(CommandError::system)?;
        let plaintext = open_sealed(&old_key, &sealed)?;
        std::fs::write(&path, seal(&new_key, &plaintext)?).map_err(CommandError::system)?;
    }
    connection
        .execute(
            "UPDATE vault_meta SET salt=?1, check_blob=?2, hint=?3, updated_at=?4 WHERE id=1",
            params![new_salt, seal(&new_key, CHECK_PLAINTEXT)?, hint, now()],
        )
        .map_err(CommandError::database)?;
    *session.0.lock().map_err(CommandError::system)? = Some(new_key);
    Ok(())
}

#[tauri::command]
pub fn vault_list_documents(db: State<'_, AppDb>) -> Result<Vec<VaultDocument>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let mut statement = connection
        .prepare(
            "SELECT id,title,category,doc_number,issued_at,expires_at,tags,notes,file_name,mime,byte_size,created_at,updated_at
             FROM vault_documents ORDER BY created_at DESC",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], read_row)
        .map_err(CommandError::database)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

/// Opens the native picker and hands back the chosen paths. Importing by path
/// (instead of shipping bytes through IPC) keeps a 40 MB scan from turning into
/// a 40 MB JSON array.
#[tauri::command]
pub fn vault_pick_files(app: tauri::AppHandle) -> Result<Vec<String>, CommandError> {
    let picked = app
        .dialog()
        .file()
        .add_filter(
            "Documents",
            &["pdf", "png", "jpg", "jpeg", "webp", "tif", "tiff", "doc", "docx", "xls", "xlsx", "txt"],
        )
        .blocking_pick_files();
    let Some(files) = picked else {
        return Ok(Vec::new());
    };
    let mut paths = Vec::new();
    for file in files {
        let path = file.into_path().map_err(CommandError::system)?;
        paths.push(path.to_string_lossy().to_string());
    }
    Ok(paths)
}

#[tauri::command]
pub fn vault_import_document(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    session: State<'_, VaultSession>,
    path: String,
    draft: VaultDraft,
) -> Result<VaultDocument, CommandError> {
    let source = PathBuf::from(&path);
    let file_name = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| CommandError::validation("path", "That file cannot be read."))?;
    let metadata = std::fs::metadata(&source).map_err(CommandError::system)?;
    if !metadata.is_file() {
        return Err(CommandError::validation("path", "That file cannot be read."));
    }
    if metadata.len() as usize > MAX_DOCUMENT_BYTES {
        return Err(CommandError::validation("path", "The file is larger than 64 MB."));
    }
    let fallback = source
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.clone());
    let bytes = std::fs::read(&source).map_err(CommandError::system)?;
    store_document(&app, &db, &session, file_name, None, bytes, draft, &fallback)
}

/// The phone picker hands the WebView a `File`, not a filesystem path, so the
/// Android build sends the bytes through IPC instead. Desktop keeps the
/// path-based command above so a 40 MB scan never becomes a 40 MB JSON string.
#[tauri::command]
pub fn vault_import_document_bytes(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    session: State<'_, VaultSession>,
    file_name: String,
    mime: String,
    base64: String,
    draft: VaultDraft,
) -> Result<VaultDocument, CommandError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|_| CommandError::validation("file", "That file cannot be read."))?;
    if bytes.is_empty() {
        return Err(CommandError::validation("file", "That file is empty."));
    }
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(CommandError::validation("file", "The file is larger than 64 MB."));
    }
    let fallback = Path::new(&file_name)
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".to_string());
    store_document(&app, &db, &session, file_name, Some(mime), bytes, draft, &fallback)
}

fn store_document(
    app: &tauri::AppHandle,
    db: &State<'_, AppDb>,
    session: &State<'_, VaultSession>,
    file_name: String,
    mime: Option<String>,
    bytes: Vec<u8>,
    draft: VaultDraft,
    fallback: &str,
) -> Result<VaultDocument, CommandError> {
    let key = session_key(session)?;
    let draft = clean_draft(draft, fallback)?;
    let id = Uuid::new_v4().simple().to_string();
    let directory = vault_dir_for(app)?;
    std::fs::create_dir_all(&directory).map_err(CommandError::system)?;
    std::fs::write(stored_path(&directory, &id), seal(&key, &bytes)?)
        .map_err(CommandError::system)?;

    let mime = mime
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| mime_for(&file_name).to_string());
    let stamp = now();
    let connection = db.0.lock().map_err(CommandError::database)?;
    connection
        .execute(
            "INSERT INTO vault_documents
             (id,title,category,doc_number,issued_at,expires_at,tags,notes,file_name,mime,byte_size,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)",
            params![
                id,
                draft.title,
                draft.category,
                draft.doc_number,
                draft.issued_at,
                draft.expires_at,
                draft.tags,
                draft.notes,
                file_name,
                mime,
                bytes.len() as i64,
                stamp
            ],
        )
        .map_err(CommandError::database)?;
    load_document(&connection, &id)
}

#[tauri::command]
pub fn vault_update_document(
    db: State<'_, AppDb>,
    id: String,
    draft: VaultDraft,
) -> Result<VaultDocument, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let existing = load_document(&connection, &id)?;
    let draft = clean_draft(draft, &existing.title)?;
    connection
        .execute(
            "UPDATE vault_documents
             SET title=?2, category=?3, doc_number=?4, issued_at=?5, expires_at=?6, tags=?7, notes=?8, updated_at=?9
             WHERE id=?1",
            params![
                id,
                draft.title,
                draft.category,
                draft.doc_number,
                draft.issued_at,
                draft.expires_at,
                draft.tags,
                draft.notes,
                now()
            ],
        )
        .map_err(CommandError::database)?;
    load_document(&connection, &id)
}

#[tauri::command]
pub fn vault_delete_documents(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    ids: Vec<String>,
) -> Result<u32, CommandError> {
    let directory = vault_dir_for(&app)?;
    let connection = db.0.lock().map_err(CommandError::database)?;
    let mut removed = 0;
    for id in ids {
        if !id.chars().all(|character| character.is_ascii_hexdigit()) {
            continue;
        }
        let _ = std::fs::remove_file(stored_path(&directory, &id));
        removed += connection
            .execute("DELETE FROM vault_documents WHERE id=?1", [&id])
            .map_err(CommandError::database)? as u32;
    }
    Ok(removed)
}

#[tauri::command]
pub fn vault_read_document(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    session: State<'_, VaultSession>,
    id: String,
) -> Result<VaultFile, CommandError> {
    let key = session_key(&session)?;
    let connection = db.0.lock().map_err(CommandError::database)?;
    let document = load_document(&connection, &id)?;
    drop(connection);
    if document.byte_size as usize > MAX_PREVIEW_BYTES {
        return Err(CommandError::validation(
            "id",
            "This file is too large to preview. Save a copy instead.",
        ));
    }
    let directory = vault_dir_for(&app)?;
    let sealed = std::fs::read(stored_path(&directory, &id)).map_err(CommandError::system)?;
    let plaintext = open_sealed(&key, &sealed)?;
    Ok(VaultFile {
        mime: document.mime,
        file_name: document.file_name,
        base64: base64::engine::general_purpose::STANDARD.encode(plaintext),
    })
}

#[tauri::command]
pub fn vault_save_copy(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    session: State<'_, VaultSession>,
    id: String,
    dest: Option<String>,
) -> Result<String, CommandError> {
    let key = session_key(&session)?;
    let document = {
        let connection = db.0.lock().map_err(CommandError::database)?;
        load_document(&connection, &id)?
    };
    let target = match dest.filter(|value| !value.trim().is_empty()) {
        Some(path) => PathBuf::from(path),
        None => {
            // Android's save dialog hands back a content:// URI that Rust
            // cannot write to, so the phone drops the copy in the app's own
            // Downloads folder and tells the user where it went.
            #[cfg(target_os = "android")]
            {
                let dir = app.path().download_dir().map_err(CommandError::system)?;
                std::fs::create_dir_all(&dir).map_err(CommandError::system)?;
                dir.join(safe_export_name(&document.file_name))
            }
            #[cfg(not(target_os = "android"))]
            {
                let picked = app
                    .dialog()
                    .file()
                    .set_file_name(safe_export_name(&document.file_name))
                    .blocking_save_file();
                match picked {
                    Some(file) => file.into_path().map_err(CommandError::system)?,
                    None => return Ok(String::new()),
                }
            }
        }
    };
    write_plaintext(&vault_dir_for(&app)?, &key, &id, &target)?;
    Ok(target.to_string_lossy().to_string())
}

/// Bundles the selected documents into one zip. Names inside the archive are
/// the original file names, de-duplicated, so the archive is usable outside
/// RESA (that is the point of handing it to a bank or an employer).
#[tauri::command]
pub fn vault_export_zip(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    session: State<'_, VaultSession>,
    ids: Vec<String>,
    dest: Option<String>,
) -> Result<VaultExport, CommandError> {
    let key = session_key(&session)?;
    let documents = {
        let connection = db.0.lock().map_err(CommandError::database)?;
        let mut statement = connection
            .prepare(
                "SELECT id,title,category,doc_number,issued_at,expires_at,tags,notes,file_name,mime,byte_size,created_at,updated_at
                 FROM vault_documents ORDER BY title",
            )
            .map_err(CommandError::database)?;
        let rows = statement
            .query_map([], read_row)
            .map_err(CommandError::database)?;
        let all = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(CommandError::database)?;
        if ids.is_empty() {
            all
        } else {
            all.into_iter().filter(|document| ids.contains(&document.id)).collect()
        }
    };
    if documents.is_empty() {
        return Err(CommandError::validation("ids", "Nothing is selected."));
    }

    let target = match dest.filter(|value| !value.trim().is_empty()) {
        Some(path) => PathBuf::from(path),
        None => {
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M");
            #[cfg(target_os = "android")]
            {
                let dir = app.path().download_dir().map_err(CommandError::system)?;
                std::fs::create_dir_all(&dir).map_err(CommandError::system)?;
                dir.join(format!("resa-documents-{stamp}.zip"))
            }
            #[cfg(not(target_os = "android"))]
            {
                let picked = app
                    .dialog()
                    .file()
                    .set_file_name(format!("resa-documents-{stamp}.zip"))
                    .add_filter("ZIP", &["zip"])
                    .blocking_save_file();
                match picked {
                    Some(file) => file.into_path().map_err(CommandError::system)?,
                    None => return Ok(VaultExport { path: String::new(), count: 0 }),
                }
            }
        }
    };

    let directory = vault_dir_for(&app)?;
    let file = std::fs::File::create(&target).map_err(CommandError::system)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut used = std::collections::HashSet::new();
    let mut count = 0;
    for document in &documents {
        let sealed = std::fs::read(stored_path(&directory, &document.id))
            .map_err(CommandError::system)?;
        let plaintext = open_sealed(&key, &sealed)?;
        let name = unique_name(&mut used, safe_export_name(&document.file_name));
        zip.start_file(name, options)
            .map_err(|error| CommandError::system(error.to_string()))?;
        zip.write_all(&plaintext).map_err(CommandError::system)?;
        count += 1;
    }
    zip.finish().map_err(|error| CommandError::system(error.to_string()))?;
    Ok(VaultExport { path: target.to_string_lossy().to_string(), count })
}

/// Decrypts one document into a scratch folder and opens it with the system
/// handler. The plaintext copy is removed on the next open so a stray temp file
/// does not outlive the session.
#[tauri::command]
pub fn vault_open_document(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    session: State<'_, VaultSession>,
    id: String,
) -> Result<(), CommandError> {
    let key = session_key(&session)?;
    let document = {
        let connection = db.0.lock().map_err(CommandError::database)?;
        load_document(&connection, &id)?
    };
    let base = app.path().app_data_dir().map_err(CommandError::system)?;
    let preview = base.join(PREVIEW_DIR);
    let _ = std::fs::remove_dir_all(&preview);
    std::fs::create_dir_all(&preview).map_err(CommandError::system)?;
    let target = preview.join(safe_export_name(&document.file_name));
    write_plaintext(&vault_dir_for(&app)?, &key, &id, &target)?;
    if crate::shell::open_with_default_handler(&target) {
        Ok(())
    } else {
        Err(CommandError::reported("No application can open this file type."))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        clean_draft, derive_key, open_sealed, safe_export_name, seal, unique_name, VaultDraft,
    };

    fn draft(title: &str) -> VaultDraft {
        VaultDraft {
            title: title.to_owned(),
            category: "identity".to_owned(),
            doc_number: String::new(),
            issued_at: None,
            expires_at: None,
            tags: String::new(),
            notes: String::new(),
        }
    }

    #[test]
    fn a_sealed_document_only_opens_with_the_same_pin() {
        let salt = [7u8; 16];
        let key = derive_key("123456", &salt);
        let sealed = seal(&key, b"national id scan").unwrap();
        assert_eq!(open_sealed(&key, &sealed).unwrap(), b"national id scan");
        let wrong = derive_key("123457", &salt);
        assert!(open_sealed(&wrong, &sealed).is_err());
    }

    #[test]
    fn sealing_twice_produces_different_bytes() {
        let key = derive_key("123456", &[1u8; 16]);
        let first = seal(&key, b"same").unwrap();
        let second = seal(&key, b"same").unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn a_tampered_blob_is_rejected() {
        let key = derive_key("123456", &[1u8; 16]);
        let mut sealed = seal(&key, b"contract").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0xff;
        assert!(open_sealed(&key, &sealed).is_err());
    }

    #[test]
    fn export_names_lose_path_characters_and_keep_their_extension() {
        assert_eq!(safe_export_name("passport scan.pdf"), "passport scan.pdf");
        assert_eq!(safe_export_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_export_name("   "), "document");
    }

    #[test]
    fn duplicate_names_get_a_counter() {
        let mut used = std::collections::HashSet::new();
        assert_eq!(unique_name(&mut used, "a.pdf".into()), "a.pdf");
        assert_eq!(unique_name(&mut used, "a.pdf".into()), "a (2).pdf");
        assert_eq!(unique_name(&mut used, "a.pdf".into()), "a (3).pdf");
    }

    #[test]
    fn a_draft_falls_back_to_the_file_name_and_a_known_category() {
        let cleaned = clean_draft(
            VaultDraft { category: "nonsense".into(), ..draft("") },
            "national-card",
        )
        .unwrap();
        assert_eq!(cleaned.title, "national-card");
        assert_eq!(cleaned.category, "other");
    }

    #[test]
    fn a_draft_rejects_a_bad_date() {
        let bad = VaultDraft { issued_at: Some("1403/05/01".into()), ..draft("x") };
        assert!(clean_draft(bad, "x").is_err());
    }
}
