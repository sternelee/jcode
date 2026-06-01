//! Binary entry point for `jcode-gui`.
//!
//! Delegates entirely to the Makepad `app_main!` macro registered in `app.rs`.
//! The `app_main!` macro expands to a `main` function so this file only needs
//! to pull in the crate root.

fn main() {
    jcode_gui::app::main_app();
}
