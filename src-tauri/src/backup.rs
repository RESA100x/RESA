//! One-click backup and data transfer.
//!
//! A backup is a single `.resa` file (a zip) holding a consistent snapshot of
//! the SQLite database and every attachment. Import validates the archive
//! before touching anything, keeps a copy of the current database, then swaps
//! both in place and reopens the connection.

use crate::db::{self, AppDb};
use crate::error::CommandError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::State;
use tauri::Manager;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const MANIFEST_NAME: &str = "manifest.json";
const DATABASE_NAME: &str = db::DATABASE_FILE;
/// Archives written before the rebrand carry the database under the old name;
/// they must keep importing.
const LEGACY_DATABASE_NAME: &str = db::LEGACY_DATABASE_FILE;
const ATTACHMENTS_DIR: &str = "attachments";
// Image bytes live beside the database, not inside it: note attachments and
// the sticker board's uploaded pictures, plus book covers. All travel with the
// backup.
const STICKERS_DIR: &str = "stickers";
const COVERS_DIR: &str = "covers";
// The vault holds AES-GCM sealed documents and the account screen holds the
// avatar. Both are opaque bytes on disk, so they travel with a backup and are
// still only readable with the vault PIN.
const VAULT_DIR: &str = crate::vault::VAULT_DIR;
const AVATARS_DIR: &str = crate::profile::AVATARS_DIR;
const ASSET_DIRS: [&str; 5] = [ATTACHMENTS_DIR, STICKERS_DIR, COVERS_DIR, VAULT_DIR, AVATARS_DIR];
const FORMAT: &str = "resa-backup";
const FORMAT_VERSION: u32 = 1;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Header inside every archive. The import dialog reads it first so the user
/// can see when and by which version a file was written before replacing data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format: String,
    pub version: u32,
    pub app_version: String,
    pub created_at: String,
    pub attachments: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub path: String,
    pub attachments: usize,
    pub byte_size: u64,
    /// Only set on import: where the previous database/attachments were kept.
    pub safety_copy: Option<String>,
}

fn timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn file_timestamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S%.3f").to_string()
}

fn ensure_parent(path: &Path) -> Result<(), CommandError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(CommandError::system)?;
        }
    }
    Ok(())
}

/// `VACUUM INTO` writes a consistent copy without touching the live file, which
/// matters while the app keeps writing through the shared connection.
fn snapshot_database(connection: &Connection, target: &Path) -> Result<(), CommandError> {
    let destination = target.to_string_lossy().to_string();
    connection
        .execute("VACUUM INTO ?1", [destination])
        .map_err(CommandError::database)?;
    Ok(())
}

fn attachment_files(dir: &Path) -> Result<Vec<PathBuf>, CommandError> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(CommandError::system)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .collect();
    files.sort();
    Ok(files)
}

/// Every on-disk asset directory paired with its files, so the archive keeps
/// the folder each file came from.
fn asset_files(app_data_dir: &Path) -> Result<Vec<(&'static str, PathBuf)>, CommandError> {
    let mut assets = Vec::new();
    for dir in ASSET_DIRS {
        for file in attachment_files(&app_data_dir.join(dir))? {
            assets.push((dir, file));
        }
    }
    Ok(assets)
}

