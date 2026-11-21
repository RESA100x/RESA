//! 通讯录存储层：联系人（个人/单位）、组织内部分机、分组，以及整册 CSV 导入导出。
//!
//! 一条记录回答的是「这个人/这家公司是谁、怎么联系上、在我们这里什么位置」。
//! 字段分三层落库：
//! - **提升为列**：界面要筛选、列表要显示的东西 —— 姓名、电话、分机、部门、
//!   职务、公司名、分组、是否内部同事、是否收藏、是否启用、合同状态，以及
//!   `roles` / `tags` 两个短列表（存 JSON 数组文本）。
//! - **`profile` JSON 列**：只在表单里出现、几乎不需要查询的长尾字段 ——
//!   身份与营业执照信息、多组电话/邮箱/地址、承包商与供应商资料、附件。
//!   这些字段加一个不需要再来一次数据库迁移，读出来就是结构化对象。
//! - **不变的骨架**：`id` / `created_at` / `updated_at`。
//!
//! 校验与前端 `src/phonebook/contact-draft.ts` 对称：姓名必填、至少要有一条
//! 联系方式、伊朗身份证带校验位、识别码/手机/邮编按位数检查、日期必须真实且
//! 不能是未来（入职、合同这类允许未来）。所有字段折叠空白并截断到上限。

use crate::db::AppDb;
use crate::error::CommandError;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use tauri::State;
use uuid::Uuid;

pub const CONTACT_NAME_MAX_CHARS: usize = 80;
pub const CONTACT_FIELD_MAX_CHARS: usize = 200;
pub const CONTACT_ADDRESS_MAX_CHARS: usize = 300;
pub const CONTACT_NOTE_MAX_CHARS: usize = 400;
/// 头像以 `data:image/...;base64,` 形式存进数据库：界面先把它缩到 128px 再存。
pub const CONTACT_PHOTO_MAX_CHARS: usize = 64 * 1024;
/// 长尾字段整体上限，避免一条记录把整册列表撑爆。
pub const CONTACT_PROFILE_MAX_CHARS: usize = 64 * 1024;
/// 每组多值列表（电话、邮箱、地址…）最多保留几条。
pub const CONTACT_COLLECTION_MAX: usize = 20;
pub const MAX_CONTACTS: i64 = 2000;

const CONTACT_COLUMNS: &str = "id,name,nickname,personality,roles,is_favorite,is_active,tags,photo,phone,extension,organization,job_title,company_name,email,address,birthday,category_id,is_internal,contract_status,note,profile,created_at,updated_at";

const PERSONALITIES: &[&str] = &["individual", "legal"];
const ROLES: &[&str] = &["colleague", "contractor", "manager", "supplier", "customer", "other"];
const GENDERS: &[&str] = &["", "male", "female", "other"];
const CONTRACT_STATUSES: &[&str] = &["", "active", "expired", "suspended"];
const REMINDER_FREQUENCIES: &[&str] = &["", "once", "daily", "weekly", "monthly", "yearly"];

/// 带标签的一条联系方式（「主要: 0912…」「工作: 021…」）。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContactLine {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContactMessenger {
    pub platform: String,
    pub handle: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContactAddress {
    pub label: String,
    pub country: String,
    pub province: String,
    pub city: String,
    pub full_address: String,
    pub postal_code: String,
    pub latitude: String,
    pub longitude: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContactAttachment {
    pub name: String,
    pub kind: String,
    pub url: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContractorInfo {
    pub company: String,
    pub field: String,
    pub grade: String,
    pub contract_number: String,
    pub contract_start: String,
    pub contract_end: String,
    pub contract_amount: String,
    pub contact_id: String,
    pub insurance: String,
    pub rating: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SupplierInfo {
    pub category: String,
    pub brands: String,
    pub payment_terms: String,
    pub settlement_days: String,
    pub iban: String,
    pub bank: String,
    pub min_order: String,
    pub delivery_time: String,
    pub delivery_zone: String,
}

/// 长尾字段：整体以 JSON 文本存在 `contacts.profile` 一列里。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContactProfile {
    pub first_name: String,
    pub last_name: String,
    pub gender: String,
    pub father_name: String,
    pub national_id: String,
    pub id_number: String,
    pub id_issue_place: String,
    pub company_type: String,
    pub registration_number: String,
    pub registration_date: String,
    pub national_entity_id: String,
    pub economic_code: String,
    pub tax_number: String,
    pub ceo_name: String,
    pub contact_person_id: String,
    pub mobiles: Vec<ContactLine>,
    pub phones: Vec<ContactLine>,
    pub faxes: Vec<ContactLine>,
    pub extensions: Vec<ContactLine>,
    pub emails: Vec<ContactLine>,
    pub messengers: Vec<ContactMessenger>,
    pub website: String,
    pub personnel_code: String,
    pub manager_id: String,
    pub hire_date: String,
    pub building: String,
    pub floor: String,
    pub room: String,
    pub shift: String,
    pub contractor: ContractorInfo,
    pub supplier: SupplierInfo,
    pub addresses: Vec<ContactAddress>,
    pub anniversary_date: String,
    pub last_contact_at: String,
    pub next_reminder_at: String,
    pub reminder_frequency: String,
    pub attachments: Vec<ContactAttachment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct Contact {
    pub id: String,
    pub name: String,
    pub nickname: String,
    /// 'individual'（自然人）或 'legal'（法人/公司）。
    pub personality: String,
    pub roles: Vec<String>,
    pub is_internal: bool,
    pub is_favorite: bool,
    pub is_active: bool,
    pub tags: Vec<String>,
    pub photo: String,
    pub phone: String,
    pub extension: String,
    pub organization: String,
    pub job_title: String,
    pub company_name: String,
    pub email: String,
    pub address: String,
    /// 'YYYY-MM-DD'（公历，界面按本地历法显示），空串表示没记。
    pub birthday: String,
    pub category_id: Option<String>,
    pub contract_status: String,
    pub note: String,
    pub profile: ContactProfile,
    pub created_at: String,
    pub updated_at: String,
}

/// 界面上报的草稿：除 `id`/时间戳外的全部可写字段。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ContactDraft {
    pub name: String,
    pub nickname: String,
    pub personality: String,
    pub roles: Vec<String>,
    pub is_internal: bool,
    pub is_favorite: bool,
    pub is_active: bool,
    pub tags: Vec<String>,
    pub photo: String,
    pub phone: String,
    pub extension: String,
    pub organization: String,
    pub job_title: String,
    pub company_name: String,
    pub email: String,
    pub address: String,
    pub birthday: String,
    pub category_id: Option<String>,
    pub contract_status: String,
    pub note: String,
    pub profile: ContactProfile,
}

impl Default for ContactDraft {
    fn default() -> Self {
        Self {
            name: String::new(),
            nickname: String::new(),
            personality: "individual".to_owned(),
            roles: Vec::new(),
            is_internal: false,
            is_favorite: false,
            is_active: true,
            tags: Vec::new(),
            photo: String::new(),
            phone: String::new(),
            extension: String::new(),
            organization: String::new(),
            job_title: String::new(),
            company_name: String::new(),
            email: String::new(),
            address: String::new(),
            birthday: String::new(),
            category_id: None,
            contract_status: String::new(),
            note: String::new(),
            profile: ContactProfile::default(),
        }
    }
}

fn json_list(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

fn read_profile(raw: &str) -> ContactProfile {
    serde_json::from_str(raw).unwrap_or_default()
}

fn read_contact(row: &Row<'_>) -> rusqlite::Result<Contact> {
    Ok(Contact {
        id: row.get(0)?,
        name: row.get(1)?,
        nickname: row.get(2)?,
        personality: row.get(3)?,
        roles: json_list(&row.get::<_, String>(4)?),
        is_favorite: row.get(5)?,
        is_active: row.get(6)?,
        tags: json_list(&row.get::<_, String>(7)?),
        photo: row.get(8)?,
        phone: row.get(9)?,
        extension: row.get(10)?,
        organization: row.get(11)?,
        job_title: row.get(12)?,
        company_name: row.get(13)?,
        email: row.get(14)?,
        address: row.get(15)?,
        birthday: row.get(16)?,
        category_id: row.get(17)?,
        is_internal: row.get(18)?,
        contract_status: row.get(19)?,
        note: row.get(20)?,
        profile: read_profile(&row.get::<_, String>(21)?),
        created_at: row.get(22)?,
        updated_at: row.get(23)?,
    })
}

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// 折叠空白并截断：号码常被粘贴成「0912  345 6789」。截断按字符计数，
/// 所以波斯语姓名不会被按字节砍断。
fn tidy(value: &str, max: usize) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
        .chars()
        .take(max)
        .collect()
}

/// 把波斯/阿拉伯数字折成 ASCII：日期、身份证号可能来自波斯语键盘。
fn fold_digits(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '\u{06F0}'..='\u{06F9}' => {
                char::from_u32(character as u32 - 0x06F0 + '0' as u32).unwrap_or(character)
            }
            '\u{0660}'..='\u{0669}' => {
                char::from_u32(character as u32 - 0x0660 + '0' as u32).unwrap_or(character)
            }
            other => other,
        })
        .collect()
}

