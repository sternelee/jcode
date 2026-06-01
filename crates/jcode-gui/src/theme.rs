//! Color theme for jcode-gui.
//!
//! Mirrors the TUI colour palette (jcode-tui-style + info_widget colours)
//! translated to Makepad's `Vec4` (RGBA f32 0.0-1.0) format.

use makepad_widgets::makepad_micro_serde::*;

/// Convert an (r, g, b) u8 triple and alpha to a Makepad Vec4.
#[inline]
pub fn rgba(r: u8, g: u8, b: u8, a: u8) -> makepad_widgets::DVec4 {
    makepad_widgets::DVec4 {
        x: r as f64 / 255.0,
        y: g as f64 / 255.0,
        z: b as f64 / 255.0,
        w: a as f64 / 255.0,
    }
}

#[inline]
pub fn rgb(r: u8, g: u8, b: u8) -> makepad_widgets::DVec4 {
    rgba(r, g, b, 255)
}

// ── Background ────────────────────────────────────────────────────────────────
/// Main window background (dark charcoal)
pub fn bg_primary()   -> makepad_widgets::DVec4 { rgb(26,  26,  30) }
/// Left / right panel background
pub fn bg_panel()     -> makepad_widgets::DVec4 { rgb(32,  32,  38) }
/// Message list background
pub fn bg_chat()      -> makepad_widgets::DVec4 { rgb(20,  20,  24) }
/// Selected / hovered item
pub fn bg_selected()  -> makepad_widgets::DVec4 { rgb(45,  45,  55) }
/// Card / bubble background for assistant messages
pub fn bg_assistant() -> makepad_widgets::DVec4 { rgb(38,  42,  55) }
/// Card / bubble background for user messages
pub fn bg_user()      -> makepad_widgets::DVec4 { rgb(28,  58,  88) }
/// Tool call card background
pub fn bg_tool()      -> makepad_widgets::DVec4 { rgb(35,  45,  35) }
/// System message background
pub fn bg_system()    -> makepad_widgets::DVec4 { rgb(55,  45,  25) }
/// Error message background
pub fn bg_error()     -> makepad_widgets::DVec4 { rgb(70,  25,  25) }
/// Input / composer background
pub fn bg_composer()  -> makepad_widgets::DVec4 { rgb(30,  30,  36) }

// ── Foreground ────────────────────────────────────────────────────────────────
pub fn fg_primary()   -> makepad_widgets::DVec4 { rgb(220, 220, 230) }
pub fn fg_dim()       -> makepad_widgets::DVec4 { rgb(140, 140, 155) }
pub fn fg_accent()    -> makepad_widgets::DVec4 { rgb(138, 180, 248) }
/// User message text colour (bright cyan)
pub fn fg_user()      -> makepad_widgets::DVec4 { rgb(100, 200, 220) }
/// Assistant message text colour (soft white)
pub fn fg_assistant() -> makepad_widgets::DVec4 { rgb(210, 210, 220) }
pub fn fg_system()    -> makepad_widgets::DVec4 { rgb(200, 175,  80) }
pub fn fg_error()     -> makepad_widgets::DVec4 { rgb(255, 100, 100) }
pub fn fg_tool()      -> makepad_widgets::DVec4 { rgb(120, 200, 140) }

// ── Swarm status colours ──────────────────────────────────────────────────────
pub fn swarm_spawned()   -> makepad_widgets::DVec4 { rgb(140, 140, 150) }
pub fn swarm_ready()     -> makepad_widgets::DVec4 { rgb(120, 180, 120) }
pub fn swarm_running()   -> makepad_widgets::DVec4 { rgb(255, 200, 100) }
pub fn swarm_blocked()   -> makepad_widgets::DVec4 { rgb(255, 170,  80) }
pub fn swarm_failed()    -> makepad_widgets::DVec4 { rgb(255, 100, 100) }
pub fn swarm_completed() -> makepad_widgets::DVec4 { rgb(100, 200, 100) }
pub fn swarm_stopped()   -> makepad_widgets::DVec4 { rgb(140, 140, 150) }

// ── Kanban column accent colours ──────────────────────────────────────────────
pub fn kanban_todo()    -> makepad_widgets::DVec4 { rgb(100, 130, 170) }
pub fn kanban_running() -> makepad_widgets::DVec4 { rgb(255, 200, 100) }
pub fn kanban_done()    -> makepad_widgets::DVec4 { rgb(100, 200, 100) }
pub fn kanban_failed()  -> makepad_widgets::DVec4 { rgb(255, 100, 100) }
pub fn kanban_blocked() -> makepad_widgets::DVec4 { rgb(255, 170,  80) }
