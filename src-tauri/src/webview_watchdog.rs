//! Automatic recovery when the WebView2 browser process dies.
//!
//! WebView2 renders the whole interface in a separate `msedgewebview2.exe`
//! process that is a direct child of this process. If that child is killed —
//! an installer asking running apps to close, a GPU reset, an out-of-memory
//! kill — every Tauri window keeps existing but paints nothing. The app then
//! looks frozen and never recovers on its own, which is exactly the state a
//! user reports as "the program hung".
//!
//! The watchdog polls for the child process and relaunches the app when it
//! disappears. A cooldown stamp on disk keeps a crash loop from becoming an
//! endless restart loop.

use std::time::Duration;
use tauri::{AppHandle, Runtime};

/// The browser process is spawned lazily, so early checks would only produce
/// false positives.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(45);
const CHECK_INTERVAL: Duration = Duration::from_secs(10);
/// Three consecutive misses is ~30 seconds of a genuinely dead webview.
const MISSES_BEFORE_RESTART: u32 = 3;
/// Two relaunches closer than this mean the app crashes on start; stay put.
const RESTART_COOLDOWN: Duration = Duration::from_secs(180);

pub fn start<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || watch(app));
}

fn watch<R: Runtime>(app: AppHandle<R>) {
    std::thread::sleep(FIRST_CHECK_DELAY);
    let mut seen_webview = false;
    let mut misses = 0u32;
    let mut last_state: Option<bool> = None;
    loop {
        let state = webview_process_present();
        match state {
            Some(true) => {
                seen_webview = true;
                misses = 0;
            }
            Some(false) if seen_webview => {
                misses += 1;
                if misses >= MISSES_BEFORE_RESTART {
                    if relaunch(&app) {
                        return;
                    }
                    misses = 0;
                }
            }
            _ => {}
        }
        if state != last_state {
            crate::startup_log(&format!(
                "webview watchdog: present={state:?} armed={seen_webview} misses={misses}"
            ));
            last_state = state;
        }
        std::thread::sleep(CHECK_INTERVAL);
    }
}

fn relaunch<R: Runtime>(app: &AppHandle<R>) -> bool {
    let now = std::time::SystemTime::now();
    if !restart_allowed(last_restart_at(), now) {
        crate::startup_log("webview watchdog: webview missing, restart suppressed by cooldown");
        return false;
    }
    write_restart_stamp(now);
    crate::startup_log("webview watchdog: webview process missing, relaunching");
    if let Err(error) = spawn_successor() {
        crate::startup_log(&format!("webview watchdog: relaunch failed: {error}"));
        return false;
    }
    app.exit(0);
    true
}

fn restart_allowed(last: Option<std::time::SystemTime>, now: std::time::SystemTime) -> bool {
    match last {
        None => true,
        Some(last) => now
            .duration_since(last)
            .map(|elapsed| elapsed >= RESTART_COOLDOWN)
            // A clock that moved backwards must not lock the app out of recovery.
            .unwrap_or(true),
    }
}

fn stamp_path() -> Option<std::path::PathBuf> {
    std::env::var_os("APPDATA").map(|base| {
        std::path::PathBuf::from(base)
            .join("com.resa.app")
            .join("webview-restart.stamp")
    })
}

fn last_restart_at() -> Option<std::time::SystemTime> {
    let raw = std::fs::read_to_string(stamp_path()?).ok()?;
    let seconds: u64 = raw.trim().parse().ok()?;
    std::time::UNIX_EPOCH.checked_add(Duration::from_secs(seconds))
}

fn write_restart_stamp(now: std::time::SystemTime) {
    let Some(path) = stamp_path() else {
        return;
    };
    let seconds = now
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, seconds.to_string());
}

/// Starts a detached helper that waits for this process to exit and then opens
/// the app again with the arguments it was originally started with.
#[cfg(target_os = "windows")]
fn spawn_successor() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe = exe.display().to_string().replace('\'', "''");
    let args = std::env::args()
        .skip(1)
        .map(|arg| format!("'{}'", arg.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",");
    let argument_list = if args.is_empty() {
        String::new()
    } else {
        format!(" -ArgumentList @({args})")
    };
    let script = format!(
        "$p={pid}; while (Get-Process -Id $p -ErrorAction SilentlyContinue) {{ Start-Sleep -Milliseconds 300 }}; \
         Start-Sleep -Milliseconds 600; Start-Process -FilePath '{exe}'{argument_list}",
        pid = std::process::id(),
        exe = exe,
        argument_list = argument_list,
    );
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "windows"))]
fn spawn_successor() -> Result<(), String> {
    Err("automatic relaunch is only supported on Windows".into())
}

/// `Some(true)` when a WebView2 browser process is a direct child of this
/// process, `Some(false)` when it is gone, `None` where the concept does not
/// apply (non-Windows targets) or the snapshot could not be taken.
#[cfg(target_os = "windows")]
fn webview_process_present() -> Option<bool> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let parent = std::process::id();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut present = false;
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                if entry.th32ParentProcessID == parent {
                    let name = String::from_utf16_lossy(&entry.szExeFile);
                    if name
                        .trim_end_matches('\0')
                        .eq_ignore_ascii_case("msedgewebview2.exe")
                    {
                        present = true;
                        break;
                    }
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
        Some(present)
    }
}

#[cfg(not(target_os = "windows"))]
fn webview_process_present() -> Option<bool> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_restart_is_always_allowed() {
        assert!(restart_allowed(None, std::time::SystemTime::now()));
    }

    #[test]
    fn restart_is_suppressed_within_cooldown() {
        let now = std::time::SystemTime::now();
        let recent = now - Duration::from_secs(30);
        assert!(!restart_allowed(Some(recent), now));
    }

    #[test]
    fn restart_is_allowed_after_cooldown() {
        let now = std::time::SystemTime::now();
        let old = now - RESTART_COOLDOWN - Duration::from_secs(1);
        assert!(restart_allowed(Some(old), now));
    }

    #[test]
    fn clock_moving_backwards_does_not_block_recovery() {
        let now = std::time::SystemTime::now();
        let future = now + Duration::from_secs(600);
        assert!(restart_allowed(Some(future), now));
    }
}
