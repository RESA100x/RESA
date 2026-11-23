//! Android stand-in for the Windows status-island module.
//!
//! The business layer (tasks, events, subscriptions, assistant) calls
//! `status_island::invalidate` and `invalidate_registered` after every write so
//! the desktop top bar repaints. Android has no status island, so these are
//! deliberate no-ops that keep the call sites platform-agnostic.

use crate::error::CommandError;
use tauri::AppHandle;

pub(crate) fn invalidate(_app: &AppHandle) -> Result<(), CommandError> {
    Ok(())
}

pub(crate) fn invalidate_registered() -> Result<(), CommandError> {
    Ok(())
}