fn digits_only(value: &str) -> String {
    fold_digits(value).chars().filter(char::is_ascii_digit).collect()
}

fn digits_field(raw: &str, field: &str, length: usize) -> Result<String, CommandError> {
    if raw.trim().is_empty() {
        return Ok(String::new());
    }
    let digits = digits_only(raw);
    if digits.len() != length {
        return Err(CommandError::validation(field, "位数不正确。"));
    }
    Ok(digits)
}

/// 伊朗身份证最后一位是校验位；全同数字（1111111111）不是合法号码。
fn is_national_id(digits: &str) -> bool {
    let numbers: Vec<u32> = digits.chars().filter_map(|digit| digit.to_digit(10)).collect();
    if numbers.len() != 10 || numbers.iter().all(|digit| *digit == numbers[0]) {
        return false;
    }
    let sum: u32 = numbers
        .iter()
        .take(9)
        .enumerate()
        .map(|(index, value)| value * (10 - index as u32))
        .sum();
    let remainder = sum % 11;
    if remainder < 2 {
        numbers[9] == remainder
    } else {
        numbers[9] == 11 - remainder
    }
}

fn normalize_date(raw: &str, field: &str, allow_future: bool) -> Result<String, CommandError> {
    let folded = fold_digits(raw.trim()).replace('/', "-");
    if folded.is_empty() {
        return Ok(String::new());
    }
    let date = chrono::NaiveDate::parse_from_str(&folded, "%Y-%m-%d")
        .map_err(|_| CommandError::validation(field, "日期格式无效。"))?;
    if !allow_future && date > chrono::Local::now().date_naive() {
        return Err(CommandError::validation(field, "日期不能是未来。"));
    }
    Ok(date.format("%Y-%m-%d").to_string())
}

fn normalize_personality(raw: &str) -> String {
    let value = raw.trim();
    if PERSONALITIES.contains(&value) {
        value.to_owned()
    } else {
        "individual".to_owned()
    }
}

fn normalize_enum(raw: &str, allowed: &[&str]) -> String {
    let value = raw.trim();
    if allowed.contains(&value) {
        value.to_owned()
    } else {
        String::new()
    }
}

/// 角色、标签这类短列表：去掉空白与重复，只留已知取值（标签不限制取值）。
fn normalize_list(values: &[String], allowed: Option<&[&str]>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for value in values {
        let item = tidy(value, 30);
        if item.is_empty() || allowed.is_some_and(|list| !list.contains(&item.as_str())) {
            continue;
        }
        if !out.contains(&item) {
            out.push(item);
        }
        if out.len() >= CONTACT_COLLECTION_MAX {
            break;
        }
    }
    out
}

fn normalize_lines(values: &[ContactLine]) -> Vec<ContactLine> {
    let mut out = Vec::new();
    for line in values {
        let value = tidy(&line.value, CONTACT_FIELD_MAX_CHARS);
        if value.is_empty() {
            continue;
        }
        out.push(ContactLine { label: tidy(&line.label, 30), value });
        if out.len() >= CONTACT_COLLECTION_MAX {
            break;
        }
    }
    out
}

fn normalize_messengers(values: &[ContactMessenger]) -> Vec<ContactMessenger> {
    let mut out = Vec::new();
    for item in values {
        let handle = tidy(&item.handle, CONTACT_FIELD_MAX_CHARS);
        let platform = tidy(&item.platform, 30);
        if handle.is_empty() && platform.is_empty() {
            continue;
        }
        out.push(ContactMessenger { platform, handle });
        if out.len() >= CONTACT_COLLECTION_MAX {
            break;
        }
    }
    out
}

fn normalize_addresses(values: &[ContactAddress]) -> Result<Vec<ContactAddress>, CommandError> {
    let mut out = Vec::new();
    for address in values {
        let entry = ContactAddress {
            label: tidy(&address.label, 30),
            country: tidy(&address.country, CONTACT_FIELD_MAX_CHARS),
            province: tidy(&address.province, CONTACT_FIELD_MAX_CHARS),
            city: tidy(&address.city, CONTACT_FIELD_MAX_CHARS),
            full_address: tidy(&address.full_address, CONTACT_ADDRESS_MAX_CHARS),
            postal_code: digits_field(&address.postal_code, "postalCode", 10)?,
            latitude: tidy(&address.latitude, 40),
            longitude: tidy(&address.longitude, 40),
        };
        let blank = entry.label.is_empty()
            && entry.country.is_empty()
            && entry.province.is_empty()
            && entry.city.is_empty()
            && entry.full_address.is_empty()
            && entry.postal_code.is_empty();
        if blank {
            continue;
        }
        out.push(entry);
        if out.len() >= CONTACT_COLLECTION_MAX {
            break;
        }
    }
    Ok(out)
}

fn normalize_attachments(values: &[ContactAttachment]) -> Vec<ContactAttachment> {
    let mut out = Vec::new();
    for item in values {
        let name = tidy(&item.name, CONTACT_FIELD_MAX_CHARS);
        if name.is_empty() {
            continue;
        }
        out.push(ContactAttachment {
            name,
            kind: tidy(&item.kind, 30),
            url: item.url.trim().chars().take(2048).collect(),
        });
        if out.len() >= CONTACT_COLLECTION_MAX {
            break;
        }
    }
    out
}

fn normalize_website(raw: &str) -> Result<String, CommandError> {
    let value = tidy(raw, CONTACT_FIELD_MAX_CHARS);
    if value.is_empty() {
        return Ok(value);
    }
    let looks_like_url =
        value.starts_with("http://") || value.starts_with("https://") || value.contains('.');
    if !looks_like_url || value.contains(char::is_whitespace) {
        return Err(CommandError::validation("website", "网址格式无效。"));
    }
    Ok(value)
}

fn normalize_email(raw: &str, field: &str) -> Result<String, CommandError> {
    let value = tidy(raw, CONTACT_FIELD_MAX_CHARS);
    if value.is_empty() {
        return Ok(value);
    }
    let mut parts = value.split('@');
    let (local, domain) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
    if local.is_empty() || domain.is_empty() || parts.next().is_some() || !domain.contains('.') {
        return Err(CommandError::validation(field, "邮箱格式无效。"));
    }
    Ok(value)
}

fn category_exists(connection: &Connection, id: &str) -> Result<bool, CommandError> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM contact_categories WHERE id = ?1)",
            params![id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)
}

/// 头像只接受界面自己生成的那种内联图片，脏数据在写入前就被拒绝。
fn normalize_photo(raw: &str) -> Result<String, CommandError> {
    let photo = raw.trim();
    if photo.is_empty() {
        return Ok(String::new());
    }
    if photo.chars().count() > CONTACT_PHOTO_MAX_CHARS {
        return Err(CommandError::validation("photo", "头像文件过大。"));
    }
    let payload = photo
        .strip_prefix("data:image/png;base64,")
        .or_else(|| photo.strip_prefix("data:image/jpeg;base64,"))
        .or_else(|| photo.strip_prefix("data:image/webp;base64,"));
    let Some(payload) = payload else {
        return Err(CommandError::validation("photo", "头像格式无效。"));
    };
    if payload.is_empty()
        || !payload
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/' || byte == b'=')
    {
        return Err(CommandError::validation("photo", "头像数据无效。"));
    }
    Ok(photo.to_owned())
}

