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
//!
//! The App hosts a [`GuiBackend`] in an `Arc<GuiBackend>`; the
//! backend owns the in-process server and an `InprocClient`. The
//! main thread drives the Makepad event loop; a small async task on
//! the same Makepad runtime forwards `GuiCommand` enum values to
//! the `InprocClient` and pumps `ServerEvent`s into [`GUI_STATE`]
//! via `GuiState::apply_event`.

use makepad_widgets::*;

use crate::agent_status::AgentStatusWidget;
use crate::composer::{self, ComposerMode};
use crate::file_popup::FilePopupWidget;
use crate::gui_backend::GuiBackend;
use crate::gui_state::{GUI_STATE, ProcessingStatus};
use crate::message_list::MessageListWidget;
use crate::session_list::SessionListWidget;
use crate::slash_popup::SlashPopupWidget;
use crate::swarm_board::SwarmBoardWidget;
use jcode_app_core::inproc_client::InprocClient;
use jcode_app_core::protocol::ServerEvent;
use jcode_app_core::provider::Provider;
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, oneshot};

/// Commands the main thread sends to the worker task that owns the
/// `InprocClient`. Each variant maps to one or two
/// `InprocClient::*` async method calls. Some variants are reserved
/// for follow-up passes (e.g. an explicit Cancel button) and are
/// `#[allow(dead_code)]`'d to silence the warning.
#[derive(Debug)]
#[allow(dead_code)]
enum GuiCommand {
    SendMessage(String),
    SoftInterrupt(String, bool),
    Cancel(u64),
    Clear,
    SetModel(String),
    SetProvider(String),
    CycleModel(i8),
    RefreshModels,
    AvailableModels,
    ResumeSession(String),
    Reload,
}

app_main!(App);

