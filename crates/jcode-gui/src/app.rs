//! Main application — Makepad `AppMain` implementation using the new `script_mod!` API.
//!
//! Three-column layout mirroring the jcode TUI:
//!
//!  ┌──────────────────────────────────────────────────────────┐
//!  │  Header bar (session title + model + status)             │
//!  ├─────────────┬─────────────────────────┬──────────────────┤
//!  │ SessionList │   MessageList           │ AgentStatusPanel │
//!  │ (left 280)  │   (center, fill)        │ (right 240)      │
//!  │             ├─────────────────────────┤                  │
//!  │             │ Composer (bottom)       │                  │
//!  └─────────────┴─────────────────────────┴──────────────────┘

use makepad_widgets::*;

use crate::agent_status::AgentStatusWidget;
use crate::composer::ComposerMode;
use crate::gui_state::{
    GuiMessage, GuiSwarmMember, MessageRole, SessionEntry, SessionKind, GUI_STATE,
};
use crate::message_list::MessageListWidget;
use crate::session_list::SessionListWidget;

app_main!(App);

script_mod! {
    use mod.prelude.widgets.*

    // ── Custom widget registrations ───────────────────────────────────────────
    let SessionListWidget = #(SessionListWidget::register_widget(vm)) {
        width: Fill
        height: Fill

        session_list := PortalList {
            width: Fill
            height: Fill
            flow: Down
            drag_scrolling: false

            SessionRow := RoundedView {
                width: Fill
                height: Fit
                padding: Inset{top: 8 bottom: 8 left: 12 right: 8}
                show_bg: true
                draw_bg +: { color: #202026 radius: 0.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down

                    View {
                        width: Fill
                        height: Fit
                        flow: Right
                        align: Align{y: 0.5}
                        spacing: 4

                        title_label := Label {
                            width: Fill
                            height: Fit
                            draw_text +: {
                                color: #dcdce6
                                text_style +: { font_size: 13 }
                            }
                        }

                        badge_view := View {
                            width: Fit
                            height: Fit
                            visible: false
                            badge_label := Label {
                                width: Fit
                                height: Fit
                                draw_text +: {
                                    color: #8ab4f8
                                    text_style +: { font_size: 10 }
                                }
                            }
                        }
                    }

                    preview_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #8c8c9b
                            text_style +: { font_size: 11 }
                        }
                    }
                }
            }

            SwarmRow := RoundedView {
                width: Fill
                height: Fit
                padding: Inset{top: 8 bottom: 8 left: 12 right: 8}
                show_bg: true
                draw_bg +: { color: #262a37 radius: 0.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down

                    View {
                        width: Fill
                        height: Fit
                        flow: Right
                        align: Align{y: 0.5}
                        spacing: 4

                        title_label := Label {
                            width: Fill
                            height: Fit
                            draw_text +: {
                                color: #8ab4f8
                                text_style +: { font_size: 13 }
                            }
                        }

                        badge_view := View {
                            width: Fit
                            height: Fit
                            visible: false
                            badge_label := Label {
                                width: Fit
                                height: Fit
                                draw_text +: {
                                    color: #ffc864
                                    text_style +: { font_size: 10 }
                                }
                            }
                        }
                    }

                    preview_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #8c8c9b
                            text_style +: { font_size: 11 }
                        }
                    }
                }
            }
        }
    }

    let MessageListWidget = #(MessageListWidget::register_widget(vm)) {
        width: Fill
        height: Fill

        msg_list := PortalList {
            width: Fill
            height: Fill
            flow: Down
            drag_scrolling: false
            auto_tail: true
            smooth_tail: true

            UserMsg := RoundedView {
                width: Fill
                height: Fit
                margin: Inset{top: 4 bottom: 4 left: 60 right: 8}
                padding: Inset{left: 12 top: 8 right: 12 bottom: 8}
                show_bg: true
                draw_bg +: { color: #1c3a58 radius: 8.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down
                    spacing: 4

                    sender_label := Label {
                        width: Fit
                        height: Fit
                        draw_text +: {
                            color: #64c8dc
                            text_style +: { font_size: 10 bold: true }
                        }
                    }

                    content_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #dcdce6
                            text_style +: { font_size: 13 }
                        }
                        wrap: Word
                    }

                    duration_view := View {
                        width: Fit
                        height: Fit
                        visible: false
                        duration_label := Label {
                            width: Fit
                            height: Fit
                            draw_text +: {
                                color: #8c8c9b
                                text_style +: { font_size: 9 }
                            }
                        }
                    }
                }
            }

            AssistantMsg := RoundedView {
                width: Fill
                height: Fit
                margin: Inset{top: 4 bottom: 4 left: 8 right: 60}
                padding: Inset{left: 12 top: 8 right: 12 bottom: 8}
                show_bg: true
                draw_bg +: { color: #262a37 radius: 8.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down
                    spacing: 4

                    sender_label := Label {
                        width: Fit
                        height: Fit
                        draw_text +: {
                            color: #8ab4f8
                            text_style +: { font_size: 10 bold: true }
                        }
                    }

                    content_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #d2d2dc
                            text_style +: { font_size: 13 }
                        }
                        wrap: Word
                    }

                    duration_view := View {
                        width: Fit
                        height: Fit
                        visible: false
                        duration_label := Label {
                            width: Fit
                            height: Fit
                            draw_text +: {
                                color: #8c8c9b
                                text_style +: { font_size: 9 }
                            }
                        }
                    }
                }
            }

            ToolMsg := RoundedView {
                width: Fill
                height: Fit
                margin: Inset{top: 2 bottom: 2 left: 8 right: 8}
                padding: Inset{left: 12 top: 6 right: 12 bottom: 6}
                show_bg: true
                draw_bg +: { color: #232d23 radius: 4.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down

                    sender_label := Label {
                        width: Fit
                        height: Fit
                        draw_text +: {
                            color: #78c88c
                            text_style +: { font_size: 10 bold: true }
                        }
                    }

                    content_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #a0c8a0
                            text_style +: { font_size: 12 }
                        }
                        wrap: Word
                    }

                    duration_view := View {
                        width: Fit
                        height: Fit
                        visible: false
                        duration_label := Label { width: Fit height: Fit }
                    }
                }
            }

            SystemMsg := RoundedView {
                width: Fill
                height: Fit
                margin: Inset{top: 2 bottom: 2 left: 8 right: 8}
                padding: Inset{left: 12 top: 6 right: 12 bottom: 6}
                show_bg: true
                draw_bg +: { color: #372d19 radius: 4.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down

                    sender_label := Label {
                        width: Fit
                        height: Fit
                        draw_text +: {
                            color: #c8af50
                            text_style +: { font_size: 10 bold: true }
                        }
                    }

                    content_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #c8b878
                            text_style +: { font_size: 12 }
                        }
                        wrap: Word
                    }

                    duration_view := View {
                        width: Fit
                        height: Fit
                        visible: false
                        duration_label := Label { width: Fit height: Fit }
                    }
                }
            }

            ErrorMsg := RoundedView {
                width: Fill
                height: Fit
                margin: Inset{top: 2 bottom: 2 left: 8 right: 8}
                padding: Inset{left: 12 top: 6 right: 12 bottom: 6}
                show_bg: true
                draw_bg +: { color: #461919 radius: 4.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down

                    sender_label := Label {
                        width: Fit
                        height: Fit
                        draw_text +: {
                            color: #ff6464
                            text_style +: { font_size: 10 bold: true }
                        }
                    }

                    content_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #ff9090
                            text_style +: { font_size: 12 }
                        }
                        wrap: Word
                    }

                    duration_view := View {
                        width: Fit
                        height: Fit
                        visible: false
                        duration_label := Label { width: Fit height: Fit }
                    }
                }
            }
        }
    }

    let AgentStatusWidget = #(AgentStatusWidget::register_widget(vm)) {
        width: 240
        height: Fill

        agent_list := PortalList {
            width: Fill
            height: Fill
            flow: Down
            drag_scrolling: false

            StatsRow := View {
                width: Fill
                height: Fit
                padding: Inset{top: 8 bottom: 8 left: 12 right: 8}

                stats_label := Label {
                    width: Fill
                    height: Fit
                    draw_text +: {
                        color: #8ab4f8
                        text_style +: { font_size: 11 bold: true }
                    }
                }
            }

            CoordinatorCard := RoundedView {
                width: Fill
                height: Fit
                padding: Inset{top: 8 bottom: 8 left: 12 right: 8}
                margin: Inset{top: 2 bottom: 2 left: 4 right: 4}
                show_bg: true
                draw_bg +: { color: #262a37 radius: 6.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down
                    spacing: 2

                    member_name_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #ffc864
                            text_style +: { font_size: 12 bold: true }
                        }
                    }

                    member_detail_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #8c8c9b
                            text_style +: { font_size: 10 }
                        }
                        wrap: Word
                    }
                }
            }

            MemberCard := RoundedView {
                width: Fill
                height: Fit
                padding: Inset{top: 6 bottom: 6 left: 12 right: 8}
                margin: Inset{top: 2 bottom: 2 left: 4 right: 4}
                show_bg: true
                draw_bg +: { color: #202026 radius: 4.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down
                    spacing: 2

                    member_name_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #dcdce6
                            text_style +: { font_size: 12 }
                        }
                    }

                    member_detail_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #8c8c9b
                            text_style +: { font_size: 10 }
                        }
                        wrap: Word
                    }
                }
            }
        }
    }

    // ── Main app layout ───────────────────────────────────────────────────────
    startup() do #(App::script_component(vm)) {
        ui: Root {
            on_startup: || {
                ui.main_view.render()
            }

            main_window := Window {
                window.inner_size: vec2(1200, 800)
                window.title: "jcode — Agent Chat"
                body +: {
                    flow: Down

                    // ── Header bar ────────────────────────────────────────
                    View {
                        width: Fill
                        height: 44
                        flow: Right
                        align: Align{y: 0.5}
                        padding: Inset{left: 16 right: 16}
                        show_bg: true
                        draw_bg +: { color: #1a1a1e }

                        session_title_label := Label {
                            width: Fill
                            height: Fit
                            text: "jcode"
                            draw_text +: {
                                color: #dcdce6
                                text_style +: { font_size: 16 bold: true }
                            }
                        }

                        status_label := Label {
                            width: Fit
                            height: Fit
                            text: "Ready"
                            draw_text +: {
                                color: #8c8c9b
                                text_style +: { font_size: 11 }
                            }
                        }
                    }

                    // ── Three-column body ─────────────────────────────────
                    main_view := View {
                        width: Fill
                        height: Fill
                        flow: Right
                        on_render: || {
                            // Re-render triggered when state changes
                        }

                        // Left: session list
                        View {
                            width: 280
                            height: Fill
                            flow: Down
                            show_bg: true
                            draw_bg +: { color: #202026 }

                            View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 8}

                                Label {
                                    text: "Sessions"
                                    draw_text +: {
                                        color: #8c8c9b
                                        text_style +: { font_size: 11 bold: true }
                                    }
                                }
                            }

                            session_list := SessionListWidget {}
                        }

                        // Center: messages + composer
                        View {
                            width: Fill
                            height: Fill
                            flow: Down
                            show_bg: true
                            draw_bg +: { color: #141418 }

                            message_list := MessageListWidget {}

                            // Composer row
                            View {
                                width: Fill
                                height: Fit
                                flow: Right
                                spacing: 8
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 12}
                                align: Align{y: 1.0}
                                show_bg: true
                                draw_bg +: { color: #1e1e24 }

                                composer_input := TextInput {
                                    width: Fill
                                    height: Fit
                                    empty_text: "Message… (Enter to send)"
                                    draw_bg +: { color: #2a2a30 }
                                }

                                send_button := Button {
                                    text: "Send"
                                    width: 80
                                }
                            }

                            // Mode hint
                            View {
                                width: Fill
                                height: Fit
                                padding: Inset{left: 12 top: 2 bottom: 4}

                                mode_label := Label {
                                    width: Fill
                                    height: Fit
                                    text: ""
                                    draw_text +: {
                                        color: #8c8c9b
                                        text_style +: { font_size: 10 }
                                    }
                                }
                            }
                        }

                        // Right: agent status panel
                        View {
                            width: 240
                            height: Fill
                            flow: Down
                            show_bg: true
                            draw_bg +: { color: #1a1a22 }

                            View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 8}

                                Label {
                                    text: "Agents"
                                    draw_text +: {
                                        color: #8c8c9b
                                        text_style +: { font_size: 11 bold: true }
                                    }
                                }
                            }

                            agent_status := AgentStatusWidget {}
                        }
                    }
                }
            }
        }
    }
}