/// 规范化后的字段，直接对应写库时需要的一组值。
struct NormalizedContact {
    name: String,
    nickname: String,
    personality: String,
    roles: Vec<String>,
    is_internal: bool,
    is_favorite: bool,
    is_active: bool,
    tags: Vec<String>,
    photo: String,
    phone: String,
    extension: String,
    organization: String,
    job_title: String,
    company_name: String,
    email: String,
    address: String,
    birthday: String,
    category_id: Option<String>,
    contract_status: String,
    note: String,
    profile: ContactProfile,
}

fn normalize_draft(
    connection: &Connection,
    draft: &ContactDraft,
) -> Result<NormalizedContact, CommandError> {
    let name = tidy(&draft.name, CONTACT_NAME_MAX_CHARS);
    if name.is_empty() {
        return Err(CommandError::validation("name", "姓名不能为空。"));
    }
    let category_id = match draft.category_id.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(id) => {
            if !category_exists(connection, id)? {
                return Err(CommandError::validation("categoryId", "分组不存在。"));
            }
            Some(id.to_owned())
        }
    };

    let source = &draft.profile;
    let national_id = digits_field(&source.national_id, "nationalId", 10)?;
    if !national_id.is_empty() && !is_national_id(&national_id) {
        return Err(CommandError::validation("nationalId", "身份证校验位不正确。"));
    }
    let emails = normalize_lines(&source.emails)
        .into_iter()
        .map(|line| {
            Ok(ContactLine {
                value: normalize_email(&line.value, "emails")?,
                label: line.label,
            })
        })
        .collect::<Result<Vec<_>, CommandError>>()?;
    let profile = ContactProfile {
        first_name: tidy(&source.first_name, CONTACT_FIELD_MAX_CHARS),
        last_name: tidy(&source.last_name, CONTACT_FIELD_MAX_CHARS),
        gender: normalize_enum(&source.gender, GENDERS),
        father_name: tidy(&source.father_name, CONTACT_FIELD_MAX_CHARS),
        national_id,
        id_number: tidy(&source.id_number, 30),
        id_issue_place: tidy(&source.id_issue_place, CONTACT_FIELD_MAX_CHARS),
        company_type: tidy(&source.company_type, CONTACT_FIELD_MAX_CHARS),
        registration_number: tidy(&source.registration_number, 40),
        registration_date: normalize_date(&source.registration_date, "registrationDate", false)?,
        national_entity_id: digits_field(&source.national_entity_id, "nationalEntityId", 11)?,
        economic_code: tidy(&source.economic_code, 40),
        tax_number: tidy(&source.tax_number, 40),
        ceo_name: tidy(&source.ceo_name, CONTACT_FIELD_MAX_CHARS),
        contact_person_id: tidy(&source.contact_person_id, 64),
        mobiles: normalize_lines(&source.mobiles)
            .into_iter()
            .map(|line| {
                let digits = digits_only(&line.value);
                ContactLine {
                    label: line.label,
                    value: if digits.is_empty() { line.value } else { digits },
                }
            })
            .collect(),
        phones: normalize_lines(&source.phones),
        faxes: normalize_lines(&source.faxes),
        extensions: normalize_lines(&source.extensions),
        emails,
        messengers: normalize_messengers(&source.messengers),
        website: normalize_website(&source.website)?,
        personnel_code: tidy(&source.personnel_code, 40),
        manager_id: tidy(&source.manager_id, 64),
        hire_date: normalize_date(&source.hire_date, "hireDate", true)?,
        building: tidy(&source.building, CONTACT_FIELD_MAX_CHARS),
        floor: tidy(&source.floor, 30),
        room: tidy(&source.room, 30),
        shift: tidy(&source.shift, 60),
        contractor: ContractorInfo {
            company: tidy(&source.contractor.company, CONTACT_FIELD_MAX_CHARS),
            field: tidy(&source.contractor.field, CONTACT_FIELD_MAX_CHARS),
            grade: tidy(&source.contractor.grade, 60),
            contract_number: tidy(&source.contractor.contract_number, 60),
            contract_start: normalize_date(&source.contractor.contract_start, "contractStart", true)?,
            contract_end: normalize_date(&source.contractor.contract_end, "contractEnd", true)?,
            contract_amount: tidy(&source.contractor.contract_amount, 40),
            contact_id: tidy(&source.contractor.contact_id, 64),
            insurance: tidy(&source.contractor.insurance, CONTACT_FIELD_MAX_CHARS),
            rating: tidy(&source.contractor.rating, 20),
        },
        supplier: SupplierInfo {
            category: tidy(&source.supplier.category, CONTACT_FIELD_MAX_CHARS),
            brands: tidy(&source.supplier.brands, CONTACT_FIELD_MAX_CHARS),
            payment_terms: tidy(&source.supplier.payment_terms, CONTACT_FIELD_MAX_CHARS),
            settlement_days: tidy(&source.supplier.settlement_days, 20),
            iban: tidy(&source.supplier.iban, 40).to_uppercase(),
            bank: tidy(&source.supplier.bank, CONTACT_FIELD_MAX_CHARS),
            min_order: tidy(&source.supplier.min_order, 40),
            delivery_time: tidy(&source.supplier.delivery_time, 60),
            delivery_zone: tidy(&source.supplier.delivery_zone, 60),
        },
        addresses: normalize_addresses(&source.addresses)?,
        anniversary_date: normalize_date(&source.anniversary_date, "anniversaryDate", true)?,
        last_contact_at: normalize_date(&source.last_contact_at, "lastContactAt", true)?,
        next_reminder_at: tidy(&source.next_reminder_at, 40),
        reminder_frequency: normalize_enum(&source.reminder_frequency, REMINDER_FREQUENCIES),
        attachments: normalize_attachments(&source.attachments),
    };

    let phone = tidy(&draft.phone, CONTACT_FIELD_MAX_CHARS);
    let extension = tidy(&draft.extension, CONTACT_FIELD_MAX_CHARS);
    let email = normalize_email(&draft.email, "email")?;
    // 一条联系方式都没有的联系人，在通讯录里是查不到的。
    if phone.is_empty()
        && extension.is_empty()
        && email.is_empty()
        && profile.mobiles.is_empty()
        && profile.phones.is_empty()
        && profile.emails.is_empty()
        && profile.messengers.is_empty()
    {
        return Err(CommandError::validation("phone", "至少填写一条联系方式。"));
    }

    let profile_json = serde_json::to_string(&profile).map_err(CommandError::system)?;
    if profile_json.chars().count() > CONTACT_PROFILE_MAX_CHARS {
        return Err(CommandError::validation("profile", "附加资料过大。"));
    }

    Ok(NormalizedContact {
        name,
        nickname: tidy(&draft.nickname, CONTACT_FIELD_MAX_CHARS),
        personality: normalize_personality(&draft.personality),
        roles: normalize_list(&draft.roles, Some(ROLES)),
        is_internal: draft.is_internal,
        is_favorite: draft.is_favorite,
        is_active: draft.is_active,
        tags: normalize_list(&draft.tags, None),
        photo: normalize_photo(&draft.photo)?,
        phone,
        extension,
        organization: tidy(&draft.organization, CONTACT_FIELD_MAX_CHARS),
        job_title: tidy(&draft.job_title, CONTACT_FIELD_MAX_CHARS),
        company_name: tidy(&draft.company_name, CONTACT_FIELD_MAX_CHARS),
        email,
        address: tidy(&draft.address, CONTACT_ADDRESS_MAX_CHARS),
        birthday: normalize_date(&draft.birthday, "birthday", false)?,
        category_id,
        contract_status: normalize_enum(&draft.contract_status, CONTRACT_STATUSES),
        note: tidy(&draft.note, CONTACT_NOTE_MAX_CHARS),
        profile,
    })
}

const INSERT_COLUMNS: &str = "id,name,nickname,personality,roles,is_favorite,is_active,tags,photo,phone,extension,organization,job_title,company_name,email,address,birthday,category_id,is_internal,contract_status,note,profile,created_at,updated_at";
const INSERT_VALUES: &str =
    "?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?23";

