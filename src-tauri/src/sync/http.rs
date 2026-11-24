//! Thin blocking HTTP layer for the Arianet BaaS REST API.
//!
//! Everything the sync engine needs is a couple of JSON calls, so this is a
//! deliberately small wrapper: it attaches `apikey` on every request, adds the
//! user's bearer token when there is one, and turns a non-2xx body into a
//! message we can show the user.

use crate::error::CommandError;
use reqwest::blocking::Client;
use serde_json::Value;
use std::time::Duration;

pub struct Api {
    client: Client,
    base: String,
    anon_key: String,
}

impl Api {
    pub fn new(endpoint: &str, anon_key: &str) -> Result<Self, CommandError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .user_agent("RESA/1")
            .build()
            .map_err(CommandError::system)?;
        Ok(Self {
            client,
            base: endpoint.trim_end_matches('/').to_owned(),
            anon_key: anon_key.to_owned(),
        })
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        token: Option<&str>,
        body: Option<&Value>,
    ) -> Result<Value, CommandError> {
        let url = format!("{}{}", self.base, path);
        let mut request = self
            .client
            .request(method, url)
            .header("apikey", &self.anon_key)
            .header("Accept", "application/json");
        if let Some(token) = token {
            request = request.header("Authorization", format!("Bearer {token}"));
        }
        if let Some(body) = body {
            let encoded = serde_json::to_vec(body)
                .map_err(|_| CommandError::sync("درخواست سینک ساخته نشد.".to_owned()))?;
            request = request
                .header("Content-Type", "application/json")
                .body(encoded);
        }
        let response = request.send().map_err(|error| {
            CommandError::sync(if error.is_timeout() {
                "اتصال به سرور سینک زمان‌بر شد. اتصال اینترنت را بررسی کنید."
                    .to_owned()
            } else {
                "ارتباط با سرور سینک برقرار نشد. اتصال اینترنت را بررسی کنید.".to_owned()
            })
        })?;
        let status = response.status();
        let text = response.text().unwrap_or_default();
        if !status.is_success() {
            return Err(CommandError::sync(describe_error(status.as_u16(), &text)));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text)
            .map_err(|_| CommandError::sync("پاسخ سرور سینک قابل خواندن نبود.".to_owned()))
    }

    pub fn post_json(
        &self,
        path: &str,
        token: Option<&str>,
        body: &Value,
    ) -> Result<Value, CommandError> {
        self.request(reqwest::Method::POST, path, token, Some(body))
    }

    pub fn get_json(&self, path: &str, token: Option<&str>) -> Result<Value, CommandError> {
        self.request(reqwest::Method::GET, path, token, None)
    }
}

/// The backend answers with `{"message": "...", "error_code": "..."}`. Prefer
/// the code so the text stays stable, and fall back to the status.
fn describe_error(status: u16, body: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let code = parsed
        .as_ref()
        .and_then(|value| value.get("error_code"))
        .and_then(Value::as_str);
    let message = parsed
        .as_ref()
        .and_then(|value| value.get("message").or_else(|| value.get("msg")))
        .and_then(Value::as_str);
    match (code, message) {
        (Some("invalid_credentials"), _) => "ایمیل یا رمز عبور درست نیست.".to_owned(),
        (Some("email_not_confirmed"), _) => {
            "ایمیل این حساب هنوز تأیید نشده است.".to_owned()
        }
        (Some("user_already_exists"), _) => "این ایمیل قبلاً ثبت شده است.".to_owned(),
        (Some("signup_disabled"), _) => {
            "ثبت‌نام در این پروژه بسته است یا سقف کاربران پر شده است.".to_owned()
        }
        (Some("egress_limit_reached"), _) => {
            "سقف ترافیک ماهانهٔ سرویس سینک پر شده است.".to_owned()
        }
        (Some("project_resuming"), _) => {
            "سرور سینک در حال بیدار شدن است؛ چند لحظه بعد دوباره تلاش کنید.".to_owned()
        }
        (_, Some(message)) if !message.trim().is_empty() => message.to_owned(),
        _ if status == 401 || status == 403 => {
            "دسترسی به سرور سینک رد شد. دوباره وارد شوید.".to_owned()
        }
        _ => format!("سرور سینک خطا برگرداند (کد {status})."),
    }
}

/// Percent-encode a query value. The pull cursor is a timestamp with `+` in its
/// offset, which would otherwise be read as a space.
pub fn encode_query_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::encode_query_value;

    #[test]
    fn encodes_the_plus_in_a_timestamp_offset() {
        assert_eq!(
            encode_query_value("2026-11-23T10:45:12.123456+00:00"),
            "2026-11-23T10%3A45%3A12.123456%2B00%3A00"
        );
    }
}