pub fn export(
    connection: &Connection,
    app_data_dir: &Path,
    destination: &Path,
) -> Result<BackupSummary, CommandError> {
    ensure_parent(destination)?;
    let scratch = app_data_dir.join(format!("backup-{}.sqlite", file_timestamp()));
    let result = (|| -> Result<BackupSummary, CommandError> {
        snapshot_database(connection, &scratch)?;
        let assets = asset_files(app_data_dir)?;
        let attachments = assets.iter().filter(|(dir, _)| *dir == ATTACHMENTS_DIR).count();
        let file = fs::File::create(destination).map_err(CommandError::system)?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let manifest = BackupManifest {
            format: FORMAT.into(),
            version: FORMAT_VERSION,
            app_version: APP_VERSION.into(),
            created_at: timestamp(),
            attachments,
        };
        zip.start_file(MANIFEST_NAME, options)
            .map_err(CommandError::system)?;
        zip.write_all(
            serde_json::to_string_pretty(&manifest)
                .map_err(CommandError::system)?
                .as_bytes(),
        )
        .map_err(CommandError::system)?;
        zip.start_file(DATABASE_NAME, options)
            .map_err(CommandError::system)?;
        let mut database = fs::File::open(&scratch).map_err(CommandError::system)?;
        std::io::copy(&mut database, &mut zip).map_err(CommandError::system)?;
        for (dir, file) in &assets {
            let name = file
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| CommandError::system("asset name is not valid UTF-8"))?;
            zip.start_file(format!("{dir}/{name}"), options)
                .map_err(CommandError::system)?;
            let mut source = fs::File::open(file).map_err(CommandError::system)?;
            std::io::copy(&mut source, &mut zip).map_err(CommandError::system)?;
        }
        zip.finish().map_err(CommandError::system)?;
        let byte_size = fs::metadata(destination).map_err(CommandError::system)?.len();
        Ok(BackupSummary {
            path: destination.to_string_lossy().to_string(),
            attachments,
            byte_size,
            safety_copy: None,
        })
    })();
    let _ = fs::remove_file(&scratch);
    result
}

pub fn read_manifest(source: &Path) -> Result<BackupManifest, CommandError> {
    let file = fs::File::open(source).map_err(CommandError::system)?;
    let mut archive = ZipArchive::new(file).map_err(CommandError::system)?;
    let manifest: BackupManifest = {
        let mut entry = archive.by_name(MANIFEST_NAME).map_err(CommandError::system)?;
        let mut text = String::new();
        entry.read_to_string(&mut text).map_err(CommandError::system)?;
        serde_json::from_str(&text).map_err(CommandError::system)?
    };
    if manifest.format != FORMAT {
        return Err(CommandError::reported("This file is not a RESA backup."));
    }
    if manifest.version > FORMAT_VERSION {
        return Err(CommandError::reported(
            "This backup comes from a newer RESA version.",
        ));
    }
    if archive.by_name(DATABASE_NAME).is_err() && archive.by_name(LEGACY_DATABASE_NAME).is_err() {
        return Err(CommandError::reported("This backup has no database."));
    }
    Ok(manifest)
}

/// Extraction target for import. Everything lands in a staging directory first
/// so a corrupt archive cannot leave the app without a database.
struct Staging {
    root: PathBuf,
}

impl Staging {
    fn new(app_data_dir: &Path) -> Result<Self, CommandError> {
        let root = app_data_dir.join(format!("import-{}", file_timestamp()));
        fs::create_dir_all(&root).map_err(CommandError::system)?;
        Ok(Self { root })
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn extract(source: &Path, staging: &Staging) -> Result<usize, CommandError> {
    let file = fs::File::open(source).map_err(CommandError::system)?;
    let mut archive = ZipArchive::new(file).map_err(CommandError::system)?;
    let mut attachments = 0;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(CommandError::system)?;
        let Some(name) = entry.enclosed_name() else {
            return Err(CommandError::reported("This backup contains an unsafe path."));
        };
        let name = name.to_path_buf();
        if name == Path::new(DATABASE_NAME) || name == Path::new(LEGACY_DATABASE_NAME) {
            let mut output = fs::File::create(staging.root.join(DATABASE_NAME))
                .map_err(CommandError::system)?;
            std::io::copy(&mut entry, &mut output).map_err(CommandError::system)?;
            output.sync_all().map_err(CommandError::system)?;
        } else if entry.is_file() {
            let Some(dir) = ASSET_DIRS.iter().find(|dir| name.starts_with(dir)) else {
                continue;
            };
            let Some(file_name) = name.file_name() else { continue };
            let target = staging.root.join(dir);
            fs::create_dir_all(&target).map_err(CommandError::system)?;
            let mut output = fs::File::create(target.join(file_name)).map_err(CommandError::system)?;
            std::io::copy(&mut entry, &mut output).map_err(CommandError::system)?;
            if *dir == ATTACHMENTS_DIR {
                attachments += 1;
            }
        }
    }
    Ok(attachments)
}

/// Verifies the staged database really is a RESA database before it replaces
/// the live one; a file that is not SQLite, or one from a newer release, is
/// rejected.
fn verify_database(path: &Path) -> Result<(), CommandError> {
    let connection = Connection::open(path).map_err(CommandError::database)?;
    let core_tables: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
              WHERE type='table' AND name IN ('tasks','events','notes','schema_migrations')",
            [],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if core_tables < 4 {
        return Err(CommandError::reported("This backup is not a RESA database."));
    }
    let version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version),0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if version > db::latest_migration() {
        return Err(CommandError::reported(
            "This backup comes from a newer RESA version.",
        ));
    }
    Ok(())
}

