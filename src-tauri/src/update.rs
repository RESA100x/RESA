use crate::error::CommandError;
use crate::net;
use serde::Serialize;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

// Software update check.
//
// The app ships with a fixed version (from Cargo at build time). On launch the
// frontend asks this layer whether a newer release exists on GitHub. We read the
// project's "latest release" from the public GitHub Releases API, compare its
// semantic version against the running one, and hand back the current version,
// the latest version, whether an update is available, plus the release notes and
// the page URL so the About dialog can show the newest changelog.
//
// The request goes through the same hardened https fetch used elsewhere
// (https-only, no private IPs, no redirects, size-capped, short timeout). A
// failure to reach GitHub is not fatal: the command returns an error the
// frontend treats as "no update info", so the About dialog still shows the
// current version offline.

// Which GitHub repository publishes releases for *this* build. It comes from
// the repository-root `resa.config.json` (`repo`), or from the `RESA_REPO`
// environment variable at build time. Left empty, the update check is skipped
// entirely — the app never offers another project's releases as its own.
#[derive(serde::Deserialize)]
struct ResaConfig {
    #[serde(default)]
    repo: String,
}

const RESA_CONFIG_JSON: &str = include_str!("../../resa.config.json");

fn update_repo() -> String {
    // Prefer an explicit build-time override so CI can inject the repository.
    if let Some(repo) = option_env!("RESA_REPO") {
        let repo = repo.trim();
        if !repo.is_empty() {
            return repo.to_owned();
        }
    }
    static CONFIG: OnceLock<ResaConfig> = OnceLock::new();
    let config = CONFIG.get_or_init(|| serde_json::from_str(RESA_CONFIG_JSON).unwrap_or(ResaConfig { repo: String::new() }));
    config.repo.trim().to_owned()
}

fn latest_release_api(repo: &str) -> String {
    format!("https://api.github.com/repos/{repo}/releases/latest")
}

fn releases_page_url(repo: &str) -> String {
    format!("https://github.com/{repo}/releases")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    // The version the running app was built with.
    pub current_version: String,
    // The latest published release version, when it could be fetched.
    pub latest_version: Option<String>,
    // True only when a strictly newer release exists.
    pub update_available: bool,
    // The latest release's notes / changelog body, when available.
    pub release_notes: Option<String>,
    // The human-facing release page to open.
    pub release_url: String,
    // The latest release's published date (ISO-8601), when available.
    pub published_at: Option<String>,
}

// Parse a semantic version like "1.2.3" (with an optional leading "v") into its
// numeric components. Missing or non-numeric parts read as 0, so "1.2" parses to
// (1, 2, 0). Anything after a pre-release/build separator ("-", "+") is ignored.
fn parse_version(raw: &str) -> (u64, u64, u64) {
    let trimmed = raw.trim();
    let without_v = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    // Drop any pre-release/build metadata so "1.2.3-beta.1" compares as 1.2.3.
    let core = without_v.split(['-', '+']).next().unwrap_or(without_v);
    let mut parts = core
        .split('.')
        .map(|part| part.trim().parse::<u64>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    let patch = parts.next().unwrap_or(0);
    (major, minor, patch)
}

// True when `latest` is strictly newer than `current`.
fn is_newer(latest: &str, current: &str) -> bool {
    parse_version(latest) > parse_version(current)
}

// Pull the pieces we need out of the GitHub release JSON without a full typed
// model: the tag name (version), the notes body, and the published date.
fn parse_release(json: &str) -> Result<(String, Option<String>, Option<String>), CommandError> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|_| CommandError::system("invalid release payload"))?;
    let tag = value
        .get("tag_name")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .ok_or_else(|| CommandError::system("release payload missing tag_name"))?;
    let notes = value
        .get("body")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .filter(|s| !s.trim().is_empty());
    let published = value
        .get("published_at")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    Ok((tag, notes, published))
}

fn run_check(current_version: String) -> Result<UpdateInfo, CommandError> {
    let repo = update_repo();
    if repo.is_empty() {
        // No repository configured for this build: report the running version
        // only, so the About dialog stays offline and never points elsewhere.
        return Ok(UpdateInfo {
            current_version,
            latest_version: None,
            update_available: false,
            release_notes: None,
            release_url: String::new(),
            published_at: None,
        });
    }
    let body = net::fetch_public_text(&latest_release_api(&repo))?;
    let (tag, notes, published) = parse_release(&body)?;
    let update_available = is_newer(&tag, &current_version);
    Ok(UpdateInfo {
        current_version,
        latest_version: Some(tag),
        update_available,
        release_notes: notes,
        release_url: releases_page_url(&repo),
        published_at: published,
    })
}

#[tauri::command]
pub fn check_for_update() -> Result<UpdateInfo, CommandError> {
    if crate::package::aumid().map_err(CommandError::system)?.is_some() {
        let product_id = crate::package::store_product_id().map_err(CommandError::system)?;
        return Ok(UpdateInfo {
            current_version: env!("CARGO_PKG_VERSION").to_owned(), latest_version: None,
            update_available: false, release_notes: None, published_at: None,
            release_url: crate::package_policy::store_url(Some(&product_id)).unwrap(),
        });
    }
    run_check(env!("CARGO_PKG_VERSION").to_owned())
}

