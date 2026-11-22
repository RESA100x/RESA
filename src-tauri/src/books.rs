//! Home library: the books on the shelf, what is being read, what is still to
//! buy, and who borrowed what.
//!
//! A book row carries everything the module needs — status, progress, formats,
//! ownership, loan, recommender, cover — so the widget never has to join
//! anything to draw a card. The cover itself is a file under `covers/` beside
//! the database (the same place attachments and stickers live), and the row
//! only keeps its file name. Listing the shelf therefore never loads image
//! bytes, and the cover travels with the backup like every other asset.

use crate::db::AppDb;
use crate::error::CommandError;
use base64::Engine as _;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

pub const BOOK_STATUSES: &[&str] = &["unread", "reading", "read", "paused", "abandoned"];
pub const BOOK_FORMATS: &[&str] = &["physical", "ebook", "audio"];
pub const BOOK_OWNERSHIP: &[&str] = &["owned", "toBuy", "ordered"];
pub const BOOK_LOAN_DIRECTIONS: &[&str] = &["borrowed", "lent"];

pub const MAX_BOOKS: i64 = 5000;
const TITLE_MAX_CHARS: usize = 200;
const FIELD_MAX_CHARS: usize = 160;
const NOTES_MAX_CHARS: usize = 5000;
const TAG_MAX_CHARS: usize = 40;
const MAX_TAGS: usize = 20;
const COVER_MAX_CHARS: usize = 400_000;
const COVER_MAX_BYTES: usize = 320 * 1024;
const COVERS_DIR: &str = "covers";

