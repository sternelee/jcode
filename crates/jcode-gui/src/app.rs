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
use crate::composer::{self, ComposerMode};
use crate::file_popup::FilePopupWidget;
use crate::gui_state::{
    GuiMessage, GuiSwarmMember, MessageRole, ProcessingStatus, SessionEntry, SessionKind, GUI_STATE,
};
use crate::message_list::MessageListWidget;
use crate::session_list::SessionListWidget;
use crate::slash_popup::SlashPopupWidget;
use crate::swarm_board::SwarmBoardWidget;

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
}

impl App {
    fn populate_demo_state() {
        let mut state = GUI_STATE.write().unwrap();

        // Model / usage info
        state.model_name = "claude-opus-4-5".into();
        state.session_tokens = Some((12_400, 3_800));

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
            tool_calls: vec!["read_file".into(), "grep".into()],
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
        state.messages.push(GuiMessage {
            id: 4,
            role: MessageRole::Assistant,
            content: "Found 2 potential issues: (1) JWT secret stored in env without validation, (2) tokens not rotated on privilege escalation.".into(),
            agent_id: None,
            agent_name: None,
            tool_calls: vec![],
            tool_data: None,
            duration_secs: Some(3.2),
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
            status: jcode_swarm_core::SwarmLifecycleStatus::Done,
            detail: Some("Completed token rotation".into()),
            is_coordinator: false,
            status_age_secs: Some(120),
        });
        state.swarm_members.push(GuiSwarmMember {
            session_id: "agent-3".into(),
            name: "Agent-γ".into(),
            role: jcode_swarm_core::SwarmRole::Agent,
            status: jcode_swarm_core::SwarmLifecycleStatus::Ready,
            detail: Some("Awaiting task assignment".into()),
            is_coordinator: false,
            status_age_secs: Some(5),
        });

        // Demo plan tasks (kanban board)
        use crate::gui_state::{KanbanColumn, PlanTaskCard};
        state.plan_tasks.push(PlanTaskCard {
            id: "t1".into(),
            title: "Validate JWT secret at startup".into(),
            column: KanbanColumn::Running,
            assigned_to: Some("Agent-α".into()),
        });
        state.plan_tasks.push(PlanTaskCard {
            id: "t2".into(),
            title: "Add token rotation on privilege escalation".into(),
            column: KanbanColumn::Todo,
            assigned_to: None,
        });
        state.plan_tasks.push(PlanTaskCard {
            id: "t3".into(),
            title: "Write auth module tests".into(),
            column: KanbanColumn::Todo,
            assigned_to: None,
        });
        state.plan_tasks.push(PlanTaskCard {
            id: "t4".into(),
            title: "Audit token refresh endpoints".into(),
            column: KanbanColumn::Done,
            assigned_to: Some("Agent-β".into()),
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
            state.processing_status = ProcessingStatus::Thinking { elapsed_secs: 0.0 };
            // Clear all suggestion state after sending.
            state.slash_suggestions.clear();
            state.slash_selected = 0;
            state.file_suggestions.clear();
            state.file_selected = 0;
        }

        input.set_text(cx, "");
        self.ui.redraw(cx);
    }

    /// Recompute slash/file suggestions from `text` and store them in `GUI_STATE`.
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

        let mut state = GUI_STATE.write().unwrap();
        if state.slash_selected >= slash.len() {
            state.slash_selected = 0;
        }
        state.slash_suggestions = slash;

        if state.file_selected >= files.len() {
            state.file_selected = 0;
        }
        state.file_suggestions = files;
    }