pub fn list(connection: &Connection) -> Result<Vec<Contact>, CommandError> {
    let sql = format!("SELECT {CONTACT_COLUMNS} FROM contacts ORDER BY name ASC, created_at ASC");
    let mut statement = connection.prepare(&sql).map_err(CommandError::database)?;
    let rows = statement
        .query_map([], read_contact)
        .map_err(CommandError::database)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(CommandError::database)?);
    }
    Ok(out)
}

fn fetch_one(connection: &Connection, id: &str) -> Result<Contact, CommandError> {
    let sql = format!("SELECT {CONTACT_COLUMNS} FROM contacts WHERE id = ?1");
    connection
        .query_row(&sql, params![id], read_contact)
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => CommandError::validation("id", "联系人不存在。"),
            other => CommandError::database(other),
        })
}

fn insert_normalized(
    connection: &Connection,
    normalized: NormalizedContact,
) -> Result<String, CommandError> {
    let NormalizedContact {
        name,
        nickname,
        personality,
        roles,
        is_internal,
        is_favorite,
        is_active,
        tags,
        photo,
        phone,
        extension,
        organization,
        job_title,
        company_name,
        email,
        address,
        birthday,
        category_id,
        contract_status,
        note,
        profile,
    } = normalized;
    let id = Uuid::new_v4().to_string();
    let now = now_utc();
    connection
        .execute(
            &format!("INSERT INTO contacts({INSERT_COLUMNS}) VALUES ({INSERT_VALUES})"),
            params![
                id,
                name,
                nickname,
                personality,
                serde_json::to_string(&roles).map_err(CommandError::system)?,
                is_favorite,
                is_active,
                serde_json::to_string(&tags).map_err(CommandError::system)?,
                photo,
                phone,
                extension,
                organization,
                job_title,
                company_name,
                email,
                address,
                birthday,
                category_id,
                is_internal,
                contract_status,
                note,
                serde_json::to_string(&profile).map_err(CommandError::system)?,
                now
            ],
        )
        .map_err(CommandError::database)?;
    Ok(id)
}

pub fn create(connection: &mut Connection, draft: ContactDraft) -> Result<Contact, CommandError> {
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM contacts", [], |row| row.get(0))
        .map_err(CommandError::database)?;
    if count >= MAX_CONTACTS {
        return Err(CommandError::validation("name", "联系人数量已达上限。"));
    }
    let normalized = normalize_draft(connection, &draft)?;
    let id = insert_normalized(connection, normalized)?;
    fetch_one(connection, &id)
}

pub fn update(
    connection: &mut Connection,
    id: &str,
    draft: ContactDraft,
) -> Result<Contact, CommandError> {
    let normalized = normalize_draft(connection, &draft)?;
    let NormalizedContact {
        name,
        nickname,
        personality,
        roles,
        is_internal,
        is_favorite,
        is_active,
        tags,
        photo,
        phone,
        extension,
        organization,
        job_title,
        company_name,
        email,
        address,
        birthday,
        category_id,
        contract_status,
        note,
        profile,
    } = normalized;
    let affected = connection
        .execute(
            "UPDATE contacts SET name=?2,nickname=?3,personality=?4,roles=?5,is_favorite=?6,is_active=?7,
                tags=?8,photo=?9,phone=?10,extension=?11,organization=?12,job_title=?13,company_name=?14,
                email=?15,address=?16,birthday=?17,category_id=?18,is_internal=?19,contract_status=?20,
                note=?21,profile=?22,updated_at=?23
             WHERE id=?1",
            params![
                id,
                name,
                nickname,
                personality,
                serde_json::to_string(&roles).map_err(CommandError::system)?,
                is_favorite,
                is_active,
                serde_json::to_string(&tags).map_err(CommandError::system)?,
                photo,
                phone,
                extension,
                organization,
                job_title,
                company_name,
                email,
                address,
                birthday,
                category_id,
                is_internal,
                contract_status,
                note,
                serde_json::to_string(&profile).map_err(CommandError::system)?,
                now_utc()
            ],
        )
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::validation("id", "联系人不存在。"));
    }
    fetch_one(connection, id)
}

pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let affected = connection
        .execute("DELETE FROM contacts WHERE id=?1", params![id])
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::validation("id", "联系人不存在。"));
    }
    Ok(())
}

pub fn migrate(transaction: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(
        "CREATE TABLE contacts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT NOT NULL DEFAULT '',
            tag TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE INDEX idx_contacts_name ON contacts(name);",
    )
}

/// 把最初的四字段表扩成完整的通讯录：分组表 + 组织内部分机所需的字段。
pub fn migrate_directory(transaction: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(
        "CREATE TABLE contact_categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE INDEX idx_contact_categories_position ON contact_categories(position);
         ALTER TABLE contacts ADD COLUMN extension TEXT NOT NULL DEFAULT '';
         ALTER TABLE contacts ADD COLUMN organization TEXT NOT NULL DEFAULT '';
         ALTER TABLE contacts ADD COLUMN job_title TEXT NOT NULL DEFAULT '';
         ALTER TABLE contacts ADD COLUMN email TEXT NOT NULL DEFAULT '';
         ALTER TABLE contacts ADD COLUMN address TEXT NOT NULL DEFAULT '';
         ALTER TABLE contacts ADD COLUMN birthday TEXT NOT NULL DEFAULT '';
         ALTER TABLE contacts ADD COLUMN category_id TEXT REFERENCES contact_categories(id) ON DELETE SET NULL;
         ALTER TABLE contacts ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;
         CREATE INDEX idx_contacts_category ON contacts(category_id);",
    )
}

/// 头像列：迁移 47。
pub fn migrate_photos(transaction: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch("ALTER TABLE contacts ADD COLUMN photo TEXT NOT NULL DEFAULT '';")
}

/// 迁移 48：把通讯录从「姓名+电话」扩成个人/单位档案。
///
/// 会被筛选、排序或列表显示的字段提升为真正的列（`roles`/`tags` 以 JSON 数组
/// 文本存放），其余长尾字段统一进 `profile` JSON —— 以后加一个表单字段不需要
/// 再来一次数据库迁移。旧库升级后 `profile` 是 `{}`，读出来即默认值。
pub fn migrate_profiles(transaction: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(
        "ALTER TABLE contacts ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
         ALTER TABLE contacts ADD COLUMN personality TEXT NOT NULL DEFAULT 'individual';
         ALTER TABLE contacts ADD COLUMN roles TEXT NOT NULL DEFAULT '[]';
         ALTER TABLE contacts ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE contacts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
         ALTER TABLE contacts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
         ALTER TABLE contacts ADD COLUMN company_name TEXT NOT NULL DEFAULT '';
         ALTER TABLE contacts ADD COLUMN contract_status TEXT NOT NULL DEFAULT '';
         ALTER TABLE contacts ADD COLUMN profile TEXT NOT NULL DEFAULT '{}';
         CREATE INDEX idx_contacts_personality ON contacts(personality);
         CREATE INDEX idx_contacts_active ON contacts(is_active, is_favorite);",
    )
}

// --- CSV 导出 / 导入 ---------------------------------------------------------
//
// 导出的是给人看的表：前面十九列在 Excel 里一眼能读完，最后一列 `profile` 放
// 完整 JSON，所以「导出再导入」不丢任何长尾字段。分组按名字导出，导入时找不到
// 就新建一个。导出文件带 UTF-8 BOM，Excel 打开波斯语不会变乱码。

