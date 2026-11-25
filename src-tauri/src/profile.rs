//! The signed-in person's own record.
//!
//! One row, one person: this is the "who am I" card the account screen edits,
//! and the source for the shareable vCard. It is deliberately separate from the
//! phone book — contacts are other people, this is you.
//!
//! The avatar is a file on disk (`<app-data>/avatars/avatar.<ext>`) rather than
//! a blob in SQLite, for the same reason book covers are: the database stays
//! small and a backup carries the picture alongside it.

use crate::db::AppDb;
use crate::error::CommandError;
use base64::Engine as _;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

pub const AVATARS_DIR: &str = "avatars";
const AVATAR_STEM: &str = "avatar";
const MAX_AVATAR_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub full_name: String,
    pub birth_date: Option<String>,
    pub national_id: String,
    pub phone: String,
    pub email: String,
    pub job_title: String,
    pub organization: String,
    pub address: String,
    pub bio: String,
    /// Data URL for the picture, or empty when none is set.
    pub avatar: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDraft {
    #[serde(default)]
    pub full_name: String,
    #[serde(default)]
    pub birth_date: Option<String>,
    #[serde(default)]
    pub national_id: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub job_title: String,
    #[serde(default)]
    pub organization: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub bio: String,
    /// A new data URL, the unchanged file name, or empty to remove.
    #[serde(default)]
    pub avatar: String,
}

fn avatars_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(AVATARS_DIR)
}

fn avatar_path(app_data_dir: &Path, name: &str) -> PathBuf {
    avatars_dir(app_data_dir).join(name)
}

fn clean(value: &str, field: &str, limit: usize) -> Result<String, CommandError> {
    let trimmed = value.trim();
    if trimmed.chars().count() > limit {
        return Err(CommandError::validation(field, "This value is too long."));
    }
    Ok(trimmed.to_owned())
}

fn clean_birth_date(value: &Option<String>) -> Result<Option<String>, CommandError> {
    let Some(raw) = value.as_deref().map(str::trim).filter(|text| !text.is_empty()) else {
        return Ok(None);
    };
    let parsed = chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| CommandError::validation("birthDate", "Use a valid date."))?;
    Ok(Some(parsed.format("%Y-%m-%d").to_string()))
}

fn empty_profile() -> UserProfile {
    UserProfile {
        full_name: String::new(),
        birth_date: None,
        national_id: String::new(),
        phone: String::new(),
        email: String::new(),
        job_title: String::new(),
        organization: String::new(),
        address: String::new(),
        bio: String::new(),
        avatar: String::new(),
        updated_at: None,
    }
}

