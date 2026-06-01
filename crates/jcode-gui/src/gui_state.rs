//! Shared GUI state types for jcode-gui.
//!
//! These mirror the data models used by jcode-tui (DisplayMessage, SwarmMemberStatus, etc.)
//! but are decoupled from ratatui so they can be used with Makepad.

use jcode_message_types::ToolCall;
use jcode_protocol::SwarmMemberStatus;
pub use jcode_swarm_core::{SwarmLifecycleStatus, SwarmRole};

/// Global GUI state — read by widget draw_walk, written by AppMain event handlers.
pub static GUI_STATE: std::sync::RwLock<GuiState> =
    std::sync::RwLock::new(GuiState {
        sessions: Vec::new(),
        active_session_id: None,
        messages: Vec::new(),
        swarm_members: Vec::new(),
        plan_tasks: Vec::new(),
        composer_draft: String::new(),
        processing_status: ProcessingStatus::Idle,
        model_name: String::new(),
        session_tokens: None,
        slash_suggestions: Vec::new(),
        slash_selected: 0,
        file_suggestions: Vec::new(),
        file_selected: 0,
    });

// ── Session / conversation ────────────────────────────────────────────────────

/// Whether a session entry in the left panel is a direct session or a swarm group.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SessionKind {
    /// A regular 1:1 AI session.
    Single,
    /// A swarm group that aggregates multiple sub-agents.
    SwarmGroup { swarm_id: String },
}

/// One entry shown in the left-side session list panel.
#[derive(Clone, Debug)]
pub struct SessionEntry {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub kind: SessionKind,
    pub is_active: bool,
    pub unread: usize,
}

impl SessionEntry {
    /// Unicode role prefix shown to the left of the session title.
    pub fn icon(&self) -> &'static str {
        match &self.kind {
            SessionKind::Single => "·",
            SessionKind::SwarmGroup { .. } => "★",
        }
    }
}

// ── Messages ──────────────────────────────────────────────────────────────────

/// Display role used to decide bubble colour / alignment.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MessageRole {
    User,
    Assistant,
    System,
    Tool,
    Error,
    BackgroundTask,
    Usage,
}

impl MessageRole {
    pub fn from_str(role: &str) -> Self {
        match role {
            "user" => Self::User,
            "assistant" => Self::Assistant,
            "system" => Self::System,
            "tool" => Self::Tool,
            "error" => Self::Error,
            "background_task" => Self::BackgroundTask,
            "usage" => Self::Usage,
            _ => Self::System,
        }
    }

    /// Label text shown in the UI above the bubble.
    pub fn label(&self) -> &'static str {
        match self {
            Self::User => "You",
            Self::Assistant => "Agent",
            Self::System => "System",
            Self::Tool => "Tool",
            Self::Error => "Error",
            Self::BackgroundTask => "Background",
            Self::Usage => "Usage",
        }
    }
}

/// A message bubble shown in the central chat view.
#[derive(Clone, Debug)]
pub struct GuiMessage {
    pub id: u64,
    pub role: MessageRole,
    /// Plain-text content (markdown stripped for now; full rendering in future).
    pub content: String,
    /// Optional agent session id for swarm messages (shows who sent).
    pub agent_id: Option<String>,
    /// Human-readable agent name for swarm messages.
    pub agent_name: Option<String>,
    /// Serialised tool call summaries for assistant messages that invoke tools.
    pub tool_calls: Vec<String>,
    /// Tool call data for role=Tool messages.
    pub tool_data: Option<ToolCall>,
    pub duration_secs: Option<f32>,
}

impl GuiMessage {
    pub fn from_display(msg: &jcode_tui_messages::DisplayMessage) -> Self {
        let id = {
            use std::collections::hash_map::DefaultHasher;
            use std::hash::{Hash, Hasher};
            let mut h = DefaultHasher::new();
            msg.content.hash(&mut h);
            msg.role.hash(&mut h);
            h.finish()
        };
        Self {
            id,
            role: MessageRole::from_str(&msg.role),
            content: msg.content.clone(),
            agent_id: None,
            agent_name: None,
            tool_calls: msg.tool_calls.clone(),
            tool_data: msg.tool_data.clone(),
            duration_secs: msg.duration_secs,
        }
    }
}