const CSV_HEADERS: &[&str] = &[
    "name", "nickname", "personality", "roles", "tags", "isInternal", "isFavorite", "isActive",
    "phone", "extension", "organization", "jobTitle", "companyName", "email", "address",
    "birthday", "category", "contractStatus", "note", "profile",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactsExportSummary {
    pub path: String,
    pub contacts: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactsImportSummary {
    /// 文件里读到的数据行数（不含表头）。
    pub read: i64,
    /// 真正写入的行数；`commit = false` 时是「将会写入」的数量。
    pub imported: i64,
    /// 缺姓名或联系方式、或校验没过而被跳过的行数。
    pub skipped: i64,
    /// 已经存在（同名同电话）而没有重复写入的行数。
    pub duplicated: i64,
}

fn csv_cell(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

/// 按 RFC 4180 拆一行：引号内的逗号属于字段本身。导出前所有字段都折叠过空白，
/// 所以字段内部不会出现换行，逐行读就够了。
fn csv_row(line: &str) -> Vec<String> {
    let mut cells = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '"' if quoted => {
                if chars.peek() == Some(&'"') {
                    current.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            }
            '"' => quoted = true,
            ',' if !quoted => cells.push(std::mem::take(&mut current)),
            other => current.push(other),
        }
    }
    cells.push(current);
    cells
}

fn category_name(connection: &Connection, id: Option<&str>) -> Result<String, CommandError> {
    let Some(id) = id else { return Ok(String::new()) };
    connection
        .query_row(
            "SELECT name FROM contact_categories WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .map_err(CommandError::database)
}

/// 导入时按名字找分组，找不到就建一个，避免把「分组」变成导入的失败点。
fn find_or_create_category(
    connection: &Connection,
    name: &str,
) -> Result<Option<String>, CommandError> {
    let name = tidy(name, 40);
    if name.is_empty() {
        return Ok(None);
    }
    let existing: Option<String> = connection
        .query_row(
            "SELECT id FROM contact_categories WHERE name = ?1",
            params![name],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = existing {
        return Ok(Some(id));
    }
    let id = Uuid::new_v4().to_string();
    let now = now_utc();
    let position: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM contact_categories",
            [],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    connection
        .execute(
            "INSERT INTO contact_categories(id,name,color,position,created_at,updated_at)
             VALUES (?1,?2,'#4FC9DA',?3,?4,?4)",
            params![id, name, position, now],
        )
        .map_err(CommandError::database)?;
    Ok(Some(id))
}

pub fn export_csv(
    connection: &Connection,
    path: &str,
) -> Result<ContactsExportSummary, CommandError> {
    let rows = list(connection)?;
    let mut out = String::from("\u{feff}");
    out.push_str(&CSV_HEADERS.join(","));
    out.push_str("\r\n");
    for contact in &rows {
        let cells = [
            contact.name.clone(),
            contact.nickname.clone(),
            contact.personality.clone(),
            contact.roles.join(" | "),
            contact.tags.join(" | "),
            contact.is_internal.to_string(),
            contact.is_favorite.to_string(),
            contact.is_active.to_string(),
            contact.phone.clone(),
            contact.extension.clone(),
            contact.organization.clone(),
            contact.job_title.clone(),
            contact.company_name.clone(),
            contact.email.clone(),
            contact.address.clone(),
            contact.birthday.clone(),
            category_name(connection, contact.category_id.as_deref())?,
            contact.contract_status.clone(),
            contact.note.clone(),
            serde_json::to_string(&contact.profile).map_err(CommandError::system)?,
        ];
        out.push_str(
            &cells
                .iter()
                .map(|cell| csv_cell(cell))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push_str("\r\n");
    }
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(CommandError::system)?;
        }
    }
    std::fs::write(path, out).map_err(CommandError::system)?;
    Ok(ContactsExportSummary { path: path.to_owned(), contacts: rows.len() as i64 })
}

fn truthy(value: &str) -> bool {
    matches!(value.trim().to_lowercase().as_str(), "true" | "1" | "yes")
}

/// 把一行 CSV 变回草稿；`name` 为空时返回 `None`。
fn draft_from_row(
    connection: &Connection,
    cells: &BTreeMap<String, String>,
) -> Result<Option<ContactDraft>, CommandError> {
    let name = cells.get("name").map(String::as_str).unwrap_or_default();
    if name.trim().is_empty() {
        return Ok(None);
    }
    let value_of = |key: &str| cells.get(key).cloned().unwrap_or_default();
    let split = |key: &str| -> Vec<String> {
        value_of(key)
            .split('|')
            .map(|item| item.trim().to_owned())
            .filter(|item| !item.is_empty())
            .collect()
    };
    let profile: ContactProfile = serde_json::from_str(value_of("profile").trim()).unwrap_or_default();
    Ok(Some(ContactDraft {
        name: name.to_owned(),
        nickname: value_of("nickname"),
        personality: value_of("personality"),
        roles: split("roles"),
        is_internal: truthy(&value_of("isinternal")),
        is_favorite: truthy(&value_of("isfavorite")),
        is_active: cells
            .get("isactive")
            .map(|raw| truthy(raw))
            .unwrap_or(true),
        tags: split("tags"),
        photo: String::new(),
        phone: value_of("phone"),
        extension: value_of("extension"),
        organization: value_of("organization"),
        job_title: value_of("jobtitle"),
        company_name: value_of("companyname"),
        email: value_of("email"),
        address: value_of("address"),
        birthday: value_of("birthday"),
        category_id: find_or_create_category(connection, &value_of("category"))?,
        contract_status: value_of("contractstatus"),
        note: value_of("note"),
        profile,
    }))
}

/// 去重：同名 + 同主电话视为同一个人，避免「导出再导入」变成双份。
fn already_stored(connection: &Connection, name: &str, phone: &str) -> Result<bool, CommandError> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM contacts WHERE name = ?1 AND phone = ?2)",
            params![
                tidy(name, CONTACT_NAME_MAX_CHARS),
                tidy(phone, CONTACT_FIELD_MAX_CHARS)
            ],
            |row| row.get(0),
        )
        .map_err(CommandError::database)
}

/// `commit = false` 时只报数不写库，界面先拿它做「预检」再让用户确认。
pub fn import_csv(
    connection: &mut Connection,
    path: &str,
    commit: bool,
) -> Result<ContactsImportSummary, CommandError> {
    let text = std::fs::read_to_string(path).map_err(CommandError::system)?;
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let Some(header) = lines.next() else {
        return Err(CommandError::validation("file", "文件是空的。"));
    };
    let header: Vec<String> = csv_row(header)
        .into_iter()
        .map(|cell| cell.trim().to_lowercase())
        .collect();
    if !header.iter().any(|cell| cell == "name") {
        return Err(CommandError::validation("file", "缺少 name 列。"));
    }

    let mut summary = ContactsImportSummary { read: 0, imported: 0, skipped: 0, duplicated: 0 };
    let transaction = connection.transaction().map_err(CommandError::database)?;
    for line in lines {
        summary.read += 1;
        let values = csv_row(line);
        let map: BTreeMap<String, String> = header
            .iter()
            .cloned()
            .zip(values.into_iter().chain(std::iter::repeat(String::new())))
            .collect();
        let Some(draft) = draft_from_row(&transaction, &map)? else {
            summary.skipped += 1;
            continue;
        };
        if already_stored(&transaction, &draft.name, &draft.phone).unwrap_or(false) {
            summary.duplicated += 1;
            continue;
        }
        match normalize_draft(&transaction, &draft) {
            Ok(normalized) => {
                summary.imported += 1;
                if commit {
                    insert_normalized(&transaction, normalized)?;
                }
            }
            Err(_) => summary.skipped += 1,
        }
    }
    if commit {
        transaction.commit().map_err(CommandError::database)?;
    }
    Ok(summary)
}

// --- vCard ------------------------------------------------------------------
//
// vCard is how the directory talks to a phone: `.resa`/CSV are ours, `.vcf` is
// what every handset and address book understands. Our own extra fields ride
// along as `X-RESA-*` properties so an export/import round trip keeps them,
// while a foreign card still imports with the standard properties.

fn vcard_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            other => out.push(other),
        }
    }
    out
}