const BOOK_COLUMNS: &str = "id,title,author,translator,publisher,published_year,pages,isbn,category,tags,formats,status,ownership,location,loan_direction,loan_person,loan_due_date,progress_pages,rating,is_favorite,recommender,notes,cover,started_at,finished_at,created_at,updated_at,purchase_date,reading_target";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: String,
    pub translator: String,
    pub publisher: String,
    pub published_year: Option<i64>,
    pub pages: Option<i64>,
    pub isbn: String,
    pub category: String,
    pub tags: Vec<String>,
    pub formats: Vec<String>,
    pub status: String,
    pub ownership: String,
    pub location: String,
    pub loan_direction: Option<String>,
    pub loan_person: String,
    pub loan_due_date: Option<String>,
    pub progress_pages: i64,
    pub rating: Option<i64>,
    pub is_favorite: bool,
    pub recommender: String,
    pub notes: String,
    pub cover: String,
    pub purchase_date: Option<String>,
    pub reading_target: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct BookDraft {
    pub title: String,
    pub author: String,
    pub translator: String,
    pub publisher: String,
    pub published_year: Option<i64>,
    pub pages: Option<i64>,
    pub isbn: String,
    pub category: String,
    pub tags: Vec<String>,
    pub formats: Vec<String>,
    pub status: String,
    pub ownership: String,
    pub location: String,
    pub loan_direction: Option<String>,
    pub loan_person: String,
    pub loan_due_date: Option<String>,
    pub progress_pages: i64,
    pub rating: Option<i64>,
    pub is_favorite: bool,
    pub recommender: String,
    pub notes: String,
    pub cover: String,
    pub purchase_date: Option<String>,
    pub reading_target: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

fn read_book(row: &Row<'_>) -> rusqlite::Result<Book> {
    let tags: String = row.get(9)?;
    let formats: String = row.get(10)?;
    Ok(Book {
        id: row.get(0)?,
        title: row.get(1)?,
        author: row.get(2)?,
        translator: row.get(3)?,
        publisher: row.get(4)?,
        published_year: row.get(5)?,
        pages: row.get(6)?,
        isbn: row.get(7)?,
        category: row.get(8)?,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        formats: serde_json::from_str(&formats).unwrap_or_default(),
        status: row.get(11)?,
        ownership: row.get(12)?,
        location: row.get(13)?,
        loan_direction: row.get(14)?,
        loan_person: row.get(15)?,
        loan_due_date: row.get(16)?,
        progress_pages: row.get(17)?,
        rating: row.get(18)?,
        is_favorite: row.get::<_, i64>(19)? != 0,
        recommender: row.get(20)?,
        notes: row.get(21)?,
        cover: row.get(22)?,
        started_at: row.get(23)?,
        finished_at: row.get(24)?,
        created_at: row.get(25)?,
        updated_at: row.get(26)?,
        purchase_date: row.get(27)?,
        reading_target: row.get(28)?,
    })
}

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn clean(value: &str, max: usize, field: &str) -> Result<String, CommandError> {
    let text = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() > max {
        return Err(CommandError::validation(field, "内容过长。"));
    }
    Ok(text)
}

fn clean_multiline(value: &str, max: usize, field: &str) -> Result<String, CommandError> {
    let text = value.trim();
    if text.chars().count() > max {
        return Err(CommandError::validation(field, "内容过长。"));
    }
    Ok(text.to_owned())
}

fn clean_date(value: Option<&String>, field: &str) -> Result<Option<String>, CommandError> {
    let Some(raw) = value else { return Ok(None) };
    let text = raw.trim();
    if text.is_empty() {
        return Ok(None);
    }
    chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .map_err(|_| CommandError::validation(field, "日期无效。"))?;
    Ok(Some(text.to_owned()))
}

fn clean_list(values: &[String], allowed: &[&str], field: &str) -> Result<Vec<String>, CommandError> {
    let mut out: Vec<String> = Vec::new();
    for value in values {
        let item = value.trim();
        if item.is_empty() {
            continue;
        }
        if !allowed.contains(&item) {
            return Err(CommandError::validation(field, "选项无效。"));
        }
        if !out.iter().any(|existing| existing == item) {
            out.push(item.to_owned());
        }
    }
    Ok(out)
}

fn clean_tags(values: &[String]) -> Result<Vec<String>, CommandError> {
    let mut out: Vec<String> = Vec::new();
    for value in values {
        let tag = value.split_whitespace().collect::<Vec<_>>().join(" ");
        if tag.is_empty() {
            continue;
        }
        if tag.chars().count() > TAG_MAX_CHARS {
            return Err(CommandError::validation("tags", "标签过长。"));
        }
        if !out.iter().any(|existing| existing.eq_ignore_ascii_case(&tag)) {
            out.push(tag);
        }
    }
    if out.len() > MAX_TAGS {
        return Err(CommandError::validation("tags", "标签过多。"));
    }
    Ok(out)
}

fn clean_cover(raw: &str) -> Result<String, CommandError> {
    let cover = raw.trim();
    if cover.is_empty() {
        return Ok(String::new());
    }
    if cover.starts_with("data:image/") {
        if cover.chars().count() > COVER_MAX_CHARS {
            return Err(CommandError::validation("cover", "封面文件过大。"));
        }
        let known = cover.starts_with("data:image/png;base64,")
            || cover.starts_with("data:image/jpeg;base64,")
            || cover.starts_with("data:image/webp;base64,");
        if !known {
            return Err(CommandError::validation("cover", "封面格式无效。"));
        }
        return Ok(cover.to_owned());
    }
    // An existing row's file name is handed back unchanged on edit.
    if !safe_cover_name(cover) {
        return Err(CommandError::validation("cover", "封面格式无效。"));
    }
    Ok(cover.to_owned())
}

fn safe_cover_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && !name.contains(['/', '\\'])
        && !name.contains("..")
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_'))
}

fn covers_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(COVERS_DIR)
}

fn covers_dir_for(app: &AppHandle) -> Result<PathBuf, CommandError> {
    let app_data_dir = app.path().app_data_dir().map_err(CommandError::system)?;
    Ok(covers_dir(&app_data_dir))
}