// ── Swarm ─────────────────────────────────────────────────────────────────────

/// Live status of one agent member inside a swarm group.
#[derive(Clone, Debug)]
pub struct GuiSwarmMember {
    pub session_id: String,
    pub name: String,
    pub role: SwarmRole,
    pub status: SwarmLifecycleStatus,
    pub detail: Option<String>,
    pub is_coordinator: bool,
    pub status_age_secs: Option<u64>,
}

impl GuiSwarmMember {
    pub fn from_protocol(m: &SwarmMemberStatus) -> Self {
        let role = m
            .role
            .clone()
            .map(SwarmRole::from)
            .unwrap_or(SwarmRole::Agent);
        let lifecycle = SwarmLifecycleStatus::from(
            m.status.clone(),
        );
        let is_coordinator = matches!(role, SwarmRole::Coordinator);
        Self {
            session_id: m.session_id.clone(),
            name: m
                .friendly_name
                .clone()
                .unwrap_or_else(|| m.session_id.chars().take(8).collect()),
            role,
            status: lifecycle,
            detail: m.detail.clone(),
            is_coordinator,
            status_age_secs: m.status_age_secs,
        }
    }

    /// Status icon matching the TUI swarm_status_style convention.
    pub fn status_icon(&self) -> &'static str {
        match &self.status {
            SwarmLifecycleStatus::Spawned => "○",
            SwarmLifecycleStatus::Ready => "●",
            SwarmLifecycleStatus::Running | SwarmLifecycleStatus::RunningStale => "▶",
            SwarmLifecycleStatus::Blocked => "⏸",
            SwarmLifecycleStatus::Failed | SwarmLifecycleStatus::Crashed => "✗",
            SwarmLifecycleStatus::Completed | SwarmLifecycleStatus::Done => "✓",
            SwarmLifecycleStatus::Stopped => "■",
            _ => "·",
        }
    }

    /// Role prefix matching TUI swarm_role_prefix convention.
    pub fn role_prefix(&self) -> &'static str {
        match &self.role {
            SwarmRole::Coordinator => "★ ",
            SwarmRole::WorktreeManager => "◆ ",
            _ => "  ",
        }
    }
}

// ── Swarm plan (kanban) ───────────────────────────────────────────────────────

/// Status column in the kanban board.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KanbanColumn {
    Todo,
    Running,
    Done,
    Failed,
    Blocked,
}

impl KanbanColumn {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Todo => "To Do",
            Self::Running => "Running",
            Self::Done => "Done",
            Self::Failed => "Failed",
            Self::Blocked => "Blocked",
        }
    }
}

/// A single plan task card shown in the kanban board.
#[derive(Clone, Debug)]
pub struct PlanTaskCard {
    pub id: String,
    pub title: String,
    pub column: KanbanColumn,
    pub assigned_to: Option<String>,
}

impl PlanTaskCard {
    pub fn from_plan_item(item: &jcode_plan::PlanItem, active_ids: &[String]) -> Self {
        let column = if item.status == "done" || item.status == "completed" {
            KanbanColumn::Done
        } else if item.status == "failed" {
            KanbanColumn::Failed
        } else if item.status == "blocked" {
            KanbanColumn::Blocked
        } else if active_ids.contains(&item.id) {
            KanbanColumn::Running
        } else {
            KanbanColumn::Todo
        };
        Self {
            id: item.id.clone(),
            title: item.content.clone(),
            column,
            assigned_to: item.assigned_to.clone(),
        }
    }
}

// ── Processing status ─────────────────────────────────────────────────────────

/// Detailed processing state — mirrors `ProcessingStatus` in jcode-tui.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum ProcessingStatus {
    /// Idle — no active inference or tool execution.
    #[default]
    Idle,
    /// Waiting for the first token from the model.
    Thinking { elapsed_secs: f32 },
    /// Actively streaming tokens; carries running token counts.
    Streaming { input_tokens: u64, output_tokens: u64 },
    /// A named tool is executing (e.g. `read_file`, `bash`).
    RunningTool(String),
}

