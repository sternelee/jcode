//! Shared GUI state types for jcode-gui.
//!
//! These mirror the data models used by jcode-tui (DisplayMessage,
//! SwarmMemberStatus, etc.) but are decoupled from ratatui so they can
//! be used with Makepad.
//!
//! The [`GuiState`] struct is the single source of truth for the widget
//! tree. It is mutated by [`GuiState::apply_event`] whenever a
//! `ServerEvent` arrives from the in-process server, and read by each
//! widget's `draw_walk`.

use jcode_message_types::ToolCall;
use jcode_protocol::{ServerEvent, SwarmMemberStatus};
pub use jcode_swarm_core::{SwarmLifecycleStatus, SwarmRole};
use std::collections::HashMap;

/// Global GUI state — read by widget draw_walk, written by the
/// `ServerEvent` event pump. Wrapped in `LazyLock` so the initial
/// values can use non-`const` constructors (e.g. `HashMap::new()`).
pub static GUI_STATE: std::sync::LazyLock<std::sync::RwLock<GuiState>> =
    std::sync::LazyLock::new(|| {
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
            // ── live-event fields ───────────────────────────────
            streaming_text: String::new(),
            streaming_tool_calls: Vec::new(),
            is_streaming: false,
            provider_model: String::new(),
            provider_name: String::new(),
            mcp_servers: Vec::new(),
            skills: Vec::new(),
            all_sessions: Vec::new(),
            session_titles: HashMap::new(),
            // ── UI-local state (not from server events) ─────────
            sidebar_collapsed: false,
            welcome_suggestions: default_welcome_suggestions(),
            hovered_message_id: None,
            // ── UI-local state (mutated by `App`) ─────────
            settings_open: false,
            model_picker_open: false,
            current_provider: String::new(),
            available_model_list: Vec::new(),
            // ── internal counters (private) ──────────────────────
            next_msg_id: 0,
        })
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
    Memory,
    Overnight,
    Swarm,
}