/// Top-level application struct.
#[derive(Script, ScriptHook)]
pub struct App {
    #[live]
    ui: WidgetRef,
}

impl App {
    fn populate_demo_state() {
        let mut state = GUI_STATE.write().unwrap();

        // Demo sessions
        state.sessions.push(SessionEntry {
            id: "s1".into(),
            title: "Code Review".into(),
            preview: "Reviewing authentication module".into(),
            kind: SessionKind::Single,
            is_active: true,
            unread: 0,
        });
        state.sessions.push(SessionEntry {
            id: "sg1".into(),
            title: "Refactor Swarm".into(),
            preview: "3 agents working…".into(),
            kind: SessionKind::SwarmGroup { swarm_id: "swarm-1".into() },
            is_active: false,
            unread: 2,
        });

        // Demo messages
        state.messages.push(GuiMessage {
            id: 1,
            role: MessageRole::User,
            content: "Please review the authentication module for security issues.".into(),
            agent_id: None,
            agent_name: None,
            tool_calls: vec![],
            tool_data: None,
            duration_secs: None,
        });
        state.messages.push(GuiMessage {
            id: 2,
            role: MessageRole::Assistant,
            content: "I'll analyze the authentication module. Let me start by examining the token handling code…".into(),
            agent_id: None,
            agent_name: None,
            tool_calls: vec![],
            tool_data: None,
            duration_secs: Some(1.4),
        });
        state.messages.push(GuiMessage {
            id: 3,
            role: MessageRole::Tool,
            content: "read_file(\"src/auth/token.rs\") → 147 lines".into(),
            agent_id: None,
            agent_name: None,
            tool_calls: vec![],
            tool_data: None,
            duration_secs: None,
        });

        // Demo swarm members
        state.swarm_members.push(GuiSwarmMember {
            session_id: "coord-1".into(),
            name: "Coordinator".into(),
            role: jcode_swarm_core::SwarmRole::Coordinator,
            status: jcode_swarm_core::SwarmLifecycleStatus::Running,
            detail: Some("Orchestrating refactor tasks".into()),
            is_coordinator: true,
            status_age_secs: Some(30),
        });
        state.swarm_members.push(GuiSwarmMember {
            session_id: "agent-1".into(),
            name: "Agent-α".into(),
            role: jcode_swarm_core::SwarmRole::Agent,
            status: jcode_swarm_core::SwarmLifecycleStatus::Running,
            detail: Some("Refactoring auth module".into()),
            is_coordinator: false,
            status_age_secs: Some(10),
        });
        state.swarm_members.push(GuiSwarmMember {
            session_id: "agent-2".into(),
            name: "Agent-β".into(),
            role: jcode_swarm_core::SwarmRole::Agent,
            status: jcode_swarm_core::SwarmLifecycleStatus::Ready,
            detail: Some("Awaiting task assignment".into()),
            is_coordinator: false,
            status_age_secs: Some(5),
        });

        // Active session
        state.active_session_id = Some("s1".into());
    }