fn decode_cover(data_url: &str) -> Result<(String, Vec<u8>), CommandError> {
    let (extension, payload) = if let Some(payload) = data_url.strip_prefix("data:image/png;base64,") {
        ("png", payload)
    } else if let Some(payload) = data_url.strip_prefix("data:image/jpeg;base64,") {
        ("jpg", payload)
    } else if let Some(payload) = data_url.strip_prefix("data:image/webp;base64,") {
        ("webp", payload)
    } else {
        return Err(CommandError::validation("cover", "封面格式无效。"));
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|_| CommandError::validation("cover", "封面格式无效。"))?;
    if bytes.is_empty() || bytes.len() > COVER_MAX_BYTES {
        return Err(CommandError::validation("cover", "封面文件过大。"));
    }
    Ok((extension.to_owned(), bytes))
}

fn remove_cover_files(dir: &Path, id: &str) -> Result<(), CommandError> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).map_err(CommandError::system)? {
        let entry = entry.map_err(CommandError::system)?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with(id) && entry.path().is_file() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// Writes a picked cover to disk and returns the file name stored in the row.
fn store_cover(dir: &Path, id: &str, data_url: &str) -> Result<String, CommandError> {
    let (extension, bytes) = decode_cover(data_url)?;
    std::fs::create_dir_all(dir).map_err(CommandError::system)?;
    remove_cover_files(dir, id)?;
    let name = format!("{id}.{extension}");
    std::fs::write(dir.join(&name), bytes).map_err(CommandError::system)?;
    Ok(name)
}

/// Turns the cover value coming from the form into what the row should hold.
/// A new data URL replaces the old file; an unchanged file name is kept; an
/// empty value removes the file.
fn resolve_cover(
    dir: &Path,
    id: &str,
    existing: &str,
    incoming: &str,
) -> Result<String, CommandError> {
    if incoming.is_empty() {
        remove_cover_files(dir, id)?;
        return Ok(String::new());
    }
    if incoming.starts_with("data:image/") {
        return store_cover(dir, id, incoming);
    }
    if incoming == existing {
        return Ok(existing.to_owned());
    }
    Err(CommandError::validation("cover", "封面格式无效。"))
}

fn cover_mime(name: &str) -> &'static str {
    if name.ends_with(".png") {
        "image/png"
    } else if name.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

/// Validate and normalise a draft. A finished book always carries its finish
/// date and a full progress bar, and a book that started reading always has a
/// start date — that keeps the card honest without asking the user twice.
fn normalize(draft: &BookDraft) -> Result<BookDraft, CommandError> {
    let title = clean(&draft.title, TITLE_MAX_CHARS, "title")?;
    if title.is_empty() {
        return Err(CommandError::validation("title", "书名不能为空。"));
    }
    let status = draft.status.trim();
    if !BOOK_STATUSES.contains(&status) {
        return Err(CommandError::validation("status", "阅读状态无效。"));
    }
    let ownership = draft.ownership.trim();
    if !BOOK_OWNERSHIP.contains(&ownership) {
        return Err(CommandError::validation("ownership", "拥有状态无效。"));
    }
    let loan_direction = match draft.loan_direction.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(value) if BOOK_LOAN_DIRECTIONS.contains(&value) => Some(value.to_owned()),
        Some(_) => return Err(CommandError::validation("loanDirection", "借阅方向无效。")),
    };
    let pages = match draft.pages {
        Some(value) if !(1..=100_000).contains(&value) => {
            return Err(CommandError::validation("pages", "页数无效。"))
        }
        other => other,
    };
    let published_year = match draft.published_year {
        Some(value) if !(0..=3000).contains(&value) => {
            return Err(CommandError::validation("publishedYear", "出版年份无效。"))
        }
        other => other,
    };
    let rating = match draft.rating {
        Some(value) if !(1..=5).contains(&value) => {
            return Err(CommandError::validation("rating", "评分无效。"))
        }
        other => other,
    };
    let mut progress = draft.progress_pages.max(0);
    if let Some(total) = pages {
        progress = progress.min(total);
    }
    let mut started_at = clean_date(draft.started_at.as_ref(), "startedAt")?;
    let mut finished_at = clean_date(draft.finished_at.as_ref(), "finishedAt")?;
    if status == "read" {
        if let Some(total) = pages {
            progress = total;
        }
        if finished_at.is_none() {
            finished_at = Some(today());
        }
        if started_at.is_none() {
            started_at = finished_at.clone();
        }
    } else if status == "reading" && started_at.is_none() {
        started_at = Some(today());
    }
    Ok(BookDraft {
        title,
        author: clean(&draft.author, FIELD_MAX_CHARS, "author")?,
        translator: clean(&draft.translator, FIELD_MAX_CHARS, "translator")?,
        publisher: clean(&draft.publisher, FIELD_MAX_CHARS, "publisher")?,
        published_year,
        pages,
        isbn: clean(&draft.isbn, 40, "isbn")?,
        category: clean(&draft.category, FIELD_MAX_CHARS, "category")?,
        tags: clean_tags(&draft.tags)?,
        formats: clean_list(&draft.formats, BOOK_FORMATS, "formats")?,
        status: status.to_owned(),
        ownership: ownership.to_owned(),
        location: clean(&draft.location, FIELD_MAX_CHARS, "location")?,
        loan_direction,
        loan_person: clean(&draft.loan_person, FIELD_MAX_CHARS, "loanPerson")?,
        loan_due_date: clean_date(draft.loan_due_date.as_ref(), "loanDueDate")?,
        progress_pages: progress,
        rating,
        is_favorite: draft.is_favorite,
        recommender: clean(&draft.recommender, FIELD_MAX_CHARS, "recommender")?,
        notes: clean_multiline(&draft.notes, NOTES_MAX_CHARS, "notes")?,
        cover: clean_cover(&draft.cover)?,
        purchase_date: clean_date(draft.purchase_date.as_ref(), "purchaseDate")?,
        reading_target: clean_date(draft.reading_target.as_ref(), "readingTarget")?,
        started_at,
        finished_at,
    })
}