impl MessageRole {
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(role: &str) -> Self {
        match role {
            "user" => Self::User,
            "assistant" => Self::Assistant,
            "system" => Self::System,
            "tool" => Self::Tool,
            "error" => Self::Error,
            "background_task" => Self::BackgroundTask,
            "usage" => Self::Usage,
            "memory" => Self::Memory,
            "overnight" => Self::Overnight,
            "swarm" => Self::Swarm,
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
            Self::Memory => "Memory",
            Self::Overnight => "Overnight",
            Self::Swarm => "Swarm",
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
    // ── Live streaming state (mutated by `apply_event`) ─────────────────
    /// Text currently streaming into the in-progress assistant bubble.
    /// The message list widget renders this into the placeholder
    /// bubble at the end of the list.
    pub streaming_text: String,
    /// Tool names that have fired during the current turn; shown in
    /// the assistant tool-call summary line.
    pub streaming_tool_calls: Vec<String>,
    /// True while a model turn is in progress (set on the first
    /// `TextDelta` or `ToolStart`, cleared on `Done` / `Error` /
    /// `Interrupted` / `MessageEnd`).
    pub is_streaming: bool,
    // ── Provider / model / MCP / skills metadata from `ServerEvent::History` ──
    /// Provider model id (e.g. `"claude-opus-4-5"`).
    pub provider_model: String,
    /// Provider name (e.g. `"anthropic"`, `"openai"`).
    pub provider_name: String,
    /// Connected MCP server names.
    pub mcp_servers: Vec<String>,
    /// Available skill names.
    pub skills: Vec<String>,
    // ── Session discovery (from `ServerEvent::History::all_sessions` and `SessionId` / `SessionRenamed`) ──
    /// All session ids known to the server, used to populate the
    /// session picker / left panel.
    pub all_sessions: Vec<String>,
    /// Per-session display titles; populated from `SessionRenamed` /
    /// `SessionId` / `History` events.
    pub session_titles: HashMap<String, String>,
    // ── UI-local state (mutated by `App`, not by `apply_event`) ─────
    /// Whether the left sidebar is collapsed to the icon rail.
    /// GUI-only; the server has no opinion on the layout.
    pub sidebar_collapsed: bool,
    /// Default suggestion prompts shown in the welcome / empty
    /// state. A follow-up pass can fetch these from a server
    /// route; for now they are hardcoded in
    /// `default_welcome_suggestions()`.
    pub welcome_suggestions: Vec<String>,
    /// Id of the assistant message currently under the cursor;
    /// when `Some(_)`, the message list widget renders its hover
    /// action row. `None` when no row is hovered.
    pub hovered_message_id: Option<u64>,
    // ── Settings + model-picker state (mutated by `App`) ─────────
    /// Whether the Settings modal overlay is visible.
    pub settings_open: bool,
    /// Whether the model picker popover is visible.
    pub model_picker_open: bool,
    /// Short name of the active provider (`"claude"`, `"openai"`,
    /// `"ollama"`, ...). Updated from
    /// `ServerEvent::ProviderChanged::provider` and
    /// `ServerEvent::History::provider_name`.
    pub current_provider: String,
    /// Catalogue of model ids the active provider reports.
    /// Updated from `ServerEvent::ProviderChanged::available_models`.
    /// Empty when the provider hasn't reported yet (callers should
    /// trigger `Request::AvailableModels` on startup to populate).
    pub available_model_list: Vec<String>,
    // ── Internal counter (used by `apply_event` for new bubbles) ─────────
    /// Monotonic id minted for every new `GuiMessage` we push. We
    /// keep it as a regular field (not private) so `apply_event`
    /// can bump it directly; it is not part of the user-visible
    /// state.
    pub next_msg_id: u64,
}

/// Default welcome suggestions shown when no messages exist.
/// A follow-up pass can replace this with a server-driven list
/// (e.g. fetched on first `History` event).
fn default_welcome_suggestions() -> Vec<String> {
    vec![
        "Refactor the auth module to use a single session-token table".to_string(),
        "Add unit tests for the swarm coordinator lifecycle".to_string(),
        "Investigate the last 10 CI flakes and propose fixes".to_string(),
    ]
}

impl GuiState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mutate `self` to reflect a single `ServerEvent` from the
    /// in-process server. The widget tree reads back from `self` on
    /// the next frame.
    ///
    /// This is the single bridge between the server's wire protocol
    /// and the widget data model. Keep it side-effect free except for
    /// `self` — no logging, no I/O.
    pub fn apply_event(&mut self, ev: &ServerEvent) {
        match ev {
            // ── Streaming ──────────────────────────────────────────────
            ServerEvent::TextDelta { text } => {
                if !self.is_streaming {
                    // First delta of a new turn: reset the streaming
                    // accumulator.
                    self.streaming_text.clear();
                    self.streaming_tool_calls.clear();
                    self.is_streaming = true;
                }
                self.streaming_text.push_str(text);
                // Switch to Streaming with the latest token totals;
                // we don't know them precisely, so carry 0s and let
                // `TokenUsage` refine them as it arrives.
                self.processing_status = ProcessingStatus::Streaming {
                    input_tokens: 0,
                    output_tokens: 0,
                };
            }
            ServerEvent::TextReplace { text } => {
                // Recovery path: streaming produced garbled text and
                // the server is replacing it with a clean prefix.
                self.streaming_text.clear();
                self.streaming_text.push_str(text);
            }
            ServerEvent::ToolStart { name, .. } | ServerEvent::ToolExec { name, .. } => {
                self.streaming_tool_calls.push(name.clone());
                self.processing_status = ProcessingStatus::RunningTool(name.clone());
            }
            ServerEvent::ToolDone { name, error, .. } => {
                if let Some(err) = error {
                    // Surface the failure as an Error role bubble.
                    let new_msg_id = self.next_msg_id();
                    self.messages.push(GuiMessage {
                        id: new_msg_id,
                        role: MessageRole::Error,
                        content: format!("{} failed: {}", name, err),
                        agent_id: None,
                        agent_name: None,
                        tool_calls: vec![],
                        tool_data: None,
                        duration_secs: None,
                    });
                } else {
                    let new_msg_id = self.next_msg_id();
                    self.messages.push(GuiMessage {
                        id: new_msg_id,
                        role: MessageRole::Tool,
                        content: format!("{} ✓", name),
                        agent_id: None,
                        agent_name: None,
                        tool_calls: vec![],
                        tool_data: None,
                        duration_secs: None,
                    });
                }
            }
            ServerEvent::MessageEnd => {
                // Provider has emitted the visible assistant text;
                // the turn may still be finalising bookkeeping.
                // Keep `is_streaming` true until `Done` / `Error` /
                // `Interrupted` arrives.
            }
            ServerEvent::Done { .. } => {
                self.seal_streaming_turn();
            }
            ServerEvent::ProviderChanged {
                provider,
                model,
                available_models,
                error,
                ..
            } => {
                if error.is_none() {
                    self.current_provider = provider.clone();
                    self.provider_name = provider.clone();
                    self.provider_model = model.clone();
                    self.model_name = model.clone();
                    self.available_model_list = available_models.clone();
                } else {
                    // Switch failed — surface the error in the
                    // header status via the next event drain.
                    let new_id = self.next_msg_id();
                    self.messages.push(GuiMessage {
                        id: new_id,
                        role: MessageRole::Error,
                        content: format!(
                            "Could not switch to provider '{}': {}",
                            provider,
                            error.as_deref().unwrap_or("(unknown error)")
                        ),
                        agent_id: None,
                        agent_name: None,
                        tool_calls: vec![],
                        tool_data: None,
                        duration_secs: None,
                    });
                }
            }
            ServerEvent::Error { message, .. } => {
                let new_msg_id = self.next_msg_id();
                self.messages.push(GuiMessage {
                    id: new_msg_id,
                    role: MessageRole::Error,
                    content: message.clone(),
                    agent_id: None,
                    agent_name: None,
                    tool_calls: vec![],
                    tool_data: None,
                    duration_secs: None,
                });
                self.seal_streaming_turn();
            }
            ServerEvent::Interrupted => {
                let new_msg_id = self.next_msg_id();
                self.messages.push(GuiMessage {
                    id: new_msg_id,
                    role: MessageRole::System,
                    content: "Interrupted".to_string(),
                    agent_id: None,
                    agent_name: None,
                    tool_calls: vec![],
                    tool_data: None,
                    duration_secs: None,
                });
                self.seal_streaming_turn();
            }

            // ── Token usage / model / status ──────────────────────────
            ServerEvent::TokenUsage { input, output, .. } => {
                self.session_tokens = Some((*input, *output));
                self.processing_status = ProcessingStatus::Streaming {
                    input_tokens: *input,
                    output_tokens: *output,
                };
            }
            ServerEvent::ConnectionType { connection } => {
                self.provider_name = connection.clone();
            }
            ServerEvent::UpstreamProvider { provider } => {
                self.provider_name = provider.clone();
            }
            ServerEvent::StatusDetail { .. } | ServerEvent::ConnectionPhase { .. } => {
                // Treated as transient; header already shows the
                // current processing status.
            }

            // ── Swarm ─────────────────────────────────────────────────
            ServerEvent::SwarmStatus { members } => {
                self.swarm_members = members.iter().map(GuiSwarmMember::from_protocol).collect();
            }
            ServerEvent::SwarmPlan { items, summary, .. } => {
                let active_ids: Vec<String> = summary
                    .as_ref()
                    .map(|s| s.active_ids.clone())
                    .unwrap_or_default();
                self.plan_tasks = items
                    .iter()
                    .map(|i| PlanTaskCard::from_plan_item(i, &active_ids))
                    .collect();
            }
            ServerEvent::SwarmPlanProposal { .. } => {
                // A new plan was proposed to a coordinator. We don't
                // surface it as a chat bubble in this pass; the
                // kanban board will refresh on the subsequent
                // SwarmPlan event.
            }

            // ── Session metadata ──────────────────────────────────────
            ServerEvent::SessionId { session_id } => {
                self.active_session_id = Some(session_id.clone());
                if !self.all_sessions.contains(session_id) {
                    self.all_sessions.push(session_id.clone());
                }
            }
            ServerEvent::SessionRenamed {
                session_id,
                display_title,
                ..
            } => {
                self.session_titles
                    .insert(session_id.clone(), display_title.clone());
                self.rebuild_session_entries();
            }
            ServerEvent::SessionCloseRequested { reason } => {
                let new_msg_id = self.next_msg_id();
                self.messages.push(GuiMessage {
                    id: new_msg_id,
                    role: MessageRole::System,
                    content: format!("Server requested close: {}", reason),
                    agent_id: None,
                    agent_name: None,
                    tool_calls: vec![],
                    tool_data: None,
                    duration_secs: None,
                });
            }

            // ── Conversation history (full sync) ──────────────────────
            ServerEvent::History {
                session_id,
                messages,
                provider_name,
                provider_model,
                available_models: history_models,
                mcp_servers,
                skills,
                all_sessions,
                total_tokens,
                ..
            } => {
                self.active_session_id = Some(session_id.clone());
                self.messages = messages
                    .iter()
                    .enumerate()
                    .map(|(idx, m)| GuiMessage {
                        id: idx as u64,
                        role: MessageRole::from_str(&m.role),
                        content: m.content.clone(),
                        agent_id: None,
                        agent_name: None,
                        tool_calls: m.tool_calls.clone().unwrap_or_default(),
                        tool_data: m.tool_data.clone(),
                        duration_secs: None,
                    })
                    .collect();
                self.next_msg_id = self.messages.len() as u64;
                if let Some(p) = provider_name {
                    self.provider_name = p.clone();
                    // The `History` event's `provider_name` is the
                    // short id we use everywhere (matches what
                    // `ProviderChanged::provider` carries). The
                    // server already lowers it before sending.
                    if self.current_provider.is_empty() {
                        self.current_provider = p.clone();
                    }
                }
                if let Some(m) = provider_model {
                    self.provider_model = m.clone();
                    self.model_name = m.clone();
                }
                self.mcp_servers = mcp_servers.clone();
                self.skills = skills.clone();
                if let Some(t) = total_tokens {
                    self.session_tokens = Some(*t);
                }
                if !all_sessions.is_empty() {
                    self.all_sessions = all_sessions.clone();
                }
                if !history_models.is_empty() {
                    self.available_model_list = history_models.clone();
                }
                // Rebuild the `sessions` left-panel from the
                // discovered ids, merging in any titles we already
                // know.
                self.rebuild_session_entries();
            }

            // ── Compaction / memory / side panels ─────────────────────
            ServerEvent::Compaction { .. }
            | ServerEvent::MemoryInjected { .. }
            | ServerEvent::MemoryActivity { .. }
            | ServerEvent::SidePaneImages { .. }
            | ServerEvent::GeneratedImage { .. }
            | ServerEvent::BatchProgress { .. }
            | ServerEvent::KvCacheRequest { .. } => {
                // Not surfaced in the GUI first pass.
            }

            // ── MCP / one-shot control ────────────────────────────────
            ServerEvent::McpStatus { servers } => {
                self.mcp_servers = servers.clone();
            }
            ServerEvent::SoftInterruptInjected { content, .. } => {
                let new_msg_id = self.next_msg_id();
                self.messages.push(GuiMessage {
                    id: new_msg_id,
                    role: MessageRole::System,
                    content: format!("[soft interrupt] {}", content),
                    agent_id: None,
                    agent_name: None,
                    tool_calls: vec![],
                    tool_data: None,
                    duration_secs: None,
                });
            }

            // ── Trivial keepalives ─────────────────────────────────────
            ServerEvent::Ack { .. }
            | ServerEvent::Pong { .. }
            | ServerEvent::State { .. }
            | ServerEvent::DebugResponse { .. }
            | ServerEvent::ClientDebugRequest { .. } => {}

            // Anything we haven't explicitly named above is ignored
            // deliberately — the GUI surfaces only the categories
            // its widgets render.
            _ => {}
        }
    }

    /// End-of-turn: push whatever was in `streaming_text` as a final
    /// assistant bubble, then reset the streaming accumulators.
    fn seal_streaming_turn(&mut self) {
        if self.is_streaming && !self.streaming_text.is_empty() {
            let tool_calls = std::mem::take(&mut self.streaming_tool_calls);
            let text = std::mem::take(&mut self.streaming_text);
            let id = self.next_msg_id();
            self.messages.push(GuiMessage {
                id,
                role: MessageRole::Assistant,
                content: text,
                agent_id: None,
                agent_name: None,
                tool_calls,
                tool_data: None,
                duration_secs: None,
            });
        } else {
            self.streaming_text.clear();
            self.streaming_tool_calls.clear();
        }
        self.is_streaming = false;
        self.processing_status = ProcessingStatus::Idle;
    }

    /// Re-derive the left-panel `sessions` vector from
    /// `all_sessions` + `session_titles`. Preserves the `is_active`
    /// flag for the currently selected session.
    fn rebuild_session_entries(&mut self) {
        let active = self.active_session_id.clone();
        self.sessions = self
            .all_sessions
            .iter()
            .map(|id| SessionEntry {
                id: id.clone(),
                title: self
                    .session_titles
                    .get(id)
                    .cloned()
                    .unwrap_or_else(|| id.chars().take(8).collect()),
                preview: String::new(),
                kind: SessionKind::Single,
                is_active: Some(id) == active.as_ref(),
                unread: 0,
            })
            .collect();
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

    /// Mint the next monotonic message id and return it. Pulled out as
    /// a small helper so every push site in `apply_event` does it the
    /// same way.
    fn next_msg_id(&mut self) -> u64 {
        let id = self.next_msg_id;
        self.next_msg_id = self.next_msg_id.wrapping_add(1);
        id
    }
}