fn vcard_unescape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(character) = chars.next() {
        if character != '\\' {
            out.push(character);
            continue;
        }
        match chars.next() {
            Some('n') | Some('N') => out.push('\n'),
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

/// Long lines are folded at 75 characters with a leading space on the
/// continuation, as the spec requires; clients that ignore folding still read
/// the value because the space is dropped again on import.
fn vcard_fold(line: &str) -> String {
    const LIMIT: usize = 74;
    if line.chars().count() <= LIMIT {
        return line.to_owned();
    }
    let mut out = String::with_capacity(line.len() + 8);
    for (index, character) in line.chars().enumerate() {
        if index > 0 && index % LIMIT == 0 {
            out.push_str("\r\n ");
        }
        out.push(character);
    }
    out
}

fn vcard_property(name: &str, value: &str) -> Option<String> {
    if value.trim().is_empty() {
        return None;
    }
    Some(vcard_fold(&format!("{name}:{}", vcard_escape(value))))
}

pub fn export_vcard(
    connection: &Connection,
    path: &str,
) -> Result<ContactsExportSummary, CommandError> {
    let rows = list(connection)?;
    let mut out = String::new();
    for contact in &rows {
        let mut lines: Vec<String> = vec!["BEGIN:VCARD".into(), "VERSION:3.0".into()];
        lines.push(vcard_fold(&format!("N:{};;;;", vcard_escape(&contact.name))));
        lines.push(vcard_fold(&format!("FN:{}", vcard_escape(&contact.name))));
        // `ORG` and `ADR` are structured: the semicolons separate components, so
        // only the text inside a component is escaped.
        if !contact.organization.is_empty() || !contact.company_name.is_empty() {
            lines.push(vcard_fold(&format!(
                "ORG:{};{}",
                vcard_escape(&contact.organization),
                vcard_escape(&contact.company_name)
            )));
        }
        if !contact.address.trim().is_empty() {
            lines.push(vcard_fold(&format!(
                "ADR;TYPE=WORK:;;{};;;;",
                vcard_escape(&contact.address)
            )));
        }
        for (name, value) in [
            ("NICKNAME", contact.nickname.clone()),
            ("TITLE", contact.job_title.clone()),
            ("ROLE", contact.roles.join(",")),
            ("CATEGORIES", contact.tags.join(",")),
            ("X-RESA-EXTENSION", contact.extension.clone()),
            ("BDAY", contact.birthday.clone()),
            ("URL", contact.profile.website.clone()),
            ("NOTE", contact.note.clone()),
            ("X-RESA-PERSONALITY", contact.personality.clone()),
            ("X-RESA-CONTRACT", contact.contract_status.clone()),
        ] {
            if let Some(line) = vcard_property(name, &value) {
                lines.push(line);
            }
        }
        if let Some(line) = vcard_property("TEL;TYPE=CELL", &contact.phone) {
            lines.push(line);
        }
        // Extra channels keep their kind so the import can sort them back into
        // mobiles, landlines and e-mails; the primary values always come first.
        for line in &contact.profile.mobiles {
            if let Some(property) = vcard_property("TEL;TYPE=CELL", &line.value) {
                lines.push(property);
            }
        }
        for line in &contact.profile.phones {
            if let Some(property) = vcard_property("TEL;TYPE=WORK", &line.value) {
                lines.push(property);
            }
        }
        if let Some(line) = vcard_property("EMAIL;TYPE=INTERNET", &contact.email) {
            lines.push(line);
        }
        for line in &contact.profile.emails {
            if let Some(property) = vcard_property("EMAIL;TYPE=INTERNET", &line.value) {
                lines.push(property);
            }
        }
        if contact.is_internal {
            lines.push("X-RESA-INTERNAL:1".into());
        }
        if contact.is_favorite {
            lines.push("X-RESA-FAVORITE:1".into());
        }
        if !contact.is_active {
            lines.push("X-RESA-ACTIVE:0".into());
        }
        lines.push("END:VCARD".into());
        out.push_str(&lines.join("\r\n"));
        out.push_str("\r\n");
    }
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(CommandError::system)?;
        }
    }
    std::fs::write(path, out).map_err(CommandError::system)?;
    Ok(ContactsExportSummary { path: path.to_owned(), contacts: rows.len() as i64 })
}

/// One parsed card: property name (upper-case, parameters stripped) to values.
type VcardProperties = BTreeMap<String, Vec<(String, String)>>;

fn parse_vcard_line(line: &str) -> Option<(String, String, String)> {
    let (raw_name, value) = line.split_once(':')?;
    // `TEL;TYPE=CELL` -> name TEL, params TYPE=CELL.
    let mut parts = raw_name.split(';');
    let name = parts.next()?.trim().to_uppercase();
    if name.is_empty() {
        return None;
    }
    let params = parts.collect::<Vec<_>>().join(";").to_uppercase();
    Some((name, params, vcard_unescape(value.trim())))
}

fn parse_vcards(text: &str) -> Vec<VcardProperties> {
    let mut cards = Vec::new();
    let mut current: Option<VcardProperties> = None;
    let mut lines: Vec<String> = Vec::new();
    // Unfold first: a line starting with a space continues the previous one.
    for raw in text.lines() {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some(character) = line.chars().next() {
            if (character == ' ' || character == '\t') && !lines.is_empty() {
                let joined = lines.pop().unwrap_or_default() + line.trim_start();
                lines.push(joined);
                continue;
            }
        }
        lines.push(line.to_owned());
    }
    for line in lines {
        let Some((name, params, value)) = parse_vcard_line(&line) else {
            continue;
        };
        match name.as_str() {
            "BEGIN" => current = Some(VcardProperties::new()),
            "END" => {
                if let Some(card) = current.take() {
                    cards.push(card);
                }
            }
            _ => {
                if let Some(card) = current.as_mut() {
                    card.entry(name).or_default().push((params, value));
                }
            }
        }
    }
    cards
}

fn first_value(card: &VcardProperties, name: &str) -> String {
    card.get(name)
        .and_then(|values| values.first())
        .map(|(_, value)| value.clone())
        .unwrap_or_default()
}

fn split_list(value: &str) -> Vec<String> {
    value
        .split([',', ';'])
        .map(|item| item.trim().to_owned())
        .filter(|item| !item.is_empty())
        .collect()
}

/// `BDAY` arrives in a few shapes: `1990-05-12`, `19900512`, or with a time
/// suffix. Anything else (e.g. the year-less `--0512`) is dropped rather than
/// guessed.
fn vcard_birthday(value: &str) -> String {
    let digits: String = value.chars().filter(|character| character.is_ascii_digit()).collect();
    if digits.len() >= 8 {
        let candidate = format!("{}-{}-{}", &digits[0..4], &digits[4..6], &digits[6..8]);
        if chrono::NaiveDate::parse_from_str(&candidate, "%Y-%m-%d").is_ok() {
            return candidate;
        }
    }
    String::new()
}

fn draft_from_vcard(connection: &Connection, card: &VcardProperties) -> Result<Option<ContactDraft>, CommandError> {
    let full_name = {
        let formatted = first_value(card, "FN");
        if !formatted.trim().is_empty() {
            formatted
        } else {
            // N is `family;given;middle;prefix;suffix`.
            first_value(card, "N")
                .split(';')
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        }
    };
    if full_name.trim().is_empty() {
        return Ok(None);
    }

    let telephones: Vec<(String, String)> = card.get("TEL").cloned().unwrap_or_default();
    let phone = telephones.first().map(|(_, value)| value.clone()).unwrap_or_default();

    let emails: Vec<(String, String)> = card.get("EMAIL").cloned().unwrap_or_default();
    let mut profile = ContactProfile::default();
    profile.website = first_value(card, "URL");
    profile.mobiles = telephones
        .iter()
        .skip(1)
        .filter(|(params, _)| params.contains("CELL") || params.contains("MOBILE"))
        .map(|(_, value)| ContactLine { label: String::new(), value: value.clone() })
        .collect();
    profile.phones = telephones
        .iter()
        .skip(1)
        .filter(|(params, _)| !params.contains("CELL") && !params.contains("MOBILE"))
        .map(|(_, value)| ContactLine { label: String::new(), value: value.clone() })
        .collect();
    profile.emails = emails
        .iter()
        .skip(1)
        .map(|(_, value)| ContactLine { label: String::new(), value: value.clone() })
        .collect();

    let organization = first_value(card, "ORG");
    let mut organization_parts = organization.split(';').map(str::trim);
    let organization = organization_parts.next().unwrap_or_default().to_owned();
    let company_name = organization_parts.next().unwrap_or_default().to_owned();

    let address = first_value(card, "ADR")
        .split(';')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    let personality = first_value(card, "X-RESA-PERSONALITY");
    let roles = split_list(&first_value(card, "ROLE"))
        .into_iter()
        .filter(|role| ROLES.contains(&role.as_str()))
        .collect::<Vec<_>>();

    Ok(Some(ContactDraft {
        name: full_name,
        nickname: first_value(card, "NICKNAME"),
        personality: if PERSONALITIES.contains(&personality.as_str()) {
            personality
        } else {
            "individual".to_owned()
        },
        roles,
        is_internal: !first_value(card, "X-RESA-INTERNAL").is_empty(),
        is_favorite: !first_value(card, "X-RESA-FAVORITE").is_empty(),
        is_active: first_value(card, "X-RESA-ACTIVE") != "0",
        tags: split_list(&first_value(card, "CATEGORIES")),
        photo: String::new(),
        phone,
        extension: first_value(card, "X-RESA-EXTENSION"),
        organization,
        job_title: first_value(card, "TITLE"),
        company_name,
        email: emails.first().map(|(_, value)| value.clone()).unwrap_or_default(),
        address,
        birthday: vcard_birthday(&first_value(card, "BDAY")),
        // vCard carries the group name as text; the CSV importer creates the
        // group, so reuse it for parity.
        category_id: find_or_create_category(connection, &first_value(card, "CATEGORIES"))?,
        contract_status: first_value(card, "X-RESA-CONTRACT"),
        note: first_value(card, "NOTE"),
        profile,
    }))
}