/// Swaps one asset directory for the staged copy. A directory the backup does
/// not carry (an older archive) is left untouched instead of being emptied.
fn replace_dir(app_data_dir: &Path, staged: &Path, name: &str) -> Result<Option<PathBuf>, CommandError> {
    if !staged.exists() {
        return Ok(None);
    }
    let target = app_data_dir.join(name);
    let mut previous = None;
    if target.exists() {
        let retired = app_data_dir.join(format!("{name}.pre-import-{}", file_timestamp()));
        fs::rename(&target, &retired).map_err(CommandError::system)?;
        previous = Some(retired);
    }
    fs::create_dir_all(&target).map_err(CommandError::system)?;
    for entry in fs::read_dir(staged).map_err(CommandError::system)? {
        let entry = entry.map_err(CommandError::system)?;
        if !entry.path().is_file() {
            continue;
        }
        fs::rename(entry.path(), target.join(entry.file_name())).map_err(CommandError::system)?;
    }
    Ok(previous)
}

/// Imports a backup over the live data and reopens the shared connection.
pub fn import(
    app_data_dir: &Path,
    source: &Path,
    connection: &mut Connection,
) -> Result<BackupSummary, CommandError> {
    read_manifest(source)?;
    let staging = Staging::new(app_data_dir)?;
    let attachments = extract(source, &staging)?;
    let staged_database = staging.root.join(DATABASE_NAME);
    if !staged_database.exists() {
        return Err(CommandError::reported("This backup has no database."));
    }
    verify_database(&staged_database)?;

    let live_database = app_data_dir.join(DATABASE_NAME);
    let safety = app_data_dir.join(format!("{DATABASE_NAME}.pre-import-{}", file_timestamp()));
    if live_database.exists() {
        fs::copy(&live_database, &safety).map_err(CommandError::system)?;
    }
    // WAL sidecars belong to the old database; leaving them behind would
    // corrupt the freshly imported one.
    for suffix in ["-wal", "-shm"] {
        let _ = fs::remove_file(app_data_dir.join(format!("{DATABASE_NAME}{suffix}")));
    }
    fs::copy(&staged_database, &live_database).map_err(CommandError::system)?;
    let mut previous_attachments = None;
    for dir in ASSET_DIRS {
        let previous = replace_dir(app_data_dir, &staging.root.join(dir), dir)?;
        previous_attachments = previous_attachments.or(previous);
    }

    *connection = db::open_database(live_database.clone()).map_err(CommandError::database)?;
    let byte_size = fs::metadata(source).map_err(CommandError::system)?.len();
    Ok(BackupSummary {
        path: source.to_string_lossy().to_string(),
        attachments,
        byte_size,
        safety_copy: Some(
            previous_attachments
                .or(Some(safety))
                .unwrap_or_else(|| live_database.clone())
                .to_string_lossy()
                .to_string(),
        ),
    })
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    app.path().app_data_dir().map_err(CommandError::system)
}

fn backups_folder_path(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    let directory = match app.path().document_dir() {
        Ok(documents) => documents.join("RESA Backups"),
        Err(_) => app_data_dir(app)?.join("backups"),
    };
    fs::create_dir_all(&directory).map_err(CommandError::system)?;
    Ok(directory)
}

/// A timestamped name, so repeated exports never overwrite each other and the
/// newest file sorts last in the folder.
fn export_file_name() -> String {
    format!(
        "resa-backup-{}.resa",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    )
}

