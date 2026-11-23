// Prevents an extra console window on Windows in release builds. DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// The desktop binary and the Android library share one implementation. The
// library target (`src/lib.rs`) is what `tauri android build` links; this
// binary includes the same items so `cargo test --bin nowly` runs the whole
// unit-test suite, which is how the project has always been tested.
include!("lib.rs");

fn main() {
    run();
}