    /// Accept the currently highlighted slash suggestion and insert it into the input.
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
        let input = self.ui.text_input(cx, ids!(composer_input));
        input.set_text(cx, &cmd);
        {
            let mut state = GUI_STATE.write().unwrap();
            state.slash_suggestions.clear();
            state.slash_selected = 0;
        }
        self.ui.redraw(cx);
        true
    }

    /// Accept the currently highlighted file suggestion and append it after the `@`.
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
        // Replace the text after the last '@' with the chosen file name.
        if let Some(at_pos) = current.rfind('@') {
            let prefix = &current[..at_pos];
            let replacement = format!("{}@{}", prefix, file_name);
            input.set_text(cx, &replacement);
        }
        {
            let mut state = GUI_STATE.write().unwrap();
            state.file_suggestions.clear();
            state.file_selected = 0;
        }
        self.ui.redraw(cx);
        true
    }

    /// Refresh dynamic header labels (status + token usage) from current GUI state.
    fn update_header_labels(&mut self, cx: &mut Cx) {
        let state = GUI_STATE.read().unwrap();
        let status_text = state.header_status();
        self.ui
            .label(cx, ids!(status_label))
            .set_text(cx, &status_text);

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
}

impl MatchEvent for App {
    fn handle_startup(&mut self, cx: &mut Cx) {
        App::populate_demo_state();
        self.update_header_labels(cx);
        self.ui.redraw(cx);
    }

    fn handle_actions(&mut self, cx: &mut Cx, actions: &Actions) {
        // Send on button click
        if self.ui.button(cx, ids!(send_button)).clicked(actions) {
            self.send_message(cx);
            self.update_header_labels(cx);
        }

        let composer = self.ui.text_input(cx, ids!(composer_input));

        // ── Unhandled key events from the TextInput ───────────────────────────
        // ArrowUp/ArrowDown in a single-line TextInput emit KeyDownUnhandled,
        // which we intercept here to navigate the suggestion lists.
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
                    let mut state = GUI_STATE.write().unwrap();
                    state.slash_selected = state
                        .slash_selected
                        .checked_sub(1)
                        .unwrap_or(slash_len - 1);
                    drop(state);
                    self.ui.redraw(cx);
                }
                KeyCode::ArrowDown if has_slash => {
                    let mut state = GUI_STATE.write().unwrap();
                    state.slash_selected = (state.slash_selected + 1) % slash_len;
                    drop(state);
                    self.ui.redraw(cx);
                }
                KeyCode::ArrowUp if has_file => {
                    let mut state = GUI_STATE.write().unwrap();
                    state.file_selected =
                        state.file_selected.checked_sub(1).unwrap_or(file_len - 1);
                    drop(state);
                    self.ui.redraw(cx);
                }
                KeyCode::ArrowDown if has_file => {
                    let mut state = GUI_STATE.write().unwrap();
                    state.file_selected = (state.file_selected + 1) % file_len;
                    drop(state);
                    self.ui.redraw(cx);
                }
                KeyCode::Tab if has_slash => {
                    self.accept_slash_suggestion(cx);
                }
                KeyCode::Tab if has_file => {
                    self.accept_file_suggestion(cx);
                }
                KeyCode::Escape => {
                    let mut state = GUI_STATE.write().unwrap();
                    state.slash_suggestions.clear();
                    state.slash_selected = 0;
                    state.file_suggestions.clear();
                    state.file_selected = 0;
                    drop(state);
                    self.ui.redraw(cx);
                }
                _ => {}
            }
        }

        // Escape from the TextInput widget itself
        if composer.escaped(actions) {
            let mut state = GUI_STATE.write().unwrap();
            state.slash_suggestions.clear();
            state.slash_selected = 0;
            state.file_suggestions.clear();
            state.file_selected = 0;
            drop(state);
            self.ui.redraw(cx);
        }

        // ── Enter: accept suggestion or send message ──────────────────────────
        if let Some(_returned) = composer.returned(actions) {
            // If a slash popup is open, accept it; otherwise send the message.
            if !self.accept_slash_suggestion(cx) && !self.accept_file_suggestion(cx) {
                self.send_message(cx);
                self.update_header_labels(cx);
            }
        }

        // ── Text change: update mode hint and suggestion lists ────────────────
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
        self.match_event(cx, event);
        self.ui.handle_event(cx, event, &mut Scope::empty());
    }
}