/// Writes an archive into `folder`, creating it if needed. Used by the
/// one-click export and by the auto-export on exit, which both target a fixed
/// folder instead of asking for a path.
pub fn export_to_folder(
    app: &tauri::AppHandle,
    connection: &Connection,
    folder: &Path,
) -> Result<BackupSummary, CommandError> {
    let directory = app_data_dir(app)?;
    fs::create_dir_all(folder).map_err(CommandError::system)?;
    let mut destination = folder.join(export_file_name());
    let mut attempt = 1;
    while destination.exists() {
        destination = folder.join(format!(
            "resa-backup-{}-{attempt}.resa",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        ));
        attempt += 1;
    }
    export(connection, &directory, &destination)
}

#[tauri::command]
pub fn export_backup(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    path: String,
) -> Result<BackupSummary, CommandError> {
    let directory = app_data_dir(&app)?;
    let connection = db.0.lock().map_err(CommandError::database)?;
    let summary = export(&connection, &directory, Path::new(&path))?;
    crate::settings::record_last_backup(&connection, &timestamp())
        .map_err(CommandError::database)?;
    Ok(summary)
}

/// One-click export to the configured folder (or the snapshot folder when none
/// is set). No save dialog, so "export before I switch devices" is one click.
#[tauri::command]
pub fn quick_export_backup(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
) -> Result<BackupSummary, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let settings =
        crate::settings::read_app_settings(&connection).map_err(CommandError::database)?;
    let folder = match settings.backup_folder.as_deref().map(Path::new) {
        Some(folder) if !folder.as_os_str().is_empty() => folder.to_path_buf(),
        _ => backups_folder_path(&app)?,
    };
    let summary = export_to_folder(&app, &connection, &folder)?;
    crate::settings::record_last_backup(&connection, &timestamp())
        .map_err(CommandError::database)?;
    Ok(summary)
}

/// Reads an archive's header without touching live data, so the import dialog
/// can show what the file holds before the user confirms.
#[tauri::command]
pub fn read_backup_manifest(path: String) -> Result<BackupManifest, CommandError> {
    read_manifest(Path::new(&path))
}

/// Runs from `RunEvent::ExitRequested`. Best-effort: a failure is logged and
/// the app still quits, because losing an automatic copy must never trap the
/// user in the app.
pub fn auto_export_on_exit(app: &tauri::AppHandle) {
    let state = app.state::<AppDb>();
    // Never wait for the database here: this runs on the UI thread while the
    // app is quitting, and a background sync may still hold the lock. Skipping
    // one automatic copy is far better than a hung process that cannot exit.
    let Ok(connection) = state.0.try_lock() else {
        eprintln!("automatic backup on exit skipped: database is busy");
        return;
    };
    let Ok(settings) = crate::settings::read_app_settings(&connection) else {
        return;
    };
    if !settings.auto_backup_on_close {
        return;
    }
    let folder = match settings.backup_folder.as_deref().map(Path::new) {
        Some(folder) if !folder.as_os_str().is_empty() => folder.to_path_buf(),
        _ => match backups_folder_path(app) {
            Ok(folder) => folder,
            Err(_) => return,
        },
    };
    match export_to_folder(app, &connection, &folder) {
        Ok(_) => {
            let _ = crate::settings::record_last_backup(&connection, &timestamp());
        }
        Err(error) => eprintln!("automatic backup on exit failed: {}", error.message),
    }
}

#[tauri::command]
pub fn import_backup(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    path: String,
) -> Result<BackupSummary, CommandError> {
    let directory = app_data_dir(&app)?;
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    import(&directory, Path::new(&path), &mut connection)
}

/// Where the automatic daily snapshots live. Kept outside the app data folder
/// so a wiped profile or a cleanup tool cannot take the only copy with it.
#[tauri::command]
pub fn backups_folder(app: tauri::AppHandle) -> Result<String, CommandError> {
    Ok(backups_folder_path(&app)?.to_string_lossy().to_string())
}

