//! jcode-gui — Makepad-based GUI for jcode
//!
//! Provides a Telegram-style agent conversation platform with:
//!   • Session/swarm group list (left panel)
//!   • Message list with role-coloured bubbles (centre)
//!   • Agent status panel with swarm member cards (right)
//!   • Composer input with slash-command and shell-mode detection (bottom)
//!   • Kanban plan board for swarm task tracking

// Re-export makepad_widgets so `crate::makepad_widgets::script_mod` resolves in app.rs
pub use makepad_widgets;

pub mod agent_status;
pub mod app;
pub mod composer;
pub mod file_popup;
pub mod gui_state;
pub mod message_list;
pub mod session_list;
pub mod slash_popup;
pub mod swarm_board;
pub mod theme;
