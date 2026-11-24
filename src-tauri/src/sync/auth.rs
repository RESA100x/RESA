//! Email/password sign-in against the BaaS Auth API.

use super::http::Api;
use crate::error::CommandError;
use serde_json::{json, Value};

pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub user_id: String,
    pub email: Option<String>,
}

fn parse_session(value: &Value) -> Result<Session, CommandError> {
    let access_token = value
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            CommandError::sync(
                "ورود انجام نشد. اگر ایمیل تأیید برایتان آمده، ابتدا آن را تأیید کنید."
                    .to_owned(),
            )
        })?;
    let refresh_token = value
        .get("refresh_token")
        .and_then(Value::as_str)
        .ok_or_else(|| CommandError::sync("پاسخ ورود ناقص بود؛ دوباره تلاش کنید.".to_owned()))?;
    let expires_at = value
        .get("expires_at")
        .and_then(Value::as_i64)
        .or_else(|| {
            value
                .get("expires_in")
                .and_then(Value::as_i64)
                .map(|seconds| chrono::Utc::now().timestamp() + seconds)
        })
        .unwrap_or_else(|| chrono::Utc::now().timestamp() + 3600);
    let user = value.get("user").cloned().unwrap_or(Value::Null);
    let user_id = user
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let email = user
        .get("email")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok(Session {
        access_token: access_token.to_owned(),
        refresh_token: refresh_token.to_owned(),
        expires_at,
        user_id,
        email,
    })
}

pub fn sign_in(api: &Api, email: &str, password: &str) -> Result<Session, CommandError> {
    let body = json!({ "email": email, "password": password });
    let value = api.post_json("/auth/v1/token?grant_type=password", None, &body)?;
    parse_session(&value)
}

/// `phone` rides along as user metadata. The backend keeps it on the profile;
/// verifying it needs an SMS gateway, which is wired up separately.
pub fn sign_up(
    api: &Api,
    email: &str,
    password: &str,
    phone: Option<&str>,
) -> Result<Session, CommandError> {
    let mut body = json!({ "email": email, "password": password });
    if let Some(phone) = phone.filter(|value| !value.is_empty()) {
        body["data"] = json!({ "phone": phone });
    }
    let value = api.post_json("/auth/v1/signup", None, &body)?;
    parse_session(&value)
}

/// Re-sends the signup confirmation mail. Safe to call repeatedly.
pub fn resend_confirmation(api: &Api, email: &str) -> Result<(), CommandError> {
    api.post_json(
        "/auth/v1/resend",
        None,
        &json!({ "type": "signup", "email": email }),
    )?;
    Ok(())
}

pub fn refresh(api: &Api, refresh_token: &str) -> Result<Session, CommandError> {
    let body = json!({ "refresh_token": refresh_token });
    let value = api.post_json("/auth/v1/token?grant_type=refresh_token", None, &body)?;
    parse_session(&value)
}
