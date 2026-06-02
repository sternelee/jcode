//! jcode-gui — Makepad-based GUI for jcode
//!
//! Hosts the full jcode server in-process and renders a Telegram-style
//! agent conversation surface on top of it:
//!   • Session/swarm group list (left panel)
//!   • Message list with role-coloured bubbles (centre)
//!   • Agent status panel with swarm member cards (right)
//!   • Composer input with slash-command and shell-mode detection (bottom)
//!   • Kanban plan board for swarm task tracking
//!
//! The GUI binary embeds `jcode-app-core`'s `Server` directly (see
//! `gui_backend.rs` and `inproc_client` in `jcode-app-core`) — there is
//! no separate `jcode serve` subprocess. The Makepad main thread owns
//! the widget tree; the server runs on a worker tokio runtime and
//! exchanges `Request` / `ServerEvent` values with the UI through an
//! in-process paired stream (no socket hop).

// Re-export makepad_widgets so `crate::makepad_widgets::script_mod` resolves in app.rs
pub use makepad_widgets;

// Re-export the full jcode-app-core so all server-side types and APIs
// (Server, InprocClient, Request, ServerEvent, Provider, ...) are
// reachable as `jcode_gui::jcode_app_core::*`. The `*-types` crates
// the widgets need (jcode_protocol, jcode_session_types, etc.) are
// still listed as direct deps in Cargo.toml — they are small,
// serde-only crates, and keeping the direct deps avoids touching
// every `use` in the widget files.
pub use jcode_app_core;

pub mod agent_status;
pub mod app;
pub mod composer;
pub mod file_popup;
pub mod gui_backend;
pub mod gui_state;
pub mod message_list;
pub mod session_list;
pub mod slash_popup;
pub mod swarm_board;
pub mod theme;