    fn send_message(&mut self, cx: &mut Cx) {
        let input = self.ui.text_input(cx, ids!(composer_input));
        let text = input.text();
        if text.trim().is_empty() {
            return;
        }

        {
            let mut state = GUI_STATE.write().unwrap();
            let id = state.messages.len() as u64 + 1;
            state.messages.push(GuiMessage {
                id,
                role: MessageRole::User,
                content: text,
                agent_id: None,
                agent_name: None,
                tool_calls: vec![],
                tool_data: None,
                duration_secs: None,
            });
            state.is_processing = true;
        }

        input.set_text(cx, "");
        self.ui.redraw(cx);
    }
}

impl MatchEvent for App {
    fn handle_startup(&mut self, cx: &mut Cx) {
        App::populate_demo_state();
        self.ui.redraw(cx);
    }

    fn handle_actions(&mut self, cx: &mut Cx, actions: &Actions) {
        // Send on button click
        if self.ui.button(cx, ids!(send_button)).clicked(actions) {
            self.send_message(cx);
        }

        // Send on Enter in text input
        if self
            .ui
            .text_input(cx, ids!(composer_input))
            .returned(actions)
            .is_some()
        {
            self.send_message(cx);
        }

        // Update mode hint when text changes
        if let Some(text) = self
            .ui
            .text_input(cx, ids!(composer_input))
            .changed(actions)
        {
            let mode = ComposerMode::detect(&text);
            self.ui
                .label(cx, ids!(mode_label))
                .set_text(cx, mode.placeholder());
        }
    }
}

impl AppMain for App {
    fn script_mod(vm: &mut ScriptVm) -> ScriptValue {
        makepad_widgets::script_mod(vm);
        self::script_mod(vm)
    }

    fn handle_event(&mut self, cx: &mut Cx, event: &Event) {
        self.match_event(cx, event);
        self.ui.handle_event(cx, event, &mut Scope::empty());
    }
}
