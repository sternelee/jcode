//! Shared GUI state types for jcode-gui.
//!
//! These mirror the data models used by jcode-tui (DisplayMessage, SwarmMemberStatus, etc.)
//! but are decoupled from ratatui so they can be used with Makepad.

use jcode_message_types::ToolCall;
use jcode_protocol::SwarmMemberStatus;
use jcode_swarm_core::{SwarmLifecycleStatus, SwarmRole};

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
        let status = m
            .status
            .clone()
            .parse::<String>()
            .map(SwarmRole::from)
            .ok();
        let _ = status; // unused — we parse SwarmLifecycleStatus from the string directly
        let lifecycle = SwarmLifecycleStatus::from(m.status.clone());
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
        let column = if item.done {
            KanbanColumn::Done
        } else if active_ids.contains(&item.id) {
            KanbanColumn::Running
        } else {
            KanbanColumn::Todo
        };
        Self {
            id: item.id.clone(),
            title: item.title.clone(),
            column,
            assigned_to: None,
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
    /// Whether the session is currently processing (agent is thinking).
    pub is_processing: bool,
    /// Current tool being used (if any).
    pub current_tool: Option<String>,
}

impl GuiState {
    pub fn new() -> Self {
        Self::default()
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