pub fn import_vcard(
    connection: &mut Connection,
    path: &str,
    commit: bool,
) -> Result<ContactsImportSummary, CommandError> {
    let text = std::fs::read_to_string(path).map_err(CommandError::system)?;
    let text = text.trim_start_matches('\u{feff}');
    let cards = parse_vcards(text);
    if cards.is_empty() {
        return Err(CommandError::validation("file", "文件里没有 vCard。"));
    }

    let mut summary = ContactsImportSummary { read: 0, imported: 0, skipped: 0, duplicated: 0 };
    let transaction = connection.transaction().map_err(CommandError::database)?;
    for card in &cards {
        summary.read += 1;
        let Some(draft) = draft_from_vcard(&transaction, card)? else {
            summary.skipped += 1;
            continue;
        };
        if already_stored(&transaction, &draft.name, &draft.phone).unwrap_or(false) {
            summary.duplicated += 1;
            continue;
        }
        match normalize_draft(&transaction, &draft) {
            Ok(normalized) => {
                summary.imported += 1;
                if commit {
                    insert_normalized(&transaction, normalized)?;
                }
            }
            Err(_) => summary.skipped += 1,
        }
    }
    if commit {
        transaction.commit().map_err(CommandError::database)?;
    }
    Ok(summary)
}

// --- Tauri 命令 --------------------------------------------------------------

#[tauri::command]
pub fn list_contacts(db: State<'_, AppDb>) -> Result<Vec<Contact>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}

#[tauri::command]
pub fn create_contact(db: State<'_, AppDb>, draft: ContactDraft) -> Result<Contact, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create(&mut connection, draft)
}

#[tauri::command]
pub fn update_contact(
    db: State<'_, AppDb>,
    id: String,
    draft: ContactDraft,
) -> Result<Contact, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_contact(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)
}

#[tauri::command]
pub fn export_contacts(
    db: State<'_, AppDb>,
    path: String,
) -> Result<ContactsExportSummary, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    export_csv(&connection, &path)
}

#[tauri::command]
pub fn import_contacts(
    db: State<'_, AppDb>,
    path: String,
    commit: bool,
) -> Result<ContactsImportSummary, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    import_csv(&mut connection, &path, commit)
}

#[tauri::command]
pub fn export_contacts_vcard(
    db: State<'_, AppDb>,
    path: String,
) -> Result<ContactsExportSummary, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    export_vcard(&connection, &path)
}

