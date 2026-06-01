//! Binary entry point for `jcode-gui`.
//!
//! The `app_main!(App)` macro in `app.rs` generates `app_main()`,
//! so we just delegate to it here.

fn main() {
    jcode_gui::app::app_main();
}