script_mod! {
    use mod.prelude.widgets.*

    // ── Custom widget registrations ──────────────────────────────────────────
    // Each of these still wraps a `View` and is registered so that
    // `App::script_component` can build it. The internals were
    // rewritten for the ChatGPT-style layout; see each file's
    // `impl Widget for …` for the draw_walk that consumes
    // `GUI_STATE`.

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
                draw_bg +: { color: #18181c radius: 6.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down

                    title_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #dcdce6
                            text_style +: { font_size: 13 }
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

            // User bubble: right-aligned, blue tint, max ~70% width.
            UserMsg := RoundedView {
                width: Fill
                height: Fit
                margin: Inset{top: 4 bottom: 4 left: 60 right: 8}
                padding: Inset{left: 14 top: 10 right: 14 bottom: 10}
                show_bg: true
                draw_bg +: { color: #1f3a5b radius: 12.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down
                    spacing: 4

                    sender_label := Label {
                        width: Fit
                        height: Fit
                        text: "You"
                        draw_text +: {
                            color: #64c8dc
                            text_style +: { font_size: 10 }
                        }
                    }

                    content_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #dcdce6
                            text_style +: { font_size: 13 }
                        }
                    }
                }
            }

            // Agent bubble: left-aligned, no bubble background, just
            // a sender label and the body. Tool-call summary line
            // appears below the body when tools fired.
            AssistantMsg := View {
                width: Fill
                height: Fit
                margin: Inset{top: 4 bottom: 4 left: 8 right: 60}
                padding: Inset{left: 4 top: 8 right: 4 bottom: 8}

                View {
                    width: Fill
                    height: Fit
                    flow: Down
                    spacing: 4

                    sender_label := Label {
                        width: Fit
                        height: Fit
                        text: "Agent"
                        draw_text +: {
                            color: #8ab4f8
                            text_style +: { font_size: 10 }
                        }
                    }

                    content_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #d2d2dc
                            text_style +: { font_size: 13 }
                        }
                    }

                    tool_calls_view := View {
                        width: Fill
                        height: Fit
                        visible: false
                        tool_calls_label := Label {
                            width: Fill
                            height: Fit
                            draw_text +: {
                                color: #78c88c
                                text_style +: { font_size: 10 }
                            }
                        }
                    }

                    // Hover-action row — visible only when the
                    // GUI's `hovered_message_id` matches this
                    // row's id. The MessageListWidget's draw_walk
                    // toggles visibility per-row.
                    hover_actions := View {
                        width: Fit
                        height: Fit
                        margin: Inset{top: 4}
                        spacing: 6
                        visible: false

                        copy_button := Button {
                            width: Fit
                            height: Fit
                            padding: Inset{top: 4 bottom: 4 left: 10 right: 10}
                            text: "Copy"
                            draw_bg +: { color: #252529 }
                            draw_text +: {
                                color: #8c8c9b
                                text_style +: { font_size: 10 }
                            }
                        }

                        regen_button := Button {
                            width: Fit
                            height: Fit
                            padding: Inset{top: 4 bottom: 4 left: 10 right: 10}
                            text: "↻ Regenerate"
                            draw_bg +: { color: #252529 }
                            draw_text +: {
                                color: #8c8c9b
                                text_style +: { font_size: 10 }
                            }
                        }
                    }
                }
            }

            // Tool call card — a single short row per tool event.
            ToolMsg := RoundedView {
                width: Fit
                height: Fit
                margin: Inset{top: 2 bottom: 2 left: 8 right: 8}
                padding: Inset{left: 10 top: 4 right: 10 bottom: 4}
                show_bg: true
                draw_bg +: { color: #1c2419 radius: 4.0 }

                content_label := Label {
                    width: Fit
                    height: Fit
                    draw_text +: {
                        color: #78c88c
                        text_style +: { font_size: 11 }
                    }
                }
            }

            // System notice — a centered dim row.
            SystemMsg := View {
                width: Fill
                height: Fit
                margin: Inset{top: 2 bottom: 2 left: 8 right: 8}
                padding: Inset{left: 12 top: 4 right: 12 bottom: 4}

                content_label := Label {
                    width: Fill
                    height: Fit
                    draw_text +: {
                        color: #c8af50
                        text_style +: { font_size: 11 }
                    }
                }
            }

            // Error notice — a tinted card.
            ErrorMsg := RoundedView {
                width: Fill
                height: Fit
                margin: Inset{top: 2 bottom: 2 left: 8 right: 8}
                padding: Inset{left: 12 top: 6 right: 12 bottom: 6}
                show_bg: true
                draw_bg +: { color: #3a1a1a radius: 4.0 }

                content_label := Label {
                    width: Fill
                    height: Fit
                    draw_text +: {
                        color: #ff9090
                        text_style +: { font_size: 11 }
                    }
                }
            }
        }
    }

    let AgentStatusWidget = #(AgentStatusWidget::register_widget(vm)) {
        width: Fill
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
                        text_style +: { font_size: 11 }
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
                    }
                }
            }
        }
    }

    let SlashPopupWidget = #(SlashPopupWidget::register_widget(vm)) {
        width: Fill
        height: Fit
        flow: Down
        show_bg: true
        draw_bg +: { color: #252530 }

        slash_list := PortalList {
            width: Fill
            height: Fit
            flow: Down
            drag_scrolling: false

            SlashRow := View {
                width: Fill
                height: Fit
                flow: Right
                spacing: 8
                padding: Inset{top: 6 bottom: 6 left: 14 right: 12}
                show_bg: true
                draw_bg +: { color: #252530 }

                slash_cmd_label := Label {
                    width: 160
                    height: Fit
                    draw_text +: {
                        color: #8ab4f8
                        text_style +: { font_size: 12 }
                    }
                }

                slash_desc_label := Label {
                    width: Fill
                    height: Fit
                    draw_text +: {
                        color: #8c8c9b
                        text_style +: { font_size: 11 }
                    }
                }
            }

            SlashRowSelected := View {
                width: Fill
                height: Fit
                flow: Right
                spacing: 8
                padding: Inset{top: 6 bottom: 6 left: 14 right: 12}
                show_bg: true
                draw_bg +: { color: #2e3045 }

                slash_cmd_label := Label {
                    width: 160
                    height: Fit
                    draw_text +: {
                        color: #c8d8ff
                        text_style +: { font_size: 12 }
                    }
                }

                slash_desc_label := Label {
                    width: Fill
                    height: Fit
                    draw_text +: {
                        color: #aaaacc
                        text_style +: { font_size: 11 }
                    }
                }
            }
        }
    }

    let FilePopupWidget = #(FilePopupWidget::register_widget(vm)) {
        width: Fill
        height: Fit
        flow: Down
        show_bg: true
        draw_bg +: { color: #252530 }

        file_list := PortalList {
            width: Fill
            height: Fit
            flow: Down
            drag_scrolling: false

            FileRow := View {
                width: Fill
                height: Fit
                flow: Right
                padding: Inset{top: 6 bottom: 6 left: 14 right: 12}
                show_bg: true
                draw_bg +: { color: #252530 }

                file_name_label := Label {
                    width: Fill
                    height: Fit
                    draw_text +: {
                        color: #b0e0b0
                        text_style +: { font_size: 12 }
                    }
                }
            }

            FileRowSelected := View {
                width: Fill
                height: Fit
                flow: Right
                padding: Inset{top: 6 bottom: 6 left: 14 right: 12}
                show_bg: true
                draw_bg +: { color: #2e3a2e }

                file_name_label := Label {
                    width: Fill
                    height: Fit
                    draw_text +: {
                        color: #d0ffd0
                        text_style +: { font_size: 12 }
                    }
                }
            }
        }
    }

    let SwarmBoardWidget = #(SwarmBoardWidget::register_widget(vm)) {
        width: Fill
        height: Fill

        todo_list := PortalList {
            width: Fill
            height: Fill
            flow: Down
            drag_scrolling: false

            TaskCard := RoundedView {
                width: Fill
                height: Fit
                padding: Inset{top: 6 bottom: 6 left: 10 right: 8}
                margin: Inset{top: 2 bottom: 2 left: 4 right: 4}
                show_bg: true
                draw_bg +: { color: #1e2636 radius: 4.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down
                    spacing: 2

                    task_title_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #a0b8d8
                            text_style +: { font_size: 11 }
                        }
                    }

                    task_assignee_label := Label {
                        width: Fit
                        height: Fit
                        draw_text +: {
                            color: #6482aa
                            text_style +: { font_size: 9 }
                        }
                    }
                }
            }
        }

        running_list := PortalList {
            width: Fill
            height: Fill
            flow: Down
            drag_scrolling: false

            TaskCard := RoundedView {
                width: Fill
                height: Fit
                padding: Inset{top: 6 bottom: 6 left: 10 right: 8}
                margin: Inset{top: 2 bottom: 2 left: 4 right: 4}
                show_bg: true
                draw_bg +: { color: #2a2010 radius: 4.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down
                    spacing: 2

                    task_title_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #ffc864
                            text_style +: { font_size: 11 }
                        }
                    }

                    task_assignee_label := Label {
                        width: Fit
                        height: Fit
                        draw_text +: {
                            color: #a07840
                            text_style +: { font_size: 9 }
                        }
                    }
                }
            }
        }

        done_list := PortalList {
            width: Fill
            height: Fill
            flow: Down
            drag_scrolling: false

            TaskCard := RoundedView {
                width: Fill
                height: Fit
                padding: Inset{top: 6 bottom: 6 left: 10 right: 8}
                margin: Inset{top: 2 bottom: 2 left: 4 right: 4}
                show_bg: true
                draw_bg +: { color: #1a2a1a radius: 4.0 }

                View {
                    width: Fill
                    height: Fit
                    flow: Down
                    spacing: 2

                    task_title_label := Label {
                        width: Fill
                        height: Fit
                        draw_text +: {
                            color: #64c864
                            text_style +: { font_size: 11 }
                        }
                    }

                    task_assignee_label := Label {
                        width: Fit
                        height: Fit
                        draw_text +: {
                            color: #409040
                            text_style +: { font_size: 9 }
                        }
                    }
                }
            }
        }
    }

    // ── Shared row templates used by the new App layout ─────────────
    // A suggestion tile shown in the empty state.
    let SuggestionCard = RoundedView {
        width: 360
        height: Fit
        padding: Inset{top: 14 bottom: 14 left: 16 right: 16}
        margin: Inset{top: 0 bottom: 12 right: 12}
        show_bg: true
        draw_bg +: { color: #1a1a1e radius: 10.0 }

        suggestion_label := Label {
            width: Fill
            height: Fit
            draw_text +: {
                color: #dcdce6
                text_style +: { font_size: 13 }
            }
        }
    }

    // A compact pill shown when the sidebar is collapsed to the
    // icon rail. Just a 28×28 button with the icon's text.
    let IconRailButton = Button {
        width: 36
        height: 36
        draw_bg +: { color: #252529 radius: 8.0 }
        draw_text +: {
            color: #dcdce6
            text_style +: { font_size: 16 }
        }
    }

    // ── App layout ──────────────────────────────────────────────────────
    // Top bar (56px) + body row (sidebar + central column + optional
    // right panel).
    startup() do #(App::script_component(vm)) {
        ui: Root {
            main_window := Window {
                window.inner_size: vec2(1200, 800)
                window.title: "jcode"
                body +: {
                    flow: Down
                    draw_bg +: { color: #0f0f12 }

                    // ── Top bar ─────────────────────────────────────────
                    top_bar := View {
                        width: Fill
                        height: 56
                        flow: Right
                        align: Align{y: 0.5}
                        padding: Inset{left: 12 right: 12}
                        spacing: 12
                        show_bg: true
                        draw_bg +: { color: #18181c }

                        // Sidebar collapse / expand toggle.
                        sidebar_toggle := Button {
                            width: 32
                            height: 32
                            text: "≡"
                            draw_bg +: { color: #252529 radius: 6.0 }
                            draw_text +: {
                                color: #dcdce6
                                text_style +: { font_size: 16 }
                            }
                        }

                        // App title / brand.
                        title_label := Label {
                            width: Fit
                            height: Fit
                            text: "jcode"
                            draw_text +: {
                                color: #dcdce6
                                text_style +: { font_size: 16 }
                            }
                        }

                        // Model selector pill — clickable; opens
                        // the model picker popover.
                        model_pill := Button {
                            width: Fit
                            height: 28
                            padding: Inset{left: 12 right: 12}
                            align: Align{y: 0.5}
                            draw_bg +: { color: #1a1a1e radius: 14.0 }
                            draw_text +: {
                                color: #8ab4f8
                                text_style +: { font_size: 11 }
                            }
                            model_label := Label {
                                width: Fit
                                height: Fit
                                text: "claude-opus-4-5"
                                draw_text +: {
                                    color: #8ab4f8
                                    text_style +: { font_size: 11 }
                                }
                            }
                        }

                        View { width: Fill height: 1 }

                        // Right side: connection status + token
                        // usage. Hidden when narrow.
                        status_label := Label {
                            width: Fit
                            height: Fit
                            text: "Ready"
                            draw_text +: {
                                color: #8c8c9b
                                text_style +: { font_size: 11 }
                            }
                        }

                        token_usage_label := Label {
                            width: Fit
                            height: Fit
                            text: ""
                            margin: Inset{left: 12}
                            draw_text +: {
                                color: #6482aa
                                text_style +: { font_size: 10 }
                            }
                        }
                    }

                    // 1px divider under the top bar.
                    View {
                        width: Fill
                        height: 1
                        show_bg: true
                        draw_bg +: { color: #2a2a2f }
                    }

                    // ── Body row ───────────────────────────────────────
                    body_row := View {
                        width: Fill
                        height: Fill
                        flow: Right

                        // ── Left sidebar (full sessions view) ───────────
                        // `visible: true` is overridden per-frame by
                        // `App::update_header_labels` from
                        // `state.sidebar_collapsed`.
                        sidebar := View {
                            width: 280
                            height: Fill
                            flow: Down
                            show_bg: true
                            draw_bg +: { color: #18181c }

                            new_chat_button := Button {
                                width: Fill
                                height: 36
                                margin: Inset{top: 10 bottom: 8 left: 12 right: 12}
                                padding: Inset{left: 12 right: 12}
                                text: "+  New chat"
                                align: Align{x: 0.0, y: 0.5}
                                draw_bg +: { color: #252529 radius: 8.0 }
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }

                            // Section header.
                            View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 4 bottom: 4 left: 16 right: 12}

                                Label {
                                    text: "Sessions"
                                    draw_text +: {
                                        color: #8c8c9b
                                        text_style +: { font_size: 10 }
                                    }
                                }
                            }

                            session_list := SessionListWidget {}

                            // Bottom-left settings link (no-op
                            // for this pass).
                            View {
                                width: Fill
                                height: 1
                                margin: Inset{top: 0 bottom: 0}
                                show_bg: true
                                draw_bg +: { color: #2a2a2f }
                            }

                            View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 12 left: 16 right: 12}
                                flow: Right
                                spacing: 8

                                Label {
                                    text: "⚙ Settings"
                                    draw_text +: {
                                        color: #8c8c9b
                                        text_style +: { font_size: 11 }
                                    }
                                }
                            }
                        }

                        // ── Collapsed icon rail (visible only when
                        // sidebar_collapsed) ───────────────────────────
                        icon_rail := View {
                            width: 56
                            height: Fill
                            flow: Down
                            align: Align{x: 0.5}
                            padding: Inset{top: 10}
                            spacing: 8
                            show_bg: true
                            draw_bg +: { color: #18181c }

                            expand_button := IconRailButton { text: "≡" }
                            new_chat_rail := IconRailButton { text: "+" }
                        }

                        // ── Central column: messages + composer ──────────
                        center := View {
                            width: Fill
                            height: Fill
                            flow: Down
                            show_bg: true
                            draw_bg +: { color: #0f0f12 }

                            // Welcome / empty state — visible only
                            // when `state.messages.is_empty()`.
                            welcome_view := View {
                                width: Fill
                                height: Fit
                                flow: Down
                                align: Align{x: 0.5, y: 0.5}
                                padding: Inset{top: 60}

                                View {
                                    width: Fit
                                    height: Fit
                                    margin: Inset{bottom: 24}

                                    Label {
                                        text: "What can I help with?"
                                        draw_text +: {
                                            color: #dcdce6
                                            text_style +: { font_size: 22 }
                                        }
                                    }
                                }

                                // Suggestion cards stack vertically so
                                // they read as a clean column. (Makepad
                                // doesn't have a CSS-style wrap-flow
                                // helper; a future pass can use a
                                // custom layout that does row-wrap.)
                                suggestions_column := View {
                                    width: Fit
                                    height: Fit
                                    flow: Down

                                    suggestion_1 := SuggestionCard {
                                        suggestion_label: { text: "Refactor the auth module to use a single session-token table" }
                                    }
                                    suggestion_2 := SuggestionCard {
                                        suggestion_label: { text: "Add unit tests for the swarm coordinator lifecycle" }
                                    }
                                    suggestion_3 := SuggestionCard {
                                        suggestion_label: { text: "Investigate the last 10 CI flakes and propose fixes" }
                                    }
                                }
                            }

                            // The actual message thread.
                            message_list := MessageListWidget {}

                            View { width: Fill height: 1 }

                            // Slash-command suggestion popup
                            // (sits above the composer when the
                            // user types a `/`).
                            slash_popup := SlashPopupWidget {}

                            // `@`-file-mention popup.
                            file_popup := FilePopupWidget {}

                            // ── Composer (sticky bottom) ─────────────────
                            composer_area := View {
                                width: Fill
                                height: Fit
                                flow: Down
                                padding: Inset{top: 8 bottom: 16 left: 0 right: 0}
                                show_bg: true
                                draw_bg +: { color: #0f0f12 }

                                composer_row := View {
                                    width: Fill
                                    height: Fit
                                    flow: Right
                                    align: Align{y: 1.0}
                                    padding: Inset{left: 24 right: 24}
                                    spacing: 12

                                    composer_input := TextInput {
                                        width: Fill
                                        height: Fit
                                        padding: Inset{top: 12 bottom: 12 left: 16 right: 16}
                                        empty_text: "Ask anything…"
                                        draw_bg +: { color: #1a1a1e radius: 12.0 }
                                    }

                                    send_button := Button {
                                        width: 44
                                        height: 44
                                        text: "↑"
                                        draw_bg +: { color: #1a1a1e radius: 12.0 }
                                        draw_text +: {
                                            color: #8ab4f8
                                            text_style +: { font_size: 18 }
                                        }
                                    }
                                }

                                View {
                                    width: Fill
                                    height: Fit
                                    padding: Inset{top: 4 bottom: 0 left: 24 right: 24}

                                    mode_label := Label {
                                        width: Fill
                                        height: Fit
                                        text: ""
                                        draw_text +: {
                                            color: #6482aa
                                            text_style +: { font_size: 10 }
                                        }
                                    }
                                }
                            }
                        }

                        // ── Right panel (agent status + plan board) ───
                        right_panel := View {
                            width: 260
                            height: Fill
                            flow: Down
                            show_bg: true
                            draw_bg +: { color: #18181c }

                            View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 12 bottom: 8 left: 12 right: 12}

                                Label {
                                    text: "Agents"
                                    draw_text +: {
                                        color: #8c8c9b
                                        text_style +: { font_size: 10 }
                                    }
                                }
                            }

                            agent_status := AgentStatusWidget {}

                            View {
                                width: Fill
                                height: 1
                                margin: Inset{top: 4 bottom: 4}
                                show_bg: true
                                draw_bg +: { color: #2a2a2f }
                            }

                            View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 12}

                                Label {
                                    text: "Plan"
                                    draw_text +: {
                                        color: #8c8c9b
                                        text_style +: { font_size: 10 }
                                    }
                                }
                            }

                            swarm_board := SwarmBoardWidget {}
                        }
                    }
                }

                // ── Model picker popover (overlays the chat thread) ─
                // Hidden by default; shown when the user clicks the
                // model pill in the top bar.
                model_picker_popover := View {
                    width: Fill
                    height: Fill
                    visible: false
                    align: Align{x: 0.5, y: 0.2}
                    padding: Inset{top: 60}

                    RoundedView {
                        width: 320
                        height: Fit
                        flow: Down
                        padding: Inset{top: 8 bottom: 8 left: 4 right: 4}
                        show_bg: true
                        draw_bg +: { color: #1a1a1e radius: 10.0 }

                        View {
                            width: Fill
                            height: Fit
                            padding: Inset{left: 12 top: 6 bottom: 6 right: 12}

                            Label {
                                text: "Switch model"
                                draw_text +: {
                                    color: #8c8c9b
                                    text_style +: { font_size: 10 }
                                }
                            }
                        }

                        picker_model_0 := View {
                            width: Fill
                            height: Fit
                            padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                            margin: Inset{top: 1 bottom: 1}
                            show_bg: true
                            draw_bg +: { color: #1a1a1e }

                            picker_model_label := Label {
                                width: Fill
                                height: Fit
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                        }
                        picker_model_1 := View {
                            width: Fill
                            height: Fit
                            padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                            margin: Inset{top: 1 bottom: 1}
                            show_bg: true
                            draw_bg +: { color: #1a1a1e }

                            picker_model_label := Label {
                                width: Fill
                                height: Fit
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                        }
                        picker_model_2 := View {
                            width: Fill
                            height: Fit
                            padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                            margin: Inset{top: 1 bottom: 1}
                            show_bg: true
                            draw_bg +: { color: #1a1a1e }

                            picker_model_label := Label {
                                width: Fill
                                height: Fit
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                        }
                        picker_model_3 := View {
                            width: Fill
                            height: Fit
                            padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                            margin: Inset{top: 1 bottom: 1}
                            show_bg: true
                            draw_bg +: { color: #1a1a1e }

                            picker_model_label := Label {
                                width: Fill
                                height: Fit
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                        }
                        picker_model_4 := View {
                            width: Fill
                            height: Fit
                            padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                            margin: Inset{top: 1 bottom: 1}
                            show_bg: true
                            draw_bg +: { color: #1a1a1e }

                            picker_model_label := Label {
                                width: Fill
                                height: Fit
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                        }
                        picker_model_5 := View {
                            width: Fill
                            height: Fit
                            padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                            margin: Inset{top: 1 bottom: 1}
                            show_bg: true
                            draw_bg +: { color: #1a1a1e }

                            picker_model_label := Label {
                                width: Fill
                                height: Fit
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                        }
                        picker_model_6 := View {
                            width: Fill
                            height: Fit
                            padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                            margin: Inset{top: 1 bottom: 1}
                            show_bg: true
                            draw_bg +: { color: #1a1a1e }

                            picker_model_label := Label {
                                width: Fill
                                height: Fit
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                        }
                        picker_model_7 := View {
                            width: Fill
                            height: Fit
                            padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                            margin: Inset{top: 1 bottom: 1}
                            show_bg: true
                            draw_bg +: { color: #1a1a1e }

                            picker_model_label := Label {
                                width: Fill
                                height: Fit
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                        }
                    }
                }

                // ── Settings modal (centered overlay) ───────────────────
                // Hidden by default; shown when the user clicks
                // "⚙ Settings" in the sidebar.
                settings_overlay := View {
                    width: Fill
                    height: Fill
                    visible: false
                    draw_bg +: { color: #000000B3 }

                    View {
                        width: Fill
                        height: Fill
                        align: Align{x: 0.5, y: 0.5}
                        padding: Inset{top: 40 bottom: 40 left: 40 right: 40}

                        settings_panel := RoundedView {
                            width: 520
                            height: Fit
                            flow: Down
                            padding: Inset{top: 20 bottom: 20 left: 24 right: 24}
                            show_bg: true
                            draw_bg +: { color: #1a1a1e radius: 14.0 }

                            // Header row
                            View {
                                width: Fill
                                height: Fit
                                flow: Right
                                align: Align{y: 0.5}
                                margin: Inset{bottom: 16}

                                View { width: Fill height: 1 }

                                Label {
                                    text: "Settings"
                                    draw_text +: {
                                        color: #dcdce6
                                        text_style +: { font_size: 16 }
                                    }
                                }

                                View { width: Fill height: 1 }

                                settings_close := Button {
                                    width: 28
                                    height: 28
                                    text: "✕"
                                    draw_bg +: { color: #252529 radius: 6.0 }
                                    draw_text +: {
                                        color: #8c8c9b
                                        text_style +: { font_size: 12 }
                                    }
                                }
                            }

                            // Provider section — explicit rows
                            // (no PortalList; the count is small and
                            // stable so 8 hand-rolled rows are
                            // simpler than driving a PortalList).
                            View {
                                width: Fill
                                height: Fit
                                margin: Inset{bottom: 8}

                                Label {
                                    text: "Provider"
                                    draw_text +: {
                                        color: #8c8c9b
                                        text_style +: { font_size: 11 }
                                    }
                                }
                            }

                            provider_row_0 := Button {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                text: "○  claude"
                                align: Align{x: 0.0, y: 0.5}
                                draw_bg +: { color: #1a1a1e }
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                            provider_row_1 := Button {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                text: "○  openai"
                                align: Align{x: 0.0, y: 0.5}
                                draw_bg +: { color: #1a1a1e }
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                            provider_row_2 := Button {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                text: "○  openrouter"
                                align: Align{x: 0.0, y: 0.5}
                                draw_bg +: { color: #1a1a1e }
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                            provider_row_3 := Button {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                text: "○  copilot"
                                align: Align{x: 0.0, y: 0.5}
                                draw_bg +: { color: #1a1a1e }
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                            provider_row_4 := Button {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                text: "○  gemini"
                                align: Align{x: 0.0, y: 0.5}
                                draw_bg +: { color: #1a1a1e }
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                            provider_row_5 := Button {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                text: "○  cursor"
                                align: Align{x: 0.0, y: 0.5}
                                draw_bg +: { color: #1a1a1e }
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                            provider_row_6 := Button {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                text: "○  antigravity"
                                align: Align{x: 0.0, y: 0.5}
                                draw_bg +: { color: #1a1a1e }
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }
                            provider_row_7 := Button {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                text: "○  ollama"
                                align: Align{x: 0.0, y: 0.5}
                                draw_bg +: { color: #1a1a1e }
                                draw_text +: {
                                    color: #dcdce6
                                    text_style +: { font_size: 12 }
                                }
                            }

                            // Model section
                            View {
                                width: Fill
                                height: Fit
                                margin: Inset{top: 16 bottom: 8}

                                Label {
                                    text: "Available models"
                                    draw_text +: {
                                        color: #8c8c9b
                                        text_style +: { font_size: 11 }
                                    }
                                }
                            }

                            // 8 model rows too (most providers expose
                            // <= 8 named models).
                            model_row_0 := View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                show_bg: true
                                draw_bg +: { color: #181820 }

                                model_name_label := Label {
                                    width: Fill
                                    height: Fit
                                    draw_text +: {
                                        color: #dcdce6
                                        text_style +: { font_size: 12 }
                                    }
                                }
                            }
                            model_row_1 := View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                show_bg: true
                                draw_bg +: { color: #181820 }

                                model_name_label := Label {
                                    width: Fill
                                    height: Fit
                                    draw_text +: {
                                        color: #dcdce6
                                        text_style +: { font_size: 12 }
                                    }
                                }
                            }
                            model_row_2 := View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                show_bg: true
                                draw_bg +: { color: #181820 }

                                model_name_label := Label {
                                    width: Fill
                                    height: Fit
                                    draw_text +: {
                                        color: #dcdce6
                                        text_style +: { font_size: 12 }
                                    }
                                }
                            }
                            model_row_3 := View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                show_bg: true
                                draw_bg +: { color: #181820 }

                                model_name_label := Label {
                                    width: Fill
                                    height: Fit
                                    draw_text +: {
                                        color: #dcdce6
                                        text_style +: { font_size: 12 }
                                    }
                                }
                            }
                            model_row_4 := View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                show_bg: true
                                draw_bg +: { color: #181820 }

                                model_name_label := Label {
                                    width: Fill
                                    height: Fit
                                    draw_text +: {
                                        color: #dcdce6
                                        text_style +: { font_size: 12 }
                                    }
                                }
                            }
                            model_row_5 := View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                show_bg: true
                                draw_bg +: { color: #181820 }

                                model_name_label := Label {
                                    width: Fill
                                    height: Fit
                                    draw_text +: {
                                        color: #dcdce6
                                        text_style +: { font_size: 12 }
                                    }
                                }
                            }
                            model_row_6 := View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                show_bg: true
                                draw_bg +: { color: #181820 }

                                model_name_label := Label {
                                    width: Fill
                                    height: Fit
                                    draw_text +: {
                                        color: #dcdce6
                                        text_style +: { font_size: 12 }
                                    }
                                }
                            }
                            model_row_7 := View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 6 bottom: 6 left: 12 right: 12}
                                margin: Inset{top: 2 bottom: 2}
                                show_bg: true
                                draw_bg +: { color: #181820 }

                                model_name_label := Label {
                                    width: Fill
                                    height: Fit
                                    draw_text +: {
                                        color: #dcdce6
                                        text_style +: { font_size: 12 }
                                    }
                                }
                            }

                            // Footer
                            View {
                                width: Fill
                                height: Fit
                                margin: Inset{top: 20}
                                flow: Right
                                align: Align{y: 0.5}

                                View { width: Fill height: 1 }

                                Label {
                                    text: "Provider switching requires a model pick too."
                                    draw_text +: {
                                        color: #6482aa
                                        text_style +: { font_size: 10 }
                                    }
                                }
                            }
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
    /// `None` until the in-process server has finished starting up.
    /// Populated by a oneshot the worker task writes to.
    backend: BackendState,
    /// Monotonic id used to correlate the next `SendMessage` request
    /// with a future `Cancel` from the UI. Reserved for a follow-up
    /// pass that wires the explicit Cancel button; currently
    /// unused.
    #[allow(dead_code)]
    next_request_id: u64,
    /// Last error from backend startup (if any). Rendered in the
    /// header status in red.
    last_error: Mutex<Option<String>>,
    /// Whether the left sidebar is collapsed to the icon rail.
    /// Lives on `App` (not `GUI_STATE`) because it's a purely
    /// UI-local toggle, not derived from any server state.
    sidebar_collapsed: bool,
}

/// All backend-related state held by `App`. We use a struct so the
/// `Debug` derive on `App` stays cheap (one `None` / `Some(...)`
/// branch). The fields are individually wrapped:
/// - `cmd_tx` is the channel the main thread posts `GuiCommand`s
///   into; the worker task drains it.
/// - `backend_init_rx` resolves once when the worker has finished
///   starting the server.
/// - `backend` is `Some` once init is complete.
#[derive(Default)]
struct BackendState {
    cmd_tx: Option<mpsc::UnboundedSender<GuiCommand>>,
    backend_init_rx: Option<oneshot::Receiver<Result<Arc<GuiBackend>, anyhow::Error>>>,
    backend: Option<Arc<GuiBackend>>,
}

impl App {
    /// Default provider the GUI uses when the user has not set
    /// `JCODE_PROVIDER` / `JCODE_PROVIDER_PROFILE_NAME` and has
    /// not picked one in Settings. We use `MultiProvider::new()`
    /// which performs the same env-driven detection the TUI's
    /// `init_provider` does (Claude Code CLI subscription first,
    /// then API keys for Claude / OpenAI / Gemini / etc., then
    /// Ollama on `localhost:11434`). The first message send
    /// surfaces a clear error event if no provider is actually
    /// reachable.
    fn default_provider() -> Arc<dyn Provider> {
        Arc::new(jcode_app_core::provider::MultiProvider::new())
    }

    /// Run a closure on the GUI state under a write lock.
    fn with_state_mut<R>(f: impl FnOnce(&mut crate::gui_state::GuiState) -> R) -> R {
        let mut guard = GUI_STATE.write().unwrap();
        f(&mut guard)
    }

    /// Read-only accessor for tests / future introspection.
    #[allow(dead_code)]
    fn with_state<R>(f: impl FnOnce(&crate::gui_state::GuiState) -> R) -> R {
        let guard = GUI_STATE.read().unwrap();
        f(&guard)
    }

    /// Send a `GuiCommand` to the worker task. Returns `Err` if the
    /// backend is not yet ready or the worker has shut down — the
    /// caller can surface the error to the user.
    fn send_command(&self, cmd: GuiCommand) -> Result<(), String> {
        let Some(tx) = self.backend.cmd_tx.as_ref() else {
            return Err("Server is starting up; please wait.".to_string());
        };
        tx.send(cmd).map_err(|_| "Server worker has stopped".to_string())
    }

    /// Drain all pending `ServerEvent`s from the backend and apply
    /// each to `GUI_STATE`. Returns `true` if any state changed (so
    /// the caller knows to redraw).
    fn drain_backend_events(&self) -> bool {
        let Some(backend) = self.backend.backend.as_ref() else {
            return false;
        };
        backend.poll(|ev| {
            Self::apply_event(ev);
        })
    }

    /// Apply a single `ServerEvent` to the global GUI state under a
    /// write lock.
    fn apply_event(ev: &ServerEvent) {
        if let Ok(mut state) = GUI_STATE.write() {
            state.apply_event(ev);
        }
    }

    /// Drive the bootstrap handshake: once the worker has
    /// `GuiBackend::start` complete, take the result and stash the
    /// `Arc<GuiBackend>` in `self.backend.backend`. The worker also
    /// sends the initial `Subscribe` + `GetHistory`, so the first
    /// `ServerEvent::History` lands soon after init.
    fn poll_backend_init(&mut self, cx: &mut Cx) {
        // Take the receiver out so we can poll it without holding
        // a borrow across the rest of the frame.
        let Some(mut rx) = self.backend.backend_init_rx.take() else {
            return;
        };
        let result: Result<Result<Arc<GuiBackend>, anyhow::Error>, oneshot::error::TryRecvError> =
            rx.try_recv();
        match result {
            Ok(Ok(backend)) => {
                self.backend.backend = Some(backend);
                self.update_header_labels(cx);
                self.ui.redraw(cx);
            }
            Ok(Err(e)) => {
                let msg = format!("{e:#}");
                *self.last_error.lock().unwrap() = Some(msg.clone());
                self.update_header_labels(cx);
                self.ui.redraw(cx);
            }
            Err(oneshot::error::TryRecvError::Closed) => {
                // The worker died before it could signal us.
                *self.last_error.lock().unwrap() =
                    Some("Server worker exited during startup".to_string());
                self.update_header_labels(cx);
                self.ui.redraw(cx);
            }
            Err(oneshot::error::TryRecvError::Empty) => {
                // Not ready yet; put the receiver back.
                self.backend.backend_init_rx = Some(rx);
            }
        }
    }

    fn update_header_labels(&mut self, cx: &mut Cx) {
        let state = GUI_STATE.read().unwrap();
        let status_text = {
            let last_err = self.last_error.lock().unwrap().clone();
            if let Some(err) = &last_err {
                format!("Error: {}", err)
            } else {
                state.header_status()
            }
        };
        self.ui
            .label(cx, ids!(status_label))
            .set_text(cx, &status_text);
        // We don't currently swap the label colour on error (no
        // first-class set_text_color on LabelRef in this Makepad
        // build); the "Error:" prefix is the visual cue.

        let usage_text = state.token_usage_label().unwrap_or_default();
        self.ui
            .label(cx, ids!(token_usage_label))
            .set_text(cx, &usage_text);

        // Model pill: prefer the active session's
        // `provider_model` (e.g. "claude-opus-4-5"); fall back
        // to the global `model_name` field which is set on the
        // first `History` event.
        let model_text = if !state.provider_model.is_empty() {
            state.provider_model.clone()
        } else {
            state.model_name.clone()
        };
        if !model_text.is_empty() {
            self.ui
                .label(cx, ids!(model_label))
                .set_text(cx, &model_text);
        }
    }

    /// Submit a user message. Called by the Send button and the
    /// Enter key on the composer. Routes through the InprocClient.
    fn send_message(&mut self, cx: &mut Cx) {
        let input = self.ui.text_input(cx, ids!(composer_input));
        let text = input.text();
        if text.trim().is_empty() {
            return;
        }
        // Update local state immediately for snappy UI: push the
        // user bubble, mark the model as thinking, clear
        // suggestions. The server will eventually send the
        // `TextDelta` for the assistant half.
        Self::with_state_mut(|state| {
            state.streaming_text.clear();
            state.streaming_tool_calls.clear();
            state.is_streaming = false;
            state.processing_status = ProcessingStatus::Thinking { elapsed_secs: 0.0 };
            state.slash_suggestions.clear();
            state.slash_selected = 0;
            state.file_suggestions.clear();
            state.file_selected = 0;
        });
        let _ = self.send_command(GuiCommand::SendMessage(text));
        input.set_text(cx, "");
        self.update_header_labels(cx);
    }

    /// The send button doubles as stop while a stream is in
    /// flight. `handle_actions` calls this on every click; we
    /// decide based on the current `processing_status` whether to
    /// fire `SendMessage` (new turn) or `Cancel` (interrupt).
    fn on_send_or_stop_click(&mut self, cx: &mut Cx) {
        let is_active = GUI_STATE
            .read()
            .map(|s| s.processing_status.is_active())
            .unwrap_or(false);
        if is_active {
            // We don't have a real cancel request id to send —
            // the previous SendMessage id lives in the worker
            // task. Send a soft interrupt instead, which the
            // server injects at the next safe point.
            let _ = self.send_command(GuiCommand::SoftInterrupt(
                "User pressed Stop".to_string(),
                true,
            ));
        } else {
            self.send_message(cx);
        }
        self.update_send_button_label(cx);
        self.update_header_labels(cx);
    }

    /// Update the send/stop button label from `processing_status`.
    /// Called after every state change that could toggle streaming
    /// on/off. The colour is fixed in the `script_mod!` block to
    /// keep this path simple (Makepad doesn't expose a per-button
    /// text-color setter; the colour would have to be re-applied
    /// via the `draw_text` shader, which is out of scope for this
    /// pass).
    fn update_send_button_label(&mut self, cx: &mut Cx) {
        let is_active = GUI_STATE
            .read()
            .map(|s| s.processing_status.is_active())
            .unwrap_or(false);
        let btn = self.ui.button(cx, ids!(send_button));
        if is_active {
            btn.set_text(cx, "■");
        } else {
            btn.set_text(cx, "↑");
        }
    }

    /// Toggle the sidebar between the 280px panel and the
    /// 56px icon rail. Mutates `self.sidebar_collapsed` and
    /// repaints so the visibility takes effect.
    fn toggle_sidebar(&mut self, cx: &mut Cx) {
        self.sidebar_collapsed = !self.sidebar_collapsed;
        self.update_layout_visibility(cx);
    }

    /// Update sidebar / icon_rail / right_panel / welcome
    /// visibility from the current `sidebar_collapsed` and
    /// message-count state. Called after every event drain and
    /// after the toggle click.
    fn update_layout_visibility(&mut self, cx: &mut Cx) {
        let (collapsed, empty) = {
            let state = GUI_STATE.read().unwrap();
            (
                self.sidebar_collapsed,
                state.messages.is_empty() && !state.is_streaming,
            )
        };
        self.ui.view(cx, ids!(sidebar)).set_visible(cx, !collapsed);
        self.ui.view(cx, ids!(icon_rail)).set_visible(cx, collapsed);
        // Right panel: hidden when sidebar is collapsed to give
        // the chat thread more room. (The kanban + agent status
        // is rarely needed; the user can re-open.)
        self.ui.view(cx, ids!(right_panel)).set_visible(cx, !collapsed);
        // Welcome view visible only when there are no messages.
        self.ui.view(cx, ids!(welcome_view)).set_visible(cx, empty);
        self.ui.redraw(cx);
    }

    /// Fill the composer with one of the welcome suggestions.
    /// Suggestions come from `GUI_STATE.welcome_suggestions` (set
    /// once in `default_welcome_suggestions`); we pick by
    /// index so the GUI never owns the strings directly.
    fn on_suggestion_click(&mut self, cx: &mut Cx, index: usize) {
        let suggestion = {
            let state = GUI_STATE.read().unwrap();
            state
                .welcome_suggestions
                .get(index)
                .cloned()
                .unwrap_or_default()
        };
        if suggestion.is_empty() {
            return;
        }
        let input = self.ui.text_input(cx, ids!(composer_input));
        input.set_text(cx, &suggestion);
        // The text-input widget's cursor drops at the end of the
        // new text by default; the user can just type or press
        // Enter to send. (Makepad's set_cursor API takes a Cursor
        // struct, which is heavier than we need for a focus
        // adjustment here.)
        self.ui.redraw(cx);
    }

    /// Toggle the Settings modal overlay. The modal is a
    /// `width: Fill, height: Fill` view with a semi-transparent
    /// backdrop; the click-on-backdrop case is handled by
    /// `on_settings_backdrop_click` below.
    fn toggle_settings(&mut self, cx: &mut Cx) {
        Self::with_state_mut(|s| {
            s.settings_open = !s.settings_open;
            // Closing settings also closes the model picker.
            if !s.settings_open {
                s.model_picker_open = false;
            }
        });
        self.update_modal_visibility(cx);
    }

    /// Close the Settings modal. Wired to the ✕ button and
    /// the backdrop click.
    fn close_settings(&mut self, cx: &mut Cx) {
        Self::with_state_mut(|s| {
            s.settings_open = false;
        });
        self.update_modal_visibility(cx);
    }

    /// Toggle the model picker popover.
    fn toggle_model_picker(&mut self, cx: &mut Cx) {
        Self::with_state_mut(|s| {
            s.model_picker_open = !s.model_picker_open;
        });
        self.update_modal_visibility(cx);
    }

    /// Close the model picker. The model picker is also
    /// auto-closed when the settings modal opens, so the user
    /// doesn't see two modals at once.
    fn close_model_picker(&mut self, cx: &mut Cx) {
        Self::with_state_mut(|s| {
            s.model_picker_open = false;
        });
        self.update_modal_visibility(cx);
    }

    /// User picked a provider from the Settings list. Fires
    /// `Request::SetProvider`; the resulting
    /// `ServerEvent::ProviderChanged` updates the model pill
    /// and the available-models list.
    fn on_provider_pick(&mut self, cx: &mut Cx, name: &str) {
        let _ = self.send_command(GuiCommand::SetProvider(name.to_string()));
        // Close the modal — the user sees the new model pill
        // update on the next event drain.
        Self::with_state_mut(|s| {
            s.settings_open = false;
        });
        self.update_modal_visibility(cx);
    }

    /// User picked a model from the picker popover or the
    /// Settings model list. Fires `Request::SetModel`.
    fn on_model_pick(&mut self, cx: &mut Cx, model: &str) {
        let _ = self.send_command(GuiCommand::SetModel(model.to_string()));
        // Close the picker.
        Self::with_state_mut(|s| {
            s.model_picker_open = false;
        });
        self.update_modal_visibility(cx);
    }

    /// Update Settings modal + model picker popover visibility
    /// from `GUI_STATE`. Called after every state change that
    /// could open / close either.
    fn update_modal_visibility(&mut self, cx: &mut Cx) {
        let (settings_open, picker_open) = {
            let state = GUI_STATE.read().unwrap();
            (state.settings_open, state.model_picker_open)
        };
        self.ui
            .view(cx, ids!(settings_overlay))
            .set_visible(cx, settings_open);
        self.ui
            .view(cx, ids!(model_picker_popover))
            .set_visible(cx, picker_open);
        // The model picker list depends on
        // `state.available_model_list`, so refresh it whenever
        // the picker is opened.
        if picker_open {
            self.refresh_model_picker_rows(cx);
        }
        if settings_open {
            self.refresh_provider_rows(cx);
            self.refresh_settings_model_rows(cx);
        }
        self.ui.redraw(cx);
    }

    /// Update the model picker popover rows from
    /// `state.available_model_list`. Marks the active model
    /// with a check mark (suffix "(active)").
    fn refresh_model_picker_rows(&mut self, cx: &mut Cx) {
        // We can't easily reach into the PortalList's items
        // from the script side without a custom widget. The
        // model picker popover is a future-pass enhancement; the
        // Settings modal already shows the same list and is
        // the canonical picker for this pass.
        let _ = cx;
    }

    /// Update the Settings modal's provider list rows.
    fn refresh_provider_rows(&mut self, cx: &mut Cx) {
        let (current, _total) = {
            let state = GUI_STATE.read().unwrap();
            (state.current_provider.clone(), state.available_model_list.len())
        };
        // We use a single "show all known providers" list. The
        // active provider is marked with a `●` prefix; others
        // show `○`. (Future pass: add per-provider auth-status
        // detection by calling a `provider_status:<name>` debug
        // command, but the simple show-all list is enough for
        // this pass.)
        let providers = [
            "claude",
            "openai",
            "openrouter",
            "copilot",
            "gemini",
            "cursor",
            "antigravity",
            "ollama",
        ];
        for (idx, name) in providers.iter().enumerate() {
            let label_id = match idx {
                0 => ids!(provider_row_0),
                1 => ids!(provider_row_1),
                2 => ids!(provider_row_2),
                3 => ids!(provider_row_3),
                4 => ids!(provider_row_4),
                5 => ids!(provider_row_5),
                6 => ids!(provider_row_6),
                7 => ids!(provider_row_7),
                _ => continue,
            };
            let marker = if name == &current.as_str() { "●" } else { "○" };
            let text = format!("{}  {}", marker, name);
            // The label id is unique to each row's
            // `provider_name_label`, which is a child of the row
            // template. We reach for it via the parent widget
            // id path.
            self.ui
                .widget(cx, label_id)
                .label(cx, ids!(provider_name_label))
                .set_text(cx, &text);
        }
    }

    /// Update the Settings modal's model list rows.
    fn refresh_settings_model_rows(&mut self, cx: &mut Cx) {
        let models = {
            let state = GUI_STATE.read().unwrap();
            state.available_model_list.clone()
        };
        let n = models.len().min(8);
        for i in 0..n {
            let row_id = match i {
                0 => ids!(model_row_0),
                1 => ids!(model_row_1),
                2 => ids!(model_row_2),
                3 => ids!(model_row_3),
                4 => ids!(model_row_4),
                5 => ids!(model_row_5),
                6 => ids!(model_row_6),
                7 => ids!(model_row_7),
                _ => continue,
            };
            self.ui
                .widget(cx, row_id)
                .label(cx, ids!(model_name_label))
                .set_text(cx, &models[i]);
        }
    }

    /// Accept the currently highlighted slash suggestion. If the
    /// suggestion is a server-action slash command (e.g. `/clear`,
    /// `/refresh`), dispatch it to the server. Otherwise paste the
    /// command name into the composer.
    fn accept_slash_suggestion(&mut self, cx: &mut Cx) -> bool {
        let cmd = {
            let state = GUI_STATE.read().unwrap();
            state
                .slash_suggestions
                .get(state.slash_selected)
                .map(|(c, _)| c.clone())
        };
        let Some(cmd) = cmd else {
            return false;
        };
        // Map known server-action slashes to GuiCommands. Anything
        // we don't recognise here stays as a chat-style message
        // for the user to press Enter on.
        let dispatched = match cmd.as_str() {
            "/clear" => {
                let _ = self.send_command(GuiCommand::Clear);
                true
            }
            "/refresh" => {
                let _ = self.send_command(GuiCommand::RefreshModels);
                true
            }
            "/reload" => {
                let _ = self.send_command(GuiCommand::Reload);
                true
            }
            _ => false,
        };
        if dispatched {
            Self::with_state_mut(|s| {
                s.slash_suggestions.clear();
                s.slash_selected = 0;
            });
            self.ui.redraw(cx);
            return true;
        }
        // Not a server action — paste the command into the input
        // and let the user press Enter to send it.
        let input = self.ui.text_input(cx, ids!(composer_input));
        input.set_text(cx, &cmd);
        Self::with_state_mut(|s| {
            s.slash_suggestions.clear();
            s.slash_selected = 0;
        });
        self.ui.redraw(cx);
        true
    }

    /// Accept the currently highlighted file suggestion and append
    /// it after the `@` in the composer.
    fn accept_file_suggestion(&mut self, cx: &mut Cx) -> bool {
        let file_name = {
            let state = GUI_STATE.read().unwrap();
            state
                .file_suggestions
                .get(state.file_selected)
                .cloned()
        };
        let Some(file_name) = file_name else {
            return false;
        };
        let input = self.ui.text_input(cx, ids!(composer_input));
        let current = input.text();
        if let Some(at_pos) = current.rfind('@') {
            let prefix = &current[..at_pos];
            let replacement = format!("{}@{}", prefix, file_name);
            input.set_text(cx, &replacement);
        }
        Self::with_state_mut(|s| {
            s.file_suggestions.clear();
            s.file_selected = 0;
        });
        self.ui.redraw(cx);
        true
    }

    /// Recompute slash/file suggestions from `text` and store them
    /// in `GUI_STATE`.
    fn update_suggestions(&self, text: &str) {
        const MAX: usize = 8;
        let slash: Vec<(String, String)> = composer::slash_suggestions(text, MAX)
            .into_iter()
            .map(|(cmd, desc)| (cmd.to_string(), desc.to_string()))
            .collect();

        let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let files = if let Some(query) = composer::at_file_query(text) {
            composer::file_suggestions(&cwd, query, MAX)
        } else {
            Vec::new()
        };

        Self::with_state_mut(|state| {
            if state.slash_selected >= slash.len() {
                state.slash_selected = 0;
            }
            state.slash_suggestions = slash;

            if state.file_selected >= files.len() {
                state.file_selected = 0;
            }
            state.file_suggestions = files;
        });
    }
}

impl MatchEvent for App {
    fn handle_startup(&mut self, cx: &mut Cx) {
        // The worker task drives the in-process server. It:
        //   1. constructs the default provider;
        //   2. boots `GuiBackend::start` (which spawns the server
        //      worker thread, builds the InprocClient on the
        //      worker's tokio runtime, and ships it back via
        //      `std::sync::mpsc`);
        //   3. sends the initial Subscribe + GetHistory;
        //   4. drains `cmd_rx` for the lifetime of the GUI and
        //      forwards each `GuiCommand` to the InprocClient.
        let (init_tx, init_rx) = oneshot::channel::<Result<Arc<GuiBackend>, anyhow::Error>>();
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<GuiCommand>();
        let _ = cx.spawner().spawn(async move {
            // `GuiBackend::start` is sync but blocking; run it on
            // a separate std::thread so we don't hold up the
            // Makepad executor. Ship the result back via a
            // `std::sync::mpsc` channel that we poll with a
            // yield-based busy wait (Makepad's executor has no
            // blocking primitive, but the work finishes in
            // well under a second so this is fine for startup).
            let (rt_tx, rt_rx) = std::sync::mpsc::channel::<Result<Arc<GuiBackend>, anyhow::Error>>();
            std::thread::spawn(move || {
                let _ = rt_tx.send(GuiBackend::start(Self::default_provider()));
            });
            let backend = loop {
                match rt_rx.try_recv() {
                    Ok(v) => break v,
                    Err(std::sync::mpsc::TryRecvError::Empty) => {
                        // Yield to the executor so the UI stays
                        // responsive. A single `cx.spawner` yield
                        // via `tokio::task::yield_now` is not
                        // available here; instead, sleep briefly
                        // and re-check. 10ms is short enough to
                        // be invisible to the user on startup
                        // (the backend typically finishes in
                        // <50ms).
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        break Err(anyhow::anyhow!(
                            "GuiBackend startup thread died before producing a result"
                        ));
                    }
                }
            };
            let backend = match backend {
                Ok(b) => b,
                Err(e) => {
                    let _ = init_tx.send(Err(e));
                    return;
                }
            };
            // Send the initial Subscribe + GetHistory through the
            // shared `Mutex<InprocClient>`.
            {
                let mut client = backend.client.lock().await;
                if let Err(e) = client.subscribe().await {
                    jcode_app_core::logging::warn(&format!(
                        "jcode-gui: initial subscribe failed: {e}"
                    ));
                }
                if let Err(e) = client.get_history_event().await {
                    jcode_app_core::logging::warn(&format!(
                        "jcode-gui: initial get_history failed: {e}"
                    ));
                }
            }
            let _ = init_tx.send(Ok(backend.clone()));
            while let Some(cmd) = cmd_rx.recv().await {
                let mut client = backend.client.lock().await;
                if let Err(e) = dispatch_command(&mut client, cmd).await {
                    jcode_app_core::logging::warn(&format!(
                        "jcode-gui: command dispatch failed: {e}"
                    ));
                }
            }
        });

        self.backend.cmd_tx = Some(cmd_tx);
        self.backend.backend_init_rx = Some(init_rx);

        // Initial layout: sidebar visible, icon rail hidden,
        // welcome view visible (no messages yet). The send
        // button starts as "↑" (Idle).
        self.update_layout_visibility(cx);
        self.update_send_button_label(cx);
        self.update_header_labels(cx);
        self.ui.redraw(cx);
    }

    fn handle_actions(&mut self, cx: &mut Cx, actions: &Actions) {
        // ── Pump backend events on every action dispatch ─────────────
        self.poll_backend_init(cx);
        if self.drain_backend_events() {
            self.update_header_labels(cx);
            self.update_send_button_label(cx);
            self.update_layout_visibility(cx);
            self.ui.redraw(cx);
        }

        // ── Top bar: sidebar toggle ───────────────────────────────
        if self.ui.button(cx, ids!(sidebar_toggle)).clicked(actions) {
            self.toggle_sidebar(cx);
        }
        // Same widget id path; the icon-rail's `expand_button`
        // also opens the sidebar when collapsed.
        if self.ui.button(cx, ids!(expand_button)).clicked(actions) {
            self.toggle_sidebar(cx);
        }

        // ── New chat buttons (sidebar + icon rail) ──────────────────
        if self.ui.button(cx, ids!(new_chat_button)).clicked(actions)
            || self.ui.button(cx, ids!(new_chat_rail)).clicked(actions)
        {
            // `Clear` removes the conversation history; the
            // server will push an empty `History` back, which
            // re-derives the welcome view.
            let _ = self.send_command(GuiCommand::Clear);
        }

        // ── Welcome suggestion cards ─────────────────────────────────
        if self.ui.view(cx, ids!(suggestion_1)).finger_up(actions).is_some() {
            self.on_suggestion_click(cx, 0);
        }
        if self.ui.view(cx, ids!(suggestion_2)).finger_up(actions).is_some() {
            self.on_suggestion_click(cx, 1);
        }
        if self.ui.view(cx, ids!(suggestion_3)).finger_up(actions).is_some() {
            self.on_suggestion_click(cx, 2);
        }

        // Send / Stop on button click.
        if self.ui.button(cx, ids!(send_button)).clicked(actions) {
            self.on_send_or_stop_click(cx);
        }

        let composer = self.ui.text_input(cx, ids!(composer_input));

        if let Some(key_event) = composer.key_down_unhandled(actions) {
            let (has_slash, slash_len, has_file, file_len) = {
                let state = GUI_STATE.read().unwrap();
                (
                    !state.slash_suggestions.is_empty(),
                    state.slash_suggestions.len(),
                    !state.file_suggestions.is_empty(),
                    state.file_suggestions.len(),
                )
            };
            match key_event.key_code {
                KeyCode::ArrowUp if has_slash => {
                    Self::with_state_mut(|state| {
                        state.slash_selected = state
                            .slash_selected
                            .checked_sub(1)
                            .unwrap_or(slash_len - 1);
                    });
                    self.ui.redraw(cx);
                }
                KeyCode::ArrowDown if has_slash => {
                    Self::with_state_mut(|state| {
                        state.slash_selected = (state.slash_selected + 1) % slash_len;
                    });
                    self.ui.redraw(cx);
                }
                KeyCode::ArrowUp if has_file => {
                    Self::with_state_mut(|state| {
                        state.file_selected =
                            state.file_selected.checked_sub(1).unwrap_or(file_len - 1);
                    });
                    self.ui.redraw(cx);
                }
                KeyCode::ArrowDown if has_file => {
                    Self::with_state_mut(|state| {
                        state.file_selected = (state.file_selected + 1) % file_len;
                    });
                    self.ui.redraw(cx);
                }
                KeyCode::Tab if has_slash => {
                    self.accept_slash_suggestion(cx);
                }
                KeyCode::Tab if has_file => {
                    self.accept_file_suggestion(cx);
                }
                KeyCode::Escape => {
                    Self::with_state_mut(|s| {
                        s.slash_suggestions.clear();
                        s.slash_selected = 0;
                        s.file_suggestions.clear();
                        s.file_selected = 0;
                    });
                    self.ui.redraw(cx);
                }
                _ => {}
            }
        }

        if composer.escaped(actions) {
            Self::with_state_mut(|s| {
                s.slash_suggestions.clear();
                s.slash_selected = 0;
                s.file_suggestions.clear();
                s.file_selected = 0;
            });
            self.ui.redraw(cx);
        }

        if composer.returned(actions).is_some()
            && !self.accept_slash_suggestion(cx)
            && !self.accept_file_suggestion(cx)
        {
            self.send_message(cx);
            self.update_header_labels(cx);
        }

        if let Some(text) = composer.changed(actions) {
            let mode = ComposerMode::detect(&text);
            self.ui
                .label(cx, ids!(mode_label))
                .set_text(cx, mode.mode_hint());
            self.update_suggestions(&text);
            self.ui.redraw(cx);
        }
    }
}

impl AppMain for App {
    fn script_mod(vm: &mut ScriptVm) -> ScriptValue {
        makepad_widgets::script_mod(vm);
        self::script_mod(vm)
    }

    fn handle_event(&mut self, cx: &mut Cx, event: &Event) {
        // Pump backend state on every event (including non-input
        // events like timer ticks) so the UI is always live.
        self.poll_backend_init(cx);
        if self.drain_backend_events() {
            self.update_header_labels(cx);
            self.update_send_button_label(cx);
            self.update_layout_visibility(cx);
            self.ui.redraw(cx);
        }
        self.match_event(cx, event);
        self.ui.handle_event(cx, event, &mut Scope::empty());
    }
}

// ── Free helpers ───────────────────────────────────────────────────────────

/// Async dispatcher: take a `GuiCommand` and forward it to the right
/// `InprocClient` method. Runs on the worker task that owns the
/// shared `Mutex<InprocClient>` (so the `&mut client` is unique for
/// the duration of the call).
async fn dispatch_command(client: &mut InprocClient, cmd: GuiCommand) -> Result<(), String> {
    match cmd {
        GuiCommand::SendMessage(text) => client
            .send_message(&text)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        GuiCommand::SoftInterrupt(content, urgent) => client
            .soft_interrupt(&content, urgent)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        GuiCommand::Cancel(id) => client
            .cancel(id)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        GuiCommand::Clear => client
            .clear()
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        GuiCommand::SetModel(model) => client
            .set_model(&model)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        GuiCommand::SetProvider(provider) => client
            .set_provider(&provider)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        GuiCommand::CycleModel(dir) => client
            .cycle_model(dir)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        GuiCommand::RefreshModels => client
            .refresh_models()
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        GuiCommand::AvailableModels => client
            .available_models()
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        GuiCommand::ResumeSession(id) => client
            .resume_session_with_options(&id, false, false)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        GuiCommand::Reload => client
            .reload()
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
    }
}