fn insert(connection: &Connection, book: &Book) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO books (id,title,author,translator,publisher,published_year,pages,isbn,category,tags,formats,status,ownership,location,loan_direction,loan_person,loan_due_date,progress_pages,rating,is_favorite,recommender,notes,cover,started_at,finished_at,created_at,updated_at,purchase_date,reading_target)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29)",
        params![
            book.id,
            book.title,
            book.author,
            book.translator,
            book.publisher,
            book.published_year,
            book.pages,
            book.isbn,
            book.category,
            serde_json::to_string(&book.tags).unwrap_or_else(|_| "[]".to_owned()),
            serde_json::to_string(&book.formats).unwrap_or_else(|_| "[]".to_owned()),
            book.status,
            book.ownership,
            book.location,
            book.loan_direction,
            book.loan_person,
            book.loan_due_date,
            book.progress_pages,
            book.rating,
            i64::from(book.is_favorite),
            book.recommender,
            book.notes,
            book.cover,
            book.started_at,
            book.finished_at,
            book.created_at,
            book.updated_at,
            book.purchase_date,
            book.reading_target,
        ],
    )?;
    Ok(())
}

fn write(connection: &Connection, book: &Book) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE books SET title=?2,author=?3,translator=?4,publisher=?5,published_year=?6,pages=?7,isbn=?8,category=?9,tags=?10,formats=?11,status=?12,ownership=?13,location=?14,loan_direction=?15,loan_person=?16,loan_due_date=?17,progress_pages=?18,rating=?19,is_favorite=?20,recommender=?21,notes=?22,cover=?23,started_at=?24,finished_at=?25,updated_at=?26,purchase_date=?27,reading_target=?28
         WHERE id=?1",
        params![
            book.id,
            book.title,
            book.author,
            book.translator,
            book.publisher,
            book.published_year,
            book.pages,
            book.isbn,
            book.category,
            serde_json::to_string(&book.tags).unwrap_or_else(|_| "[]".to_owned()),
            serde_json::to_string(&book.formats).unwrap_or_else(|_| "[]".to_owned()),
            book.status,
            book.ownership,
            book.location,
            book.loan_direction,
            book.loan_person,
            book.loan_due_date,
            book.progress_pages,
            book.rating,
            i64::from(book.is_favorite),
            book.recommender,
            book.notes,
            book.cover,
            book.started_at,
            book.finished_at,
            book.updated_at,
            book.purchase_date,
            book.reading_target,
        ],
    )?;
    Ok(())
}