#[tauri::command]
pub fn import_contacts_vcard(
    db: State<'_, AppDb>,
    path: String,
    commit: bool,
) -> Result<ContactsImportSummary, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    import_vcard(&mut connection, &path, commit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
            )
            .unwrap();
        let transaction = connection.transaction().unwrap();
        migrate(&transaction).unwrap();
        migrate_directory(&transaction).unwrap();
        migrate_photos(&transaction).unwrap();
        migrate_profiles(&transaction).unwrap();
        transaction.commit().unwrap();
        connection
    }

    fn draft(name: &str) -> ContactDraft {
        ContactDraft {
            name: name.to_owned(),
            phone: "021-88991122".into(),
            ..ContactDraft::default()
        }
    }

    #[test]
    fn create_rejects_a_blank_name_and_keeps_the_table_empty() {
        let mut connection = memory_db();
        assert!(create(&mut connection, draft("   ")).is_err());
        assert_eq!(list(&connection).unwrap().len(), 0);
    }

    #[test]
    fn a_contact_without_any_way_to_reach_them_is_rejected() {
        let mut connection = memory_db();
        let bare = ContactDraft { name: "بی‌شماره".into(), ..ContactDraft::default() };
        assert!(create(&mut connection, bare).is_err());
        assert_eq!(list(&connection).unwrap().len(), 0);
    }

    #[test]
    fn create_list_update_delete_roundtrip() {
        let mut connection = memory_db();
        let contact = create(&mut connection, draft("رضا احمدی")).unwrap();
        assert_eq!(contact.personality, "individual");
        assert!(contact.is_active);
        assert_eq!(list(&connection).unwrap().len(), 1);

        let mut edited = draft("رضا احمدی‌نژاد");
        edited.is_favorite = true;
        edited.roles = vec!["colleague".into(), "manager".into(), "nonsense".into()];
        let updated = update(&mut connection, &contact.id, edited).unwrap();
        assert_eq!(updated.name, "رضا احمدی‌نژاد");
        assert_eq!(updated.roles, vec!["colleague".to_owned(), "manager".to_owned()]);
        assert!(updated.is_favorite);

        delete(&mut connection, &contact.id).unwrap();
        assert_eq!(list(&connection).unwrap().len(), 0);
    }

    #[test]
    fn fields_are_collapsed_and_capped() {
        let mut connection = memory_db();
        let mut long = draft("  سارا   کریمی  ");
        long.organization = "فناوری    اطلاعات".into();
        long.note = "x".repeat(1000);
        long.tags = vec!["مهم".into(), "مهم".into(), "  ".into()];
        let contact = create(&mut connection, long).unwrap();
        assert_eq!(contact.name, "سارا کریمی");
        assert_eq!(contact.organization, "فناوری اطلاعات");
        assert_eq!(contact.note.chars().count(), CONTACT_NOTE_MAX_CHARS);
        assert_eq!(contact.tags, vec!["مهم".to_owned()]);
    }

    #[test]
    fn a_photo_must_be_a_small_inline_image() {
        let mut connection = memory_db();
        let mut good = draft("با عکس");
        good.photo = "data:image/jpeg;base64,QUJD".into();
        create(&mut connection, good).unwrap();
        assert_eq!(list(&connection).unwrap().len(), 1);

        let mut bad = draft("عکس لینکی");
        bad.photo = "https://example.com/a.png".into();
        assert!(create(&mut connection, bad).is_err());
        assert_eq!(list(&connection).unwrap().len(), 1);
    }

    #[test]
    fn identity_numbers_are_checked_by_length_and_checksum() {
        let mut connection = memory_db();
        let mut invalid = draft("کد ملی غلط");
        invalid.profile.national_id = "1234567890".into();
        assert!(create(&mut connection, invalid).is_err());

        let mut short = draft("شناسه ملی کوتاه");
        short.profile.national_entity_id = "12345".into();
        assert!(create(&mut connection, short).is_err());

        let mut persian = draft("ارقام فارسی");
        persian.profile.national_entity_id = "۱۰۳۲۰۴۵۶۷۸۹".into();
        assert!(create(&mut connection, persian).is_ok());
    }

    #[test]
    fn a_birthday_cannot_be_in_the_future_but_a_hire_date_can() {
        let mut connection = memory_db();
        let mut future = draft("تولد آینده");
        future.birthday = "2999-01-01".into();
        assert!(create(&mut connection, future).is_err());

        let mut hired = draft("استخدام آینده");
        hired.profile.hire_date = "2999-01-01".into();
        assert!(create(&mut connection, hired).is_ok());
    }

    #[test]
    fn an_email_and_a_postal_code_are_shape_checked() {
        let mut connection = memory_db();
        let mut bad_email = draft("ایمیل خراب");
        bad_email.email = "not-an-email".into();
        assert!(create(&mut connection, bad_email).is_err());

        let mut bad_postal = draft("کدپستی خراب");
        bad_postal.profile.addresses =
            vec![ContactAddress { postal_code: "123".into(), ..ContactAddress::default() }];
        assert!(create(&mut connection, bad_postal).is_err());
    }

    #[test]
    fn an_unknown_category_is_a_validation_error() {
        let mut connection = memory_db();
        let mut with_group = draft("گروه نامعلوم");
        with_group.category_id = Some("missing".into());
        assert!(create(&mut connection, with_group).is_err());
    }

    #[test]
    fn a_contact_can_be_reached_through_a_listed_channel() {
        let mut connection = memory_db();
        let mut only_mobile = ContactDraft { name: "فقط موبایل".into(), ..ContactDraft::default() };
        only_mobile.profile.mobiles = vec![ContactLine {
            label: "اصلی".into(),
            value: "۰۹۱۲۳۴۵۶۷۸۹".into(),
        }];
        let contact = create(&mut connection, only_mobile).unwrap();
        assert_eq!(contact.profile.mobiles[0].value, "09123456789");
    }

    #[test]
    fn csv_round_trip_keeps_the_long_tail_and_skips_duplicates() {
        let mut connection = memory_db();
        let mut person = draft("سارا کریمی");
        person.nickname = "سارا".into();
        person.roles = vec!["supplier".into()];
        person.tags = vec!["طلایی".into()];
        person.profile.addresses = vec![ContactAddress {
            label: "دفتر".into(),
            city: "تهران".into(),
            full_address: "خیابان آزادی".into(),
            postal_code: "1234567890".into(),
            ..ContactAddress::default()
        }];
        create(&mut connection, person).unwrap();

        let path = std::env::temp_dir().join("resa-contacts-roundtrip.csv");
        let path = path.to_string_lossy().to_string();
        assert_eq!(export_csv(&connection, &path).unwrap().contacts, 1);

        // 同一个文件再导入一次：内容一模一样，所以只会报「重复」。
        let again = import_csv(&mut connection, &path, false).unwrap();
        assert_eq!(again.read, 1);
        assert_eq!(again.duplicated, 1);
        assert_eq!(again.imported, 0);

        // 清空后真正导入：长尾字段必须原样回来。
        connection.execute_batch("DELETE FROM contacts").unwrap();
        assert_eq!(import_csv(&mut connection, &path, true).unwrap().imported, 1);
        let rows = list(&connection).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].nickname, "سارا");
        assert_eq!(rows[0].roles, vec!["supplier".to_owned()]);
        assert_eq!(rows[0].tags, vec!["طلایی".to_owned()]);
        assert_eq!(rows[0].profile.addresses[0].postal_code, "1234567890");
        assert_eq!(rows[0].profile.addresses[0].city, "تهران");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn csv_import_reports_rows_it_cannot_use() {
        let mut connection = memory_db();
        let path = std::env::temp_dir().join("resa-contacts-skip.csv");
        let path = path.to_string_lossy().to_string();
        std::fs::write(
            &path,
            "\u{feff}name,phone\n,\nبی‌نام,\nبی‌راه,\n",
        )
        .unwrap();
        let summary = import_csv(&mut connection, &path, false).unwrap();
        assert_eq!(summary.read, 3);
        assert_eq!(summary.imported, 0);
        assert_eq!(summary.skipped, 3);
        std::fs::remove_file(&path).ok();
    }

    fn with_org(connection: &mut Connection) -> Contact {
        let mut draft = draft("مریم رضایی");
        draft.nickname = "مریم".into();
        draft.organization = "مالی".into();
        draft.job_title = "کارشناس ارشد".into();
        draft.extension = "214".into();
        draft.email = "maryam@example.com".into();
        draft.address = "تهران، خیابان آزادی ۱۲".into();
        draft.birthday = "1990-05-12".into();
        draft.is_internal = true;
        draft.roles = vec!["colleague".into()];
        draft.contract_status = "active".into();
        draft.note = "حساب‌دار ارشد".into();
        draft.profile.website = "https://example.com".into();
        draft.profile.mobiles = vec![ContactLine { label: String::new(), value: "09120000000".into() }];
        create(connection, draft).unwrap()
    }

    #[test]
    fn vcard_export_and_import_round_trip_the_directory() {
        let mut connection = memory_db();
        let stored = with_org(&mut connection);
        let path = std::env::temp_dir().join("resa-contacts.vcf");
        let path = path.to_string_lossy().to_string();

        let summary = export_vcard(&connection, &path).unwrap();
        assert_eq!(summary.contacts, 1);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("BEGIN:VCARD"));
        assert!(text.contains("FN:مریم رضایی"));
        assert!(text.contains("X-RESA-EXTENSION:214"));
        assert!(text.contains("ORG:مالی;"));

        // Importing the same file into an empty directory brings it back whole.
        let mut fresh = memory_db();
        let preview = import_vcard(&mut fresh, &path, false).unwrap();
        assert_eq!(preview.read, 1);
        assert_eq!(preview.imported, 1);
        assert_eq!(list(&fresh).unwrap().len(), 0, "预检不写库");

        let committed = import_vcard(&mut fresh, &path, true).unwrap();
        assert_eq!(committed.imported, 1);
        let rows = list(&fresh).unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.name, stored.name);
        assert_eq!(row.nickname, "مریم");
        assert_eq!(row.organization, "مالی");
        assert_eq!(row.job_title, "کارشناس ارشد");
        assert_eq!(row.extension, "214");
        assert_eq!(row.email, "maryam@example.com");
        assert_eq!(row.birthday, "1990-05-12");
        assert_eq!(row.phone, "021-88991122");
        assert!(row.is_internal);
        assert_eq!(row.roles, vec!["colleague".to_owned()]);
        assert_eq!(row.note, "حساب‌دار ارشد");
        assert_eq!(row.profile.website, "https://example.com");
        assert_eq!(row.profile.mobiles[0].value, "09120000000");

        // A second import of the same file is recognised as a duplicate.
        let again = import_vcard(&mut fresh, &path, true).unwrap();
        assert_eq!(again.duplicated, 1);
        assert_eq!(list(&fresh).unwrap().len(), 1);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn vcard_import_reads_a_card_from_a_phone() {
        let mut connection = memory_db();
        let path = std::env::temp_dir().join("resa-phone.vcf");
        let path = path.to_string_lossy().to_string();
        std::fs::write(
            &path,
            "BEGIN:VCARD\r\nVERSION:3.0\r\nN:احمدی;رضا;;;\r\nFN:رضا احمدی\r\n\
             ORG:شرکت نمونه\r\nTITLE:مدیرعامل\r\nTEL;TYPE=CELL:+989121234567\r\n\
             TEL;TYPE=WORK:02188991122\r\nEMAIL;TYPE=INTERNET:reza@example.com\r\n\
             BDAY:19850512\r\nADR;TYPE=WORK:;;تهران خیابان ولیعصر;;;;\r\n\
             NOTE:مشتری کلیدی\r\nEND:VCARD\r\n",
        )
        .unwrap();
        let summary = import_vcard(&mut connection, &path, true).unwrap();
        assert_eq!(summary.imported, 1);
        let rows = list(&connection).unwrap();
        let row = &rows[0];
        assert_eq!(row.name, "رضا احمدی");
        assert_eq!(row.phone, "+989121234567");
        assert_eq!(row.organization, "شرکت نمونه");
        assert_eq!(row.job_title, "مدیرعامل");
        assert_eq!(row.email, "reza@example.com");
        assert_eq!(row.birthday, "1985-05-12");
        assert_eq!(row.address, "تهران خیابان ولیعصر");
        assert_eq!(row.note, "مشتری کلیدی");
        assert_eq!(row.profile.phones[0].value, "02188991122");
        std::fs::remove_file(&path).ok();
    }
}