impl ProcessingStatus {
    /// Whether any kind of active processing is happening.
    pub fn is_active(&self) -> bool {
        !matches!(self, Self::Idle)
    }

    /// Short human-readable label for the status bar — mirrors TUI `format_status_for_debug`.
    pub fn label(&self) -> String {
        match self {
            Self::Idle => "Ready".to_string(),
            Self::Thinking { elapsed_secs } => format!("Thinking… ({:.1}s)", elapsed_secs),
            Self::Streaming { input_tokens, output_tokens } => {
                format!("Streaming (↑{} ↓{})", input_tokens, output_tokens)
            }
            Self::RunningTool(name) => format!("Running tool: {}", name),
        }
    }
}

// ── Overall GUI state ─────────────────────────────────────────────────────────

/// Top-level state owned by the GUI application.
#[derive(Default)]
pub struct GuiState {
    /// All sessions shown in the left panel.
    pub sessions: Vec<SessionEntry>,
    /// Currently selected session id.
    pub active_session_id: Option<String>,
    /// Messages in the currently active session.
    pub messages: Vec<GuiMessage>,
    /// Swarm members for the active swarm (empty if not a swarm session).
    pub swarm_members: Vec<GuiSwarmMember>,
    /// Plan tasks for the swarm kanban board.
    pub plan_tasks: Vec<PlanTaskCard>,
    /// Current text in the composer input.
    pub composer_draft: String,
    /// Current processing status (replaces the old `is_processing` + `current_tool` pair).
    pub processing_status: ProcessingStatus,
    /// Name of the model driving the active session (e.g. `"claude-opus-4-5"`).
    pub model_name: String,
    /// Cumulative token counts for the active session `(input, output)`.
    pub session_tokens: Option<(u64, u64)>,
    // ── Autocomplete suggestion state ─────────────────────────────────────────
    /// Active slash-command suggestions `(command_name, description)`.
    /// Non-empty only while the user is typing a `/` command.
    pub slash_suggestions: Vec<(String, String)>,
    /// Index of the highlighted entry in `slash_suggestions`.
    pub slash_selected: usize,
    /// Active `@`-file suggestions (file names relative to the working directory).
    /// Non-empty only while an `@` mention is being typed.
    pub file_suggestions: Vec<String>,
    /// Index of the highlighted entry in `file_suggestions`.
    pub file_selected: usize,
}

impl GuiState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Formatted header status string — model name and processing status.
    /// Mirrors the TUI header bar content.
    pub fn header_status(&self) -> String {
        let status = self.processing_status.label();
        if self.model_name.is_empty() {
            return status;
        }
        format!("{} · {}", self.model_name, status)
    }

    /// Formatted token usage string for optional display in the header.
    pub fn token_usage_label(&self) -> Option<String> {
        self.session_tokens.map(|(inp, out)| {
            let fmt = |n: u64| -> String {
                if n >= 1_000_000 {
                    format!("{:.1}M", n as f64 / 1_000_000.0)
                } else if n >= 1_000 {
                    format!("{:.1}k", n as f64 / 1_000.0)
                } else {
                    n.to_string()
                }
            };
            format!("↑{} ↓{}", fmt(inp), fmt(out))
        })
    }

    /// Return plan tasks for a given column.
    pub fn tasks_in_column(&self, col: &KanbanColumn) -> Vec<&PlanTaskCard> {
        self.plan_tasks.iter().filter(|t| &t.column == col).collect()
    }

    /// Return active swarm group members (coordinator first).
    pub fn sorted_members(&self) -> Vec<&GuiSwarmMember> {
        let mut members: Vec<&GuiSwarmMember> = self.swarm_members.iter().collect();
        members.sort_by(|a, b| b.is_coordinator.cmp(&a.is_coordinator));
        members
    }
}