fn find(db: &AppDb, id: &str) -> Result<Book, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    connection
        .query_row(
            &format!("SELECT {BOOK_COLUMNS} FROM books WHERE id=?1"),
            params![id],
            read_book,
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => CommandError::not_found("未找到这本书。"),
            other => CommandError::database(other),
        })
}

#[tauri::command]
pub fn list_books(db: State<'_, AppDb>) -> Result<Vec<Book>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT {BOOK_COLUMNS} FROM books ORDER BY updated_at DESC, id"
        ))
        .map_err(CommandError::database)?;
    let rows = statement.query_map([], read_book).map_err(CommandError::database)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

#[tauri::command]
pub fn create_book(app: AppHandle, db: State<'_, AppDb>, draft: BookDraft) -> Result<Book, CommandError> {
    let mut normalized = normalize(&draft)?;
    let id = Uuid::new_v4().to_string();
    let connection = db.0.lock().map_err(CommandError::database)?;
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))
        .map_err(CommandError::database)?;
    if count >= MAX_BOOKS {
        return Err(CommandError::validation("title", "书架已满。"));
    }
    let covers = covers_dir_for(&app)?;
    normalized.cover = resolve_cover(&covers, &id, "", &normalized.cover)?;
    let now = now_utc();
    let book = Book {
        id,
        title: normalized.title,
        author: normalized.author,
        translator: normalized.translator,
        publisher: normalized.publisher,
        published_year: normalized.published_year,
        pages: normalized.pages,
        isbn: normalized.isbn,
        category: normalized.category,
        tags: normalized.tags,
        formats: normalized.formats,
        status: normalized.status,
        ownership: normalized.ownership,
        location: normalized.location,
        loan_direction: normalized.loan_direction,
        loan_person: normalized.loan_person,
        loan_due_date: normalized.loan_due_date,
        progress_pages: normalized.progress_pages,
        rating: normalized.rating,
        is_favorite: normalized.is_favorite,
        recommender: normalized.recommender,
        notes: normalized.notes,
        cover: normalized.cover,
        purchase_date: normalized.purchase_date,
        reading_target: normalized.reading_target,
        started_at: normalized.started_at,
        finished_at: normalized.finished_at,
        created_at: now.clone(),
        updated_at: now,
    };
    insert(&connection, &book).map_err(CommandError::database)?;
    Ok(book)
}