// ---------------------------------------------------------------------------
// In-app install
//
// The check above only tells the user a newer release exists. This half fetches
// the release's installer asset, verifies its published SHA-256 when the
// release ships a `SHA256SUMS.txt`, writes it to a temp folder, and hands off to
// a detached PowerShell helper that waits for this process to exit, runs the
// NSIS installer silently, then relaunches the app. The UI shows download
// progress from the `update-download-progress` event.

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ReleaseAsset {
    name: String,
    url: String,
}

fn parse_assets(json: &str) -> Vec<ReleaseAsset> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    value
        .get("assets")
        .and_then(|assets| assets.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = item.get("name")?.as_str()?.to_owned();
                    let url = item.get("browser_download_url")?.as_str()?.to_owned();
                    Some(ReleaseAsset { name, url })
                })
                .collect()
        })
        .unwrap_or_default()
}

// Prefer the x64 NSIS setup, then any NSIS setup, then any .exe. MSI is not
// used: it cannot be installed silently without elevation.
fn pick_installer(assets: &[ReleaseAsset]) -> Option<&ReleaseAsset> {
    let setup = |asset: &&ReleaseAsset| asset.name.to_ascii_lowercase().ends_with("-setup.exe");
    assets
        .iter()
        .find(|asset| setup(&asset) && asset.name.to_ascii_lowercase().contains("x64"))
        .or_else(|| assets.iter().find(setup))
        .or_else(|| {
            assets
                .iter()
                .find(|asset| asset.name.to_ascii_lowercase().ends_with(".exe"))
        })
}

fn find_checksum_asset(assets: &[ReleaseAsset]) -> Option<&ReleaseAsset> {
    assets
        .iter()
        .find(|asset| asset.name.eq_ignore_ascii_case("SHA256SUMS.txt"))
}