fn avatar_data_url(app_data_dir: &Path, name: &str) -> String {
    if name.is_empty() || !name.starts_with(AVATAR_STEM) {
        return String::new();
    }
    let path = avatar_path(app_data_dir, name);
    let Ok(bytes) = std::fs::read(&path) else {
        return String::new();
    };
    let mime = if name.ends_with(".png") {
        "image/png"
    } else if name.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    };
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn read_profile(connection: &Connection) -> Result<Option<UserProfile>, CommandError> {
    connection
        .query_row(
            "SELECT full_name,birth_date,national_id,phone,email,job_title,organization,address,bio,avatar,updated_at
             FROM user_profile WHERE id=1",
            [],
            |row| {
                Ok(UserProfile {
                    full_name: row.get(0)?,
                    birth_date: row.get(1)?,
                    national_id: row.get(2)?,
                    phone: row.get(3)?,
                    email: row.get(4)?,
                    job_title: row.get(5)?,
                    organization: row.get(6)?,
                    address: row.get(7)?,
                    bio: row.get(8)?,
                    avatar: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(CommandError::database)
}

fn decode_avatar(data_url: &str) -> Result<(String, Vec<u8>), CommandError> {
    let (extension, payload) = if let Some(payload) = data_url.strip_prefix("data:image/png;base64,") {
        ("png", payload)
    } else if let Some(payload) = data_url.strip_prefix("data:image/jpeg;base64,") {
        ("jpg", payload)
    } else if let Some(payload) = data_url.strip_prefix("data:image/webp;base64,") {
        ("webp", payload)
    } else {
        return Err(CommandError::validation("avatar", "Use a PNG, JPEG or WebP image."));
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|_| CommandError::validation("avatar", "Use a PNG, JPEG or WebP image."))?;
    if bytes.is_empty() || bytes.len() > MAX_AVATAR_BYTES {
        return Err(CommandError::validation("avatar", "The image is too large."));
    }
    Ok((extension.to_owned(), bytes))
}

fn remove_avatars(directory: &Path) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.path().is_file() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Turns the incoming avatar value into the file name the row should hold.
fn resolve_avatar(
    app_data_dir: &Path,
    existing: &str,
    incoming: &str,
) -> Result<String, CommandError> {
    if incoming.is_empty() {
        remove_avatars(&avatars_dir(app_data_dir));
        return Ok(String::new());
    }
    if incoming.starts_with("data:image/") {
        let (extension, bytes) = decode_avatar(incoming)?;
        let directory = avatars_dir(app_data_dir);
        std::fs::create_dir_all(&directory).map_err(CommandError::system)?;
        remove_avatars(&directory);
        let name = format!("{AVATAR_STEM}.{extension}");
        std::fs::write(directory.join(&name), bytes).map_err(CommandError::system)?;
        return Ok(name);
    }
    if incoming == existing {
        return Ok(existing.to_owned());
    }
    Err(CommandError::validation("avatar", "Use a PNG, JPEG or WebP image."))
}

fn vcard_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
        .replace('\r', "")
}

/// vCard 3.0: the format phones, Outlook and Google Contacts all import.
pub fn build_vcard(profile: &UserProfile) -> String {
    let name = profile.full_name.trim();
    let display = if name.is_empty() { "RESA" } else { name };
    let mut lines = vec![
        "BEGIN:VCARD".to_owned(),
        "VERSION:3.0".to_owned(),
        format!("N:;{};;;", vcard_escape(display)),
        format!("FN:{}", vcard_escape(display)),
    ];
    if !profile.organization.trim().is_empty() {
        let mut organization = format!("ORG:{}", vcard_escape(profile.organization.trim()));
        if !profile.job_title.trim().is_empty() {
            organization.push(';');
            organization.push_str(&vcard_escape(profile.job_title.trim()));
        }
        lines.push(organization);
    } else if !profile.job_title.trim().is_empty() {
        lines.push(format!("TITLE:{}", vcard_escape(profile.job_title.trim())));
    }
    if !profile.phone.trim().is_empty() {
        lines.push(format!("TEL;TYPE=CELL:{}", vcard_escape(profile.phone.trim())));
    }
    if !profile.email.trim().is_empty() {
        lines.push(format!("EMAIL;TYPE=INTERNET:{}", vcard_escape(profile.email.trim())));
    }
    if !profile.address.trim().is_empty() {
        lines.push(format!("ADR;TYPE=HOME:;;{};;;;", vcard_escape(profile.address.trim())));
    }
    if let Some(birth) = profile.birth_date.as_deref() {
        lines.push(format!("BDAY:{birth}"));
    }
    if !profile.bio.trim().is_empty() {
        lines.push(format!("NOTE:{}", vcard_escape(profile.bio.trim())));
    }
    lines.push("END:VCARD".to_owned());
    lines.join("\r\n")
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    app.path().app_data_dir().map_err(CommandError::system)
}

#[tauri::command]
pub fn profile_get(app: tauri::AppHandle, db: State<'_, AppDb>) -> Result<UserProfile, CommandError> {
    let directory = app_data_dir(&app)?;
    let connection = db.0.lock().map_err(CommandError::database)?;
    let mut profile = read_profile(&connection)?.unwrap_or_else(empty_profile);
    let avatar_name = std::mem::take(&mut profile.avatar);
    profile.avatar = avatar_data_url(&directory, &avatar_name);
    Ok(profile)
}

#[tauri::command]
pub fn profile_save(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    draft: ProfileDraft,
) -> Result<UserProfile, CommandError> {
    let directory = app_data_dir(&app)?;
    let connection = db.0.lock().map_err(CommandError::database)?;
    let existing = read_profile(&connection)?.unwrap_or_else(empty_profile);
    let full_name = clean(&draft.full_name, "fullName", 120)?;
    if full_name.is_empty() {
        return Err(CommandError::validation("fullName", "A name is required."));
    }
    let avatar = resolve_avatar(&directory, &existing.avatar, &draft.avatar)?;
    let stamp = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    connection
        .execute(
            "INSERT INTO user_profile
             (id,full_name,birth_date,national_id,phone,email,job_title,organization,address,bio,avatar,updated_at)
             VALUES (1,?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(id) DO UPDATE SET
               full_name=excluded.full_name, birth_date=excluded.birth_date,
               national_id=excluded.national_id, phone=excluded.phone,
               email=excluded.email, job_title=excluded.job_title,
               organization=excluded.organization, address=excluded.address,
               bio=excluded.bio, avatar=excluded.avatar, updated_at=excluded.updated_at",
            params![
                full_name,
                clean_birth_date(&draft.birth_date)?,
                clean(&draft.national_id, "nationalId", 40)?,
                clean(&draft.phone, "phone", 40)?,
                clean(&draft.email, "email", 160)?,
                clean(&draft.job_title, "jobTitle", 120)?,
                clean(&draft.organization, "organization", 160)?,
                clean(&draft.address, "address", 400)?,
                clean(&draft.bio, "bio", 1000)?,
                avatar,
                stamp
            ],
        )
        .map_err(CommandError::database)?;
    let mut profile = read_profile(&connection)?.unwrap_or_else(empty_profile);
    let avatar_name = std::mem::take(&mut profile.avatar);
    profile.avatar = avatar_data_url(&directory, &avatar_name);
    Ok(profile)
}

/// Writes the profile as a `.vcf` the user can send to anyone.
#[tauri::command]
pub fn profile_export_vcard(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    dest: Option<String>,
) -> Result<String, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let profile = read_profile(&connection)?.unwrap_or_else(empty_profile);
    drop(connection);
    let content = build_vcard(&profile);
    let target = match dest.filter(|value| !value.trim().is_empty()) {
        Some(path) => PathBuf::from(path),
        None => {
            let stem = if profile.full_name.trim().is_empty() {
                "resa-contact".to_owned()
            } else {
                profile.full_name.trim().replace(['/', '\\'], "-")
            };
            #[cfg(target_os = "android")]
            {
                let dir = app.path().download_dir().map_err(CommandError::system)?;
                std::fs::create_dir_all(&dir).map_err(CommandError::system)?;
                dir.join(format!("{stem}.vcf"))
            }
            #[cfg(not(target_os = "android"))]
            {
                let picked = app
                    .dialog()
                    .file()
                    .set_file_name(format!("{stem}.vcf"))
                    .add_filter("vCard", &["vcf"])
                    .blocking_save_file();
                match picked {
                    Some(file) => file.into_path().map_err(CommandError::system)?,
                    None => return Ok(String::new()),
                }
            }
        }
    };
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(CommandError::system)?;
    }
    std::fs::write(&target, content).map_err(CommandError::system)?;
    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::{build_vcard, vcard_escape, UserProfile};

    fn profile() -> UserProfile {
        UserProfile {
            full_name: "رضا احمدی".into(),
            birth_date: Some("1990-03-21".into()),
            national_id: String::new(),
            phone: "+989121234567".into(),
            email: "reza@example.com".into(),
            job_title: "مدیرعامل".into(),
            organization: "رسا".into(),
            address: "تهران، خیابان ولیعصر".into(),
            bio: String::new(),
            avatar: String::new(),
            updated_at: None,
        }
    }

    #[test]
    fn a_vcard_carries_the_fields_phones_import() {
        let card = build_vcard(&profile());
        assert!(card.starts_with("BEGIN:VCARD\r\nVERSION:3.0\r\n"));
        assert!(card.contains("FN:رضا احمدی"));
        assert!(card.contains("TEL;TYPE=CELL:+989121234567"));
        assert!(card.contains("ORG:رسا;مدیرعامل"));
        assert!(card.contains("BDAY:1990-03-21"));
        assert!(card.ends_with("END:VCARD"));
    }

    #[test]
    fn separators_inside_values_are_escaped() {
        assert_eq!(vcard_escape("a,b;c\\d"), "a\\,b\\;c\\\\d");
        assert_eq!(vcard_escape("line\nnext"), "line\\nnext");
    }

    #[test]
    fn an_empty_profile_still_produces_a_valid_card() {
        let card = build_vcard(&UserProfile {
            full_name: String::new(),
            birth_date: None,
            national_id: String::new(),
            phone: String::new(),
            email: String::new(),
            job_title: String::new(),
            organization: String::new(),
            address: String::new(),
            bio: String::new(),
            avatar: String::new(),
            updated_at: None,
        });
        assert!(card.contains("FN:RESA"));
        assert!(!card.contains("TEL:"));
    }
}