#[tauri::command]
pub fn update_book(app: AppHandle, db: State<'_, AppDb>, id: String, draft: BookDraft) -> Result<Book, CommandError> {
    let mut normalized = normalize(&draft)?;
    let existing = find(&db, &id)?;
    let covers = covers_dir_for(&app)?;
    normalized.cover = resolve_cover(&covers, &id, &existing.cover, &normalized.cover)?;
    let connection = db.0.lock().map_err(CommandError::database)?;
    let book = Book {
        id: existing.id,
        title: normalized.title,
        author: normalized.author,
        translator: normalized.translator,
        publisher: normalized.publisher,
        published_year: normalized.published_year,
        pages: normalized.pages,
        isbn: normalized.isbn,
        category: normalized.category,
        tags: normalized.tags,
        formats: normalized.formats,
        status: normalized.status,
        ownership: normalized.ownership,
        location: normalized.location,
        loan_direction: normalized.loan_direction,
        loan_person: normalized.loan_person,
        loan_due_date: normalized.loan_due_date,
        progress_pages: normalized.progress_pages,
        rating: normalized.rating,
        is_favorite: normalized.is_favorite,
        recommender: normalized.recommender,
        notes: normalized.notes,
        cover: normalized.cover,
        purchase_date: normalized.purchase_date,
        reading_target: normalized.reading_target,
        started_at: normalized.started_at,
        finished_at: normalized.finished_at,
        created_at: existing.created_at,
        updated_at: now_utc(),
    };
    write(&connection, &book).map_err(CommandError::database)?;
    Ok(book)
}

#[tauri::command]
pub fn delete_book(app: AppHandle, db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let removed = connection
        .execute("DELETE FROM books WHERE id=?1", params![id])
        .map_err(CommandError::database)?;
    if removed == 0 {
        return Err(CommandError::not_found("未找到这本书。"));
    }
    drop(connection);
    let covers = covers_dir_for(&app)?;
    remove_cover_files(&covers, &id)?;
    Ok(())
}

/// Cover bytes are read on demand, so listing the shelf stays cheap. A row
/// written before covers moved to disk may still hold a data URL; it is served
/// as-is so old shelves keep working.
#[tauri::command]
pub fn read_book_cover(
    app: AppHandle,
    db: State<'_, AppDb>,
    id: String,
) -> Result<Option<String>, CommandError> {
    let book = find(&db, &id)?;
    if book.cover.is_empty() {
        return Ok(None);
    }
    if book.cover.starts_with("data:image/") {
        return Ok(Some(book.cover));
    }
    if !safe_cover_name(&book.cover) {
        return Ok(None);
    }
    let covers = covers_dir_for(&app)?;
    let path = covers.join(&book.cover);
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(CommandError::system)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!(
        "data:{};base64,{}",
        cover_mime(&book.cover),
        encoded
    )))
}

pub fn migrate(transaction: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS books (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT NOT NULL DEFAULT '',
            translator TEXT NOT NULL DEFAULT '',
            publisher TEXT NOT NULL DEFAULT '',
            published_year INTEGER,
            pages INTEGER,
            isbn TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            formats TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'unread',
            ownership TEXT NOT NULL DEFAULT 'owned',
            location TEXT NOT NULL DEFAULT '',
            loan_direction TEXT,
            loan_person TEXT NOT NULL DEFAULT '',
            loan_due_date TEXT,
            progress_pages INTEGER NOT NULL DEFAULT 0,
            rating INTEGER,
            is_favorite INTEGER NOT NULL DEFAULT 0,
            recommender TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            cover TEXT NOT NULL DEFAULT '',
            started_at TEXT,
            finished_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
         CREATE INDEX IF NOT EXISTS idx_books_ownership ON books(ownership);
         CREATE INDEX IF NOT EXISTS idx_books_updated ON books(updated_at);",
    )
}

