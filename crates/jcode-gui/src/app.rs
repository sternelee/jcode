//! Main application — Makepad `AppMain` implementation.
//!
//! Three-column layout mirroring the jcode TUI:
//!
//!  ┌──────────────────────────────────────────────────────────┐
//!  │  Header bar (session title + model + status)             │
//!  ├─────────────┬─────────────────────────┬──────────────────┤
//!  │ SessionList │   MessageList           │ AgentStatusPanel │
//!  │ (left 280)  │   (center, fill)        │ (right 240)      │
//!  │             ├─────────────────────────┤                  │
//!  │             │ ComposerWidget (bottom) │                  │
//!  └─────────────┴─────────────────────────┴──────────────────┘
//!
//! A secondary "Board" view (SwarmBoardPanel) can be toggled for swarm
//! sessions, replacing the message list to show the kanban task board.

use makepad_widgets::*;

use crate::agent_status::{AgentStatusAction, AgentStatusPanel};
use crate::composer::{ComposerAction, ComposerWidget};
use crate::gui_state::{GuiMessage, GuiState, KanbanColumn, PlanTaskCard, SessionEntry, SessionKind};
use crate::message_list::{MessageListPanel};
use crate::session_list::{SessionListAction, SessionListPanel};
use crate::swarm_board::{SwarmBoardPanel};