// Read the hash for `file_name` out of a `sha256sum`-style listing. Lines look
// like `<hex>  <name>` or `<hex> *<name>`; blank lines and `#` comments are
// ignored.
fn expected_sha256(sums: &str, file_name: &str) -> Option<String> {
    for line in sums.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        if name.eq_ignore_ascii_case(file_name) && hash.len() == 64 {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

fn hex_sha256(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(target_os = "windows")]
fn launch_installer(
    installer: &std::path::Path,
    exe: &std::path::Path,
) -> Result<(), CommandError> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // Wait for this process to exit first: the NSIS installer cannot replace a
    // running executable. Then install silently and relaunch the app.
    let script = format!(
        "$p={pid}; while (Get-Process -Id $p -ErrorAction SilentlyContinue) {{ Start-Sleep -Milliseconds 400 }}; \
         Start-Process -FilePath '{installer}' -ArgumentList '/S' -Wait; \
         Start-Process -FilePath '{exe}'",
        pid = std::process::id(),
        installer = installer.display(),
        exe = exe.display(),
    );
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(CommandError::system)?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_installer(
    _installer: &std::path::Path,
    _exe: &std::path::Path,
) -> Result<(), CommandError> {
    Err(CommandError::validation(
        "update",
        "نصب خودکار فقط در ویندوز پشتیبانی می‌شود.",
    ))
}

fn download_and_install(app: &AppHandle, repo: &str) -> Result<(), CommandError> {
    let body = net::fetch_public_text(&latest_release_api(repo))?;
    let assets = parse_assets(&body);
    let installer = pick_installer(&assets)
        .ok_or_else(|| CommandError::validation("update", "فایل نصب در این نسخه پیدا نشد."))?;

    // A missing checksum file is not fatal (older releases have none), but when
    // it exists the downloaded installer must match it.
    let expected = find_checksum_asset(&assets)
        .and_then(|asset| net::fetch_public_text(&asset.url).ok())
        .and_then(|sums| expected_sha256(&sums, &installer.name));

    let mut last_emitted = 0u64;
    let bytes = net::fetch_release_asset(&installer.url, net::installer_size_limit(), |downloaded, total| {
        if downloaded.saturating_sub(last_emitted) >= 256 * 1024 || Some(downloaded) == total {
            last_emitted = downloaded;
            let _ = app.emit("update-download-progress", UpdateProgress { downloaded, total });
        }
    })?;

    if let Some(expected) = expected {
        if hex_sha256(&bytes) != expected {
            return Err(CommandError::validation(
                "update",
                "هش فایل نصب با فایل منتشرشده نمی‌خواند.",
            ));
        }
    }

    let dir = std::env::temp_dir().join("resa-update");
    std::fs::create_dir_all(&dir).map_err(CommandError::system)?;
    let installer_path = dir.join(&installer.name);
    std::fs::write(&installer_path, &bytes).map_err(CommandError::system)?;

    let exe = std::env::current_exe().map_err(CommandError::system)?;
    launch_installer(&installer_path, &exe)?;
    let _ = app.emit("update-installing", ());
    app.exit(0);
    Ok(())
}

/// Download the newest release's installer and install it, then restart RESA.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), CommandError> {
    if crate::package::aumid().map_err(CommandError::system)?.is_some() {
        return Err(CommandError::validation(
            "update",
            "این نسخه از فروشگاه به‌روزرسانی می‌شود.",
        ));
    }
    let repo = update_repo();
    if repo.is_empty() {
        return Err(CommandError::validation(
            "update",
            "مخزن به‌روزرسانی تنظیم نشده است.",
        ));
    }
    tauri::async_runtime::spawn_blocking(move || download_and_install(&app, &repo))
        .await
        .map_err(CommandError::system)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_versions_with_optional_v_prefix() {
        assert_eq!(parse_version("1.2.3"), (1, 2, 3));
        assert_eq!(parse_version("v1.2.3"), (1, 2, 3));
        assert_eq!(parse_version("V2.0"), (2, 0, 0));
        assert_eq!(parse_version(" 0.1.1 "), (0, 1, 1));
    }

    #[test]
    fn ignores_prerelease_and_build_metadata() {
        assert_eq!(parse_version("1.2.3-beta.1"), (1, 2, 3));
        assert_eq!(parse_version("1.2.3+build.9"), (1, 2, 3));
    }

    #[test]
    fn detects_strictly_newer_releases() {
        assert!(is_newer("0.1.2", "0.1.1"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("v0.2.0", "0.1.9"));
        assert!(!is_newer("0.1.1", "0.1.1"));
        assert!(!is_newer("0.1.0", "0.1.1"));
    }

    #[test]
    fn extracts_release_fields() {
        let json = r#"{
            "tag_name": "v0.2.0",
            "body": "Changelog: new stuff",
            "published_at": "2025-01-01T00:00:00Z"
        }"#;
        let (tag, notes, published) = parse_release(json).unwrap();
        assert_eq!(tag, "v0.2.0");
        assert_eq!(notes.as_deref(), Some("Changelog: new stuff"));
        assert_eq!(published.as_deref(), Some("2025-01-01T00:00:00Z"));
    }

    #[test]
    fn treats_blank_body_as_no_notes() {
        let json = r#"{ "tag_name": "v0.2.0", "body": "   " }"#;
        let (tag, notes, _) = parse_release(json).unwrap();
        assert_eq!(tag, "v0.2.0");
        assert_eq!(notes, None);
    }

    #[test]
    fn missing_tag_is_an_error() {
        let json = r#"{ "body": "notes" }"#;
        assert!(parse_release(json).is_err());
    }

    #[test]
    fn release_urls_follow_the_configured_repository() {
        assert_eq!(
            latest_release_api("someone/resa"),
            "https://api.github.com/repos/someone/resa/releases/latest"
        );
        assert_eq!(
            releases_page_url("someone/resa"),
            "https://github.com/someone/resa/releases"
        );
    }

    #[test]
    fn picks_the_x64_setup_installer() {
        let json = r#"{
            "tag_name": "v0.2.22",
            "assets": [
                { "name": "RESA_0.2.22_x64_en-US.msi", "browser_download_url": "https://github.com/a/b/releases/download/v0.2.22/a.msi" },
                { "name": "RESA_0.2.22_x64-setup.exe", "browser_download_url": "https://github.com/a/b/releases/download/v0.2.22/b.exe" },
                { "name": "SHA256SUMS.txt", "browser_download_url": "https://github.com/a/b/releases/download/v0.2.22/sums.txt" }
            ]
        }"#;
        let assets = parse_assets(json);
        assert_eq!(assets.len(), 3);
        let installer = pick_installer(&assets).expect("an installer is present");
        assert_eq!(installer.name, "RESA_0.2.22_x64-setup.exe");
        assert_eq!(
            find_checksum_asset(&assets).map(|asset| asset.name.as_str()),
            Some("SHA256SUMS.txt")
        );
    }

    #[test]
    fn no_installer_means_no_asset() {
        let json = r#"{ "assets": [ { "name": "notes.txt", "browser_download_url": "https://github.com/a/b/c" } ] }"#;
        assert!(pick_installer(&parse_assets(json)).is_none());
    }

    #[test]
    fn reads_a_matching_checksum_line() {
        let hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let sums = format!("# generated\n{hash}  RESA_0.2.22_x64-setup.exe\n");
        assert_eq!(
            expected_sha256(&sums, "RESA_0.2.22_x64-setup.exe").as_deref(),
            Some(hash)
        );
        assert_eq!(expected_sha256(&sums, "other.exe"), None);
    }

    #[test]
    fn an_unconfigured_repository_disables_the_update_check() {
        // The shipped default is empty so a build never advertises another
        // project's releases as its own.
        if update_repo().is_empty() {
            let info = run_check("0.1.5".to_owned()).expect("disabled check is not an error");
            assert_eq!(info.current_version, "0.1.5");
            assert!(!info.update_available);
            assert_eq!(info.latest_version, None);
            assert!(info.release_url.is_empty());
        }
    }
}