/// Planning dates: when to buy a wanted book and when to finish reading it.
/// They are shown on the main calendar as read-only chips.
pub fn migrate_planning(transaction: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(
        "ALTER TABLE books ADD COLUMN purchase_date TEXT;
         ALTER TABLE books ADD COLUMN reading_target TEXT;",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(title: &str) -> BookDraft {
        BookDraft {
            title: title.to_owned(),
            author: "  Ursula  K.  Le Guin ".to_owned(),
            translator: String::new(),
            publisher: String::new(),
            published_year: Some(1974),
            pages: Some(300),
            isbn: String::new(),
            category: "fiction".to_owned(),
            tags: vec!["fantasy".to_owned(), " Fantasy ".to_owned()],
            formats: vec!["physical".to_owned(), "audio".to_owned(), "physical".to_owned()],
            status: "reading".to_owned(),
            ownership: "owned".to_owned(),
            location: "قفسه ۲".to_owned(),
            loan_direction: None,
            loan_person: String::new(),
            loan_due_date: None,
            progress_pages: 120,
            rating: Some(5),
            is_favorite: true,
            recommender: "سارا".to_owned(),
            notes: String::new(),
            cover: String::new(),
            purchase_date: None,
            reading_target: None,
            started_at: None,
            finished_at: None,
        }
    }

    #[test]
    fn normalizes_text_lists_and_dates() {
        let book = normalize(&draft("  The  Dispossessed ")).unwrap();
        assert_eq!(book.title, "The Dispossessed");
        assert_eq!(book.author, "Ursula K. Le Guin");
        assert_eq!(book.tags, vec!["fantasy".to_owned()]);
        assert_eq!(book.formats, vec!["physical".to_owned(), "audio".to_owned()]);
        assert!(book.started_at.is_some(), "reading books get a start date");
    }

    #[test]
    fn rejects_an_empty_title() {
        let error = normalize(&draft("   ")).unwrap_err();
        assert_eq!(error.field.as_deref(), Some("title"));
    }

    #[test]
    fn rejects_unknown_status_and_format() {
        let mut bad_status = draft("Book");
        bad_status.status = "sleeping".to_owned();
        assert!(normalize(&bad_status).is_err());
        let mut bad_format = draft("Book");
        bad_format.formats = vec!["hologram".to_owned()];
        assert!(normalize(&bad_format).is_err());
    }

    #[test]
    fn clamps_progress_and_completes_finished_books() {
        let mut over = draft("Book");
        over.progress_pages = 900;
        assert_eq!(normalize(&over).unwrap().progress_pages, 300);

        let mut done = draft("Book");
        done.status = "read".to_owned();
        done.progress_pages = 10;
        let book = normalize(&done).unwrap();
        assert_eq!(book.progress_pages, 300);
        assert!(book.finished_at.is_some());
    }

    #[test]
    fn rejects_invalid_cover_and_dates() {
        let mut cover = draft("Book");
        cover.cover = "https://example.com/a.png".to_owned();
        assert!(normalize(&cover).is_err());

        let mut date = draft("Book");
        date.loan_due_date = Some("2026-13-40".to_owned());
        assert!(normalize(&date).is_err());
    }

    #[test]
    fn accepts_a_stored_cover_name_but_rejects_paths() {
        assert_eq!(clean_cover("abc-123.jpg").unwrap(), "abc-123.jpg");
        assert!(clean_cover("../secret.jpg").is_err());
        assert!(clean_cover("nested/a.jpg").is_err());
        assert!(clean_cover("C:\\cover.jpg").is_err());
    }

    #[test]
    fn decodes_a_cover_data_url_into_bytes() {
        // "ABC" in base64.
        let (extension, bytes) = decode_cover("data:image/png;base64,QUJD").unwrap();
        assert_eq!(extension, "png");
        assert_eq!(bytes, b"ABC");
        assert!(decode_cover("data:image/gif;base64,QUJD").is_err());
        assert!(decode_cover("data:image/png;base64,!!!").is_err());
    }

    #[test]
    fn keeps_planning_dates_and_rejects_bad_ones() {
        let mut planned = draft("Book");
        planned.purchase_date = Some("2026-12-01".to_owned());
        planned.reading_target = Some("2027-01-10".to_owned());
        let book = normalize(&planned).unwrap();
        assert_eq!(book.purchase_date.as_deref(), Some("2026-12-01"));
        assert_eq!(book.reading_target.as_deref(), Some("2027-01-10"));

        let mut bad = draft("Book");
        bad.purchase_date = Some("2026-13-01".to_owned());
        assert!(normalize(&bad).is_err());
    }
}