live_design! {
    use link::theme::*;
    use link::shaders::*;
    use makepad_widgets::base::*;

    // Import our custom widgets
    use crate::session_list::SessionListPanel;
    use crate::message_list::MessageListPanel;
    use crate::agent_status::AgentStatusPanel;
    use crate::composer::ComposerWidget;
    use crate::swarm_board::SwarmBoardPanel;

    // ── Header bar ────────────────────────────────────────────────────────────
    HeaderBar = <View> {
        width: Fill,
        height: 44.0,
        flow: Right,
        align: { y: 0.5 }
        padding: { left: 16.0, right: 16.0 }
        draw_bg: { color: #1a1a1e }

        title_label = <Label> {
            width: Fill,
            height: Fit,
            draw_text: {
                color: #dcdce6,
                text_style: { font_size: 14.0, font_weight: 700.0 }
            }
            text: "jcode"
        }

        model_label = <Label> {
            width: Fit,
            height: Fit,
            padding: { right: 16.0 }
            draw_text: {
                color: #8c8c9b,
                text_style: { font_size: 11.5 }
            }
            text: ""
        }

        status_label = <Label> {
            width: Fit,
            height: Fit,
            draw_text: {
                color: #78c88c,
                text_style: { font_size: 11.5 }
            }
            text: "Ready"
        }

        board_toggle_btn = <Button> {
            width: Fit,
            height: Fit,
            margin: { left: 12.0 }
            padding: { left: 10.0, right: 10.0, top: 4.0, bottom: 4.0 }
            draw_bg: {
                color: #26293700,
                border_radius: 6.0
            }
            draw_text: {
                color: #8ab4f8,
                text_style: { font_size: 11.5 }
            }
            text: "Plan"
        }
    }

    // ── Centre panel: chat + composer OR board ────────────────────────────────
    CentrePanel = <View> {
        width: Fill,
        height: Fill,
        flow: Down,

        // Chat view (default visible)
        chat_view = <View> {
            width: Fill,
            height: Fill,
            flow: Down,

            message_list = <MessageListPanel> {}
            composer = <ComposerWidget> {}
        }

        // Board view (toggled for swarm sessions)
        board_view = <View> {
            width: Fill,
            height: Fill,
            visible: false,

            swarm_board = <SwarmBoardPanel> {}
        }
    }

    // ── Root window layout ────────────────────────────────────────────────────
    App = {{App}} {
        ui: <Window> {
            window: {
                title: "jcode — AI Agent Platform",
                position: vec2(100.0, 100.0),
                inner_size: vec2(1280.0, 800.0),
                min_size: vec2(800.0, 500.0),
            }
            draw_bg: { color: #1a1a1e }
            flow: Down,

            header = <HeaderBar> {}

            body = <View> {
                width: Fill,
                height: Fill,
                flow: Right,

                // Left panel separator
                left_sep = <View> {
                    width: 1.0,
                    height: Fill,
                    draw_bg: { color: #2a2a32 }
                }

                session_list = <SessionListPanel> {}

                left_sep2 = <View> {
                    width: 1.0,
                    height: Fill,
                    draw_bg: { color: #2a2a32 }
                }

                centre = <CentrePanel> {}

                right_sep = <View> {
                    width: 1.0,
                    height: Fill,
                    draw_bg: { color: #2a2a32 }
                }

                agent_status = <AgentStatusPanel> {}
            }
        }
    }
}

// ── App ───────────────────────────────────────────────────────────────────────

#[derive(Live, LiveHook)]
pub struct App {
    #[live]
    ui: WidgetRef,
    #[rust]
    state: GuiState,
    #[rust]
    show_board: bool,
}

impl LiveRegister for App {
    fn live_register(cx: &mut Cx) {
        // Register Makepad built-in widgets
        makepad_widgets::live_design(cx);
        // Register our custom widgets
        crate::session_list::live_design(cx);
        crate::message_list::live_design(cx);
        crate::agent_status::live_design(cx);
        crate::composer::live_design(cx);
        crate::swarm_board::live_design(cx);
    }
}

impl AppMain for App {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event) {
        self.ui.handle_event(cx, event, &mut Scope::empty());
        self.handle_actions(cx);

        // Initial demo data on startup
        if let Event::Startup = event {
            self.populate_demo_state(cx);
        }
    }
}

impl App {
    fn handle_actions(&mut self, cx: &mut Cx) {
        let actions = cx.sweep_actions();

        for action in &actions {
            // Session list selection
            if let SessionListAction::Selected { session_id } = action.as_widget_action().cast() {
                self.activate_session(cx, &session_id);
            }
            if let SessionListAction::NewSession = action.as_widget_action().cast() {
                self.create_new_session(cx);
            }

            // Composer submit
            if let ComposerAction::Submit { text } = action.as_widget_action().cast() {
                self.handle_submit(cx, text);
            }

            // Board toggle button
            if self
                .ui
                .button(id!(header.board_toggle_btn))
                .clicked_in_actions(&actions)
            {
                self.toggle_board_view(cx);
            }
        }
    }

    fn activate_session(&mut self, cx: &mut Cx, session_id: &str) {
        self.state.active_session_id = Some(session_id.to_string());

        // Update session list highlight
        self.ui
            .widget(id!(body.session_list))
            .as_widget(live_id!(SessionListPanel))
            .borrow_mut()
            .unwrap()
            .set_selected(cx, Some(session_id.to_string()));

        // Clear message list for the new session
        self.ui
            .widget(id!(body.centre.chat_view.message_list))
            .as_widget(live_id!(MessageListPanel))
            .borrow_mut()
            .unwrap()
            .clear(cx);

        // Update header title
        if let Some(entry) = self.state.sessions.iter().find(|s| s.id == session_id) {
            let title = entry.title.clone();
            self.ui.label(id!(header.title_label)).set_text(cx, &title);

            // Show/hide board toggle for swarm sessions
            let is_swarm = matches!(entry.kind, SessionKind::SwarmGroup { .. });
            self.ui.button(id!(header.board_toggle_btn)).apply_over(
                cx,
                live! { visible: (is_swarm) },
            );
        }

        // Update composer draft (cleared for new sessions)
        self.ui
            .widget(id!(body.centre.chat_view.composer))
            .as_widget(live_id!(ComposerWidget))
            .borrow_mut()
            .unwrap()
            .set_draft(cx, "");
    }

    fn create_new_session(&mut self, _cx: &mut Cx) {
        // In a real implementation this would launch a new jcode session via IPC.
        // For now we log intent.
        log!("New session requested");
    }

    fn handle_submit(&mut self, cx: &mut Cx, text: String) {
        if text.trim().is_empty() {
            return;
        }

        // Push user message locally (optimistic)
        let user_msg = GuiMessage {
            id: rand_id(),
            role: crate::gui_state::MessageRole::User,
            content: text.clone(),
            agent_id: None,
            agent_name: None,
            tool_calls: vec![],
            tool_data: None,
            duration_secs: None,
        };

        self.ui
            .widget(id!(body.centre.chat_view.message_list))
            .as_widget(live_id!(MessageListPanel))
            .borrow_mut()
            .unwrap()
            .push_message(cx, user_msg);

        // In a real implementation: send `text` to the jcode server over IPC
        // and receive streaming responses back via an async channel.
        log!("Submit: {}", text);

        // Mark as processing
        self.ui
            .widget(id!(body.centre.chat_view.message_list))
            .as_widget(live_id!(MessageListPanel))
            .borrow_mut()
            .unwrap()
            .set_processing(cx, true, None);

        self.ui
            .label(id!(header.status_label))
            .set_text(cx, "Processing…");
    }

    fn toggle_board_view(&mut self, cx: &mut Cx) {
        self.show_board = !self.show_board;

        self.ui.view(id!(body.centre.chat_view)).apply_over(
            cx,
            live! { visible: (!self.show_board) },
        );
        self.ui.view(id!(body.centre.board_view)).apply_over(
            cx,
            live! { visible: (self.show_board) },
        );

        let btn_text = if self.show_board { "Chat" } else { "Plan" };
        self.ui
            .button(id!(header.board_toggle_btn))
            .set_text(cx, btn_text);
    }

    // ── Demo / placeholder data ───────────────────────────────────────────────

    fn populate_demo_state(&mut self, cx: &mut Cx) {
        use crate::gui_state::*;

        // Seed sessions
        self.state.sessions = vec![
            SessionEntry {
                id: "session-1".into(),
                title: "Code review".into(),
                preview: "Reviewing authentication module…".into(),
                kind: SessionKind::Single,
                is_active: false,
                unread: 0,
            },
            SessionEntry {
                id: "swarm-alpha".into(),
                title: "Swarm: refactor-api".into(),
                preview: "Coordinator assigned 4 sub-agents".into(),
                kind: SessionKind::SwarmGroup {
                    swarm_id: "swarm-alpha".into(),
                },
                is_active: false,
                unread: 3,
            },
            SessionEntry {
                id: "session-2".into(),
                title: "Debug memory leak".into(),
                preview: "Running valgrind on target…".into(),
                kind: SessionKind::Single,
                is_active: false,
                unread: 1,
            },
        ];

        // Seed swarm members (shown when swarm-alpha is selected)
        self.state.swarm_members = vec![
            GuiSwarmMember {
                session_id: "coord-1".into(),
                name: "Coordinator".into(),
                role: jcode_swarm_core::SwarmRole::Coordinator,
                status: jcode_swarm_core::SwarmLifecycleStatus::Running,
                detail: Some("Dispatching tasks".into()),
                is_coordinator: true,
                status_age_secs: Some(12),
            },
            GuiSwarmMember {
                session_id: "agent-1".into(),
                name: "Agent A".into(),
                role: jcode_swarm_core::SwarmRole::Agent,
                status: jcode_swarm_core::SwarmLifecycleStatus::Running,
                detail: Some("Refactoring auth.rs".into()),
                is_coordinator: false,
                status_age_secs: Some(5),
            },
            GuiSwarmMember {
                session_id: "agent-2".into(),
                name: "Agent B".into(),
                role: jcode_swarm_core::SwarmRole::Agent,
                status: jcode_swarm_core::SwarmLifecycleStatus::Ready,
                detail: None,
                is_coordinator: false,
                status_age_secs: None,
            },
            GuiSwarmMember {
                session_id: "wt-mgr-1".into(),
                name: "WorktreeMgr".into(),
                role: jcode_swarm_core::SwarmRole::WorktreeManager,
                status: jcode_swarm_core::SwarmLifecycleStatus::Completed,
                detail: None,
                is_coordinator: false,
                status_age_secs: Some(120),
            },
        ];

        // Seed plan tasks
        self.state.plan_tasks = vec![
            PlanTaskCard {
                id: "task-1".into(),
                title: "Extract AuthService interface".into(),
                column: KanbanColumn::Done,
                assigned_to: Some("Agent A".into()),
            },
            PlanTaskCard {
                id: "task-2".into(),
                title: "Refactor token validation".into(),
                column: KanbanColumn::Running,
                assigned_to: Some("Agent A".into()),
            },
            PlanTaskCard {
                id: "task-3".into(),
                title: "Update integration tests".into(),
                column: KanbanColumn::Todo,
                assigned_to: None,
            },
            PlanTaskCard {
                id: "task-4".into(),
                title: "Add rate-limiting middleware".into(),
                column: KanbanColumn::Todo,
                assigned_to: None,
            },
            PlanTaskCard {
                id: "task-5".into(),
                title: "CI pipeline green check".into(),
                column: KanbanColumn::Blocked,
                assigned_to: None,
            },
        ];

        // Push session entries into list widget
        if let Some(mut panel) = self
            .ui
            .widget(id!(body.session_list))
            .as_widget(live_id!(SessionListPanel))
            .borrow_mut()
        {
            panel.set_entries(cx, self.state.sessions.clone());
        }

        // Push swarm members into status panel
        if let Some(mut panel) = self
            .ui
            .widget(id!(body.agent_status))
            .as_widget(live_id!(AgentStatusPanel))
            .borrow_mut()
        {
            panel.set_members(cx, self.state.swarm_members.clone());
            panel.set_session_info(
                cx,
                Some("swarm-alpha".into()),
                Some("claude-opus-4".into()),
            );
        }

        // Push plan tasks into board
        if let Some(mut board) = self
            .ui
            .widget(id!(body.centre.board_view.swarm_board))
            .as_widget(live_id!(SwarmBoardPanel))
            .borrow_mut()
        {
            board.update_plan(cx, Some("swarm-alpha".into()), self.state.plan_tasks.clone());
        }

        // Welcome message
        let welcome = GuiMessage {
            id: 0,
            role: crate::gui_state::MessageRole::System,
            content: "Welcome to jcode GUI — select a session from the left panel to begin."
                .into(),
            agent_id: None,
            agent_name: None,
            tool_calls: vec![],
            tool_data: None,
            duration_secs: None,
        };
        if let Some(mut msg_panel) = self
            .ui
            .widget(id!(body.centre.chat_view.message_list))
            .as_widget(live_id!(MessageListPanel))
            .borrow_mut()
        {
            msg_panel.push_message(cx, welcome);
        }
    }
}

// ── Simple pseudo-random id generator ────────────────────────────────────────

fn rand_id() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

app_main!(App);
