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
    CycleModel(i8),
    RefreshModels,
    ResumeSession(String),
    Reload,
}

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

            // ── Active-session variants (highlighted background) ───────────────

            SessionRowActive := RoundedView {
                width: Fill
                height: Fit
                padding: Inset{top: 8 bottom: 8 left: 12 right: 8}
                show_bg: true
                draw_bg +: { color: #2d2d37 radius: 0.0 }

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
                                text_style +: { font_size: 13 bold: true }
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
                            color: #a0a0b4
                            text_style +: { font_size: 11 }
                        }
                    }
                }
            }

            SwarmRowActive := RoundedView {
                width: Fill
                height: Fit
                padding: Inset{top: 8 bottom: 8 left: 12 right: 8}
                show_bg: true
                draw_bg +: { color: #2d2d37 radius: 0.0 }

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
                                color: #a0c8ff
                                text_style +: { font_size: 13 bold: true }
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
                            color: #a0a0b4
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

                    // Tool-call summary — mirrors TUI assistant tool call line
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
                            wrap: Word
                        }
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

        // Three column lists: todo, running, done — drawn in order by SwarmBoardWidget::draw_walk
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
                        wrap: Word
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
                        wrap: Word
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
                        wrap: Word
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
                        height: 48
                        flow: Right
                        align: Align{y: 0.5}
                        padding: Inset{left: 16 right: 16}
                        spacing: 12
                        show_bg: true
                        draw_bg +: { color: #1a1a1e }

                        // Session title (fills remaining width)
                        session_title_label := Label {
                            width: Fill
                            height: Fit
                            text: "jcode"
                            draw_text +: {
                                color: #dcdce6
                                text_style +: { font_size: 15 bold: true }
                            }
                        }

                        // Token usage (hidden when no data)
                        token_usage_label := Label {
                            width: Fit
                            height: Fit
                            text: ""
                            draw_text +: {
                                color: #6482aa
                                text_style +: { font_size: 10 }
                            }
                        }

                        // Model + processing status
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

                    // ── Header / body separator ───────────────────────────
                    View {
                        width: Fill
                        height: 1
                        show_bg: true
                        draw_bg +: { color: #2a2a34 }
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

                        // ── Left / center column separator ────────────────
                        View {
                            width: 1
                            height: Fill
                            show_bg: true
                            draw_bg +: { color: #2a2a34 }
                        }

                        // Center: messages + composer
                        View {
                            width: Fill
                            height: Fill
                            flow: Down
                            show_bg: true
                            draw_bg +: { color: #141418 }

                            message_list := MessageListWidget {}

                            // ── Slash-command suggestion popup ─────────────────
                            slash_popup := SlashPopupWidget {}

                            // ── @ file-mention suggestion popup ────────────────
                            file_popup := FilePopupWidget {}

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

                            // Mode hint — keyboard shortcuts for active mode
                            View {
                                width: Fill
                                height: Fit
                                padding: Inset{left: 12 top: 2 bottom: 4}

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

                        // ── Center / right column separator ───────────────
                        View {
                            width: 1
                            height: Fill
                            show_bg: true
                            draw_bg +: { color: #2a2a34 }
                        }

                        // Right: agent status + plan board
                        View {
                            width: 260
                            height: Fill
                            flow: Down
                            show_bg: true
                            draw_bg +: { color: #1a1a22 }

                            // ── Agents section header ──────────────────────
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

                            // ── Divider ────────────────────────────────────
                            View {
                                width: Fill
                                height: 1
                                show_bg: true
                                draw_bg +: { color: #2a2a34 }
                            }

                            // ── Plan board section header ──────────────────
                            View {
                                width: Fill
                                height: Fit
                                padding: Inset{top: 8 bottom: 8 left: 12 right: 8}

                                Label {
                                    text: "Plan"
                                    draw_text +: {
                                        color: #8c8c9b
                                        text_style +: { font_size: 11 bold: true }
                                    }
                                }
                            }

                            swarm_board := SwarmBoardWidget {}
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
    /// `JCODE_PROVIDER` / `JCODE_PROVIDER_PROFILE_NAME`. This is the
    /// simplest provider that always works without external auth
    /// (the `JcodeProvider` is the project's own aggregator). A
    /// follow-up pass wires the full env-driven `init_provider` from
    /// the CLI for parity with the TUI.
    fn default_provider() -> Arc<dyn Provider> {
        Arc::new(jcode_app_core::provider::jcode::JcodeProvider::new())
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

        if let Some(session) = state
            .active_session_id
            .as_ref()
            .and_then(|id| state.sessions.iter().find(|s| &s.id == id))
        {
            self.ui
                .label(cx, ids!(session_title_label))
                .set_text(cx, &session.title);
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

        self.update_header_labels(cx);
        self.ui.redraw(cx);
    }

    fn handle_actions(&mut self, cx: &mut Cx, actions: &Actions) {
        // ── Pump backend events on every action dispatch ─────────────
        self.poll_backend_init(cx);
        if self.drain_backend_events() {
            self.update_header_labels(cx);
            self.ui.redraw(cx);
        }

        // Send on button click
        if self.ui.button(cx, ids!(send_button)).clicked(actions) {
            self.send_message(cx);
            self.update_header_labels(cx);
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

/// Placeholder: kept for symmetry with future passes. The first
/// implementation uses the synchronous `default_provider`; a later
/// pass can wire the env-driven `provider_init` from the CLI.
#[allow(dead_code)]
async fn _self_build_provider_await_inline() -> Arc<dyn Provider> {
    Arc::new(jcode_app_core::provider::jcode::JcodeProvider::new())
}