/// Opens that folder in the system file manager, so "where are my backups?"
/// has a one-click answer.
#[tauri::command]
pub fn open_backups_folder(app: tauri::AppHandle) -> Result<String, CommandError> {
    let path = backups_folder(app)?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(CommandError::system)?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(CommandError::system)?;
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::{export, import, read_manifest, FORMAT};
    use crate::db::migrate;
    use rusqlite::Connection;
    use std::io::Write;

    const NOTE_ROW: &str = "INSERT INTO notes(id,content,color,pinned,style_variant,icon,created_at,updated_at) \
         VALUES ('n1','{\"ops\":[{\"insert\":\"hello\"}]}','#F5E6A8',0,0,'','t','t');";

    fn database(path: &std::path::Path) -> Connection {
        let mut connection = Connection::open(path).unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrate(&mut connection).unwrap();
        connection.execute_batch(NOTE_ROW).unwrap();
        connection
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("resa-backup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn export_then_import_round_trips_database_and_attachments() {
        let source_dir = temp_dir("source");
        let connection = database(&source_dir.join(super::DATABASE_NAME));
        let attachments = source_dir.join("attachments");
        std::fs::create_dir_all(&attachments).unwrap();
        std::fs::write(attachments.join("logo.txt"), b"image-bytes").unwrap();
        let stickers = source_dir.join("stickers");
        std::fs::create_dir_all(&stickers).unwrap();
        std::fs::write(stickers.join("asset-1"), b"sticker-bytes").unwrap();
        let archive = source_dir.join("export.resa");

        let summary = export(&connection, &source_dir, &archive).unwrap();
        assert_eq!(summary.attachments, 1);
        assert!(summary.byte_size > 0);
        assert_eq!(read_manifest(&archive).unwrap().format, FORMAT);
        drop(connection);

        let target_dir = temp_dir("target");
        let mut target = Connection::open(target_dir.join(super::DATABASE_NAME)).unwrap();
        target.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrate(&mut target).unwrap();
        let imported = import(&target_dir, &archive, &mut target).unwrap();
        assert_eq!(imported.attachments, 1);
        assert!(imported.safety_copy.is_some());
        assert_eq!(
            std::fs::read_to_string(target_dir.join("attachments/logo.txt")).unwrap(),
            "image-bytes"
        );
        assert_eq!(
            std::fs::read_to_string(target_dir.join("stickers/asset-1")).unwrap(),
            "sticker-bytes"
        );
        let notes: i64 = target
            .query_row("SELECT COUNT(*) FROM notes WHERE id='n1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(notes, 1);
    }

    #[test]
    fn import_rejects_files_that_are_not_backups() {
        let dir = temp_dir("reject");
        let not_a_backup = dir.join("random.resa");
        std::fs::write(&not_a_backup, b"definitely not a zip").unwrap();
        let mut connection = Connection::open(dir.join(super::DATABASE_NAME)).unwrap();
        let error = import(&dir, &not_a_backup, &mut connection).unwrap_err();
        assert_eq!(error.code, "system_error");
    }

    #[test]
    fn imports_an_archive_written_with_the_old_database_name() {
        let source_dir = temp_dir("legacy-source");
        let connection = database(&source_dir.join("legacy.sqlite"));
        drop(connection);
        let archive = source_dir.join("legacy.resa");
        let file = std::fs::File::create(&archive).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(
            br#"{"format":"resa-backup","version":1,"appVersion":"0.2.0","createdAt":"t","attachments":0}"#,
        )
        .unwrap();
        zip.start_file(super::LEGACY_DATABASE_NAME, options).unwrap();
        zip.write_all(&std::fs::read(source_dir.join("legacy.sqlite")).unwrap())
            .unwrap();
        zip.finish().unwrap();

        let target_dir = temp_dir("legacy-target");
        let mut target = Connection::open(target_dir.join(super::DATABASE_NAME)).unwrap();
        target.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrate(&mut target).unwrap();
        import(&target_dir, &archive, &mut target).unwrap();
        let notes: i64 = target
            .query_row("SELECT COUNT(*) FROM notes WHERE id='n1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(notes, 1);
    }

    #[test]
    fn manifest_from_a_newer_format_is_refused() {
        let dir = temp_dir("newer");
        let archive = dir.join("future.resa");
        let file = std::fs::File::create(&archive).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(
            br#"{"format":"resa-backup","version":99,"appVersion":"9","createdAt":"t","attachments":0}"#,
        )
        .unwrap();
        zip.start_file("nowly.sqlite", options).unwrap();
        zip.write_all(b"x").unwrap();
        zip.finish().unwrap();
        let error = read_manifest(&archive).unwrap_err();
        assert_eq!(error.code, "system_error");
    }
}
