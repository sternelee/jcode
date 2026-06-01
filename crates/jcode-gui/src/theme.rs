//! Color theme hex strings for jcode-gui.
//!
//! Colors are referenced directly in `script_mod!` as hex literals (e.g. `color: #1a1a1e`).
//! These constants are kept for use in Rust code that needs to set colors programmatically.

// ── Background hex strings ────────────────────────────────────────────────────
pub const BG_PRIMARY:   &str = "#1a1a1e";
pub const BG_PANEL:     &str = "#202026";
pub const BG_CHAT:      &str = "#141418";
pub const BG_SELECTED:  &str = "#2d2d37";
pub const BG_ASSISTANT: &str = "#262a37";
pub const BG_USER:      &str = "#1c3a58";
pub const BG_TOOL:      &str = "#232d23";
pub const BG_SYSTEM:    &str = "#372d19";
pub const BG_ERROR:     &str = "#461919";
pub const BG_COMPOSER:  &str = "#1e1e24";

// ── Foreground hex strings ────────────────────────────────────────────────────
pub const FG_PRIMARY:   &str = "#dcdce6";
pub const FG_DIM:       &str = "#8c8c9b";
pub const FG_ACCENT:    &str = "#8ab4f8";
pub const FG_USER:      &str = "#64c8dc";
pub const FG_ASSISTANT: &str = "#d2d2dc";
pub const FG_SYSTEM:    &str = "#c8af50";
pub const FG_ERROR:     &str = "#ff6464";
pub const FG_TOOL:      &str = "#78c88c";

// ── Swarm status hex strings ──────────────────────────────────────────────────
pub const SWARM_SPAWNED:   &str = "#8c8c96";
pub const SWARM_READY:     &str = "#78b478";
pub const SWARM_RUNNING:   &str = "#ffc864";
pub const SWARM_BLOCKED:   &str = "#ffaa50";
pub const SWARM_FAILED:    &str = "#ff6464";
pub const SWARM_COMPLETED: &str = "#64c864";
pub const SWARM_STOPPED:   &str = "#8c8c96";

// ── Kanban column hex strings ─────────────────────────────────────────────────
pub const KANBAN_TODO:    &str = "#6482aa";
pub const KANBAN_RUNNING: &str = "#ffc864";
pub const KANBAN_DONE:    &str = "#64c864";
pub const KANBAN_FAILED:  &str = "#ff6464";
pub const KANBAN_BLOCKED: &str = "#ffaa50";
