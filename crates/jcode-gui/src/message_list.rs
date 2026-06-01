//! Central message list — shows conversation bubbles for the active session.
//!
//! Each `GuiMessage` is rendered as a card/bubble with:
//!   • a coloured role label (You / Agent / System / Tool / Error …)
//!   • message content text
//!   • optional tool-call badges for assistant messages
//!   • optional agent attribution for swarm messages
//!
//! User messages are right-aligned; all others are left-aligned.

use makepad_widgets::*;

use crate::gui_state::{GuiMessage, MessageRole};
use crate::theme;

live_design! {
    use link::theme::*;
    use link::shaders::*;
    use makepad_widgets::base::*;

    // ── Individual message bubble ────────────────────────────────────────────
    MessageBubble = {{MessageBubble}} {
        width: Fill,
        height: Fit,
        flow: Down,
        padding: { top: 6.0, bottom: 6.0, left: 14.0, right: 14.0 }

        meta_row = <View> {
            width: Fill,
            height: Fit,
            flow: Right,
            padding: { bottom: 4.0 }
            align: { y: 0.5 }

            role_label = <Label> {
                width: Fit,
                height: Fit,
                draw_text: {
                    color: #8ab4f8,
                    text_style: { font_size: 11.0, font_weight: 600.0 }
                }
                text: "Agent"
            }

            agent_name_label = <Label> {
                width: Fit,
                height: Fit,
                padding: { left: 8.0 }
                draw_text: {
                    color: #8c8c9b,
                    text_style: { font_size: 10.5 }
                }
                text: ""
            }

            duration_label = <Label> {
                width: Fill,
                height: Fit,
                padding: { left: 8.0 }
                draw_text: {
                    color: #8c8c9b,
                    text_style: { font_size: 10.5 }
                }
                text: ""
            }
        }

        bubble_bg = <RoundedView> {
            width: Fill,
            height: Fit,
            padding: { top: 8.0, bottom: 8.0, left: 12.0, right: 12.0 }
            draw_bg: {
                color: #26293700,
                border_radius: 8.0
            }

            content_label = <Label> {
                width: Fill,
                height: Fit,
                draw_text: {
                    color: #dcdce6,
                    text_style: { font_size: 13.0, line_spacing: 1.5 }
                }
                text: ""
            }
        }

        tool_calls_view = <View> {
            width: Fill,
            height: Fit,
            flow: Down,
            padding: { top: 4.0 }
        }
    }

    // ── Tool call badge ───────────────────────────────────────────────────────
    ToolCallBadge = {{ToolCallBadge}} {
        width: Fit,
        height: Fit,
        margin: { bottom: 2.0 }
        padding: { top: 3.0, bottom: 3.0, left: 8.0, right: 8.0 }
        draw_bg: {
            color: #23361e00,
            border_radius: 4.0
        }

        label = <Label> {
            width: Fit,
            height: Fit,
            draw_text: {
                color: #78c88c,
                text_style: { font_size: 11.0 }
            }
            text: ""
        }
    }

    // ── Scroll wrapper ────────────────────────────────────────────────────────
    pub MessageListPanel = {{MessageListPanel}} {
        width: Fill,
        height: Fill,
        flow: Down,
        draw_bg: { color: #14141800 }

        // Typing / processing indicator
        processing_bar = <View> {
            width: Fill,
            height: Fit,
            visible: false,
            padding: { top: 6.0, bottom: 6.0, left: 16.0, right: 16.0 }
            draw_bg: { color: #1e1e2400 }

            processing_label = <Label> {
                width: Fit,
                height: Fit,
                draw_text: {
                    color: #8ab4f8,
                    text_style: { font_size: 12.0 }
                }
                text: "Agent is thinking…"
            }
        }

        list_scroll = <ScrollYView> {
            width: Fill,
            height: Fill,

            list = <PortalList> {
                width: Fill,
                height: Fill,
                drag_scrolling: true,
                auto_tail: true,
                MessageBubble = <MessageBubble> {}
            }
        }
    }
}

// ── ToolCallBadge ─────────────────────────────────────────────────────────────

#[derive(Live, LiveHook, Widget)]
pub struct ToolCallBadge {
    #[deref]
    view: View,
}

impl Widget for ToolCallBadge {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }

    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        self.view.draw_walk(cx, scope, walk)
    }
}

impl ToolCallBadge {
    pub fn set_text(&mut self, cx: &mut Cx, text: &str) {
        self.label(id!(label)).set_text(cx, text);
    }
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

#[derive(Live, LiveHook, Widget)]
pub struct MessageBubble {
    #[deref]
    view: View,
    #[rust]
    message_id: u64,
}

impl Widget for MessageBubble {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }

    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        self.view.draw_walk(cx, scope, walk)
    }
}

impl MessageBubble {
    pub fn set_message(&mut self, cx: &mut Cx, msg: &GuiMessage) {
        self.message_id = msg.id;

        // Role label text & colour
        let role_label = msg.role.label();
        self.label(id!(meta_row.role_label)).set_text(cx, role_label);

        let role_color = match &msg.role {
            MessageRole::User => theme::fg_user(),
            MessageRole::Assistant => theme::fg_accent(),
            MessageRole::System => theme::fg_system(),
            MessageRole::Tool => theme::fg_tool(),
            MessageRole::Error => theme::fg_error(),
            MessageRole::BackgroundTask => theme::fg_dim(),
            MessageRole::Usage => theme::fg_dim(),
        };
        self.label(id!(meta_row.role_label)).apply_over(
            cx,
            live! { draw_text: { color: (role_color) } },
        );

        // Agent name (swarm messages)
        let agent_name = msg.agent_name.as_deref().unwrap_or("");
        self.label(id!(meta_row.agent_name_label))
            .set_text(cx, agent_name);

        // Duration
        let duration = match msg.duration_secs {
            Some(d) if d > 0.5 => format!("{:.1}s", d),
            _ => String::new(),
        };
        self.label(id!(meta_row.duration_label))
            .set_text(cx, &duration);

        // Content
        self.label(id!(bubble_bg.content_label))
            .set_text(cx, &msg.content);

        // Bubble background colour per role
        let bubble_bg = match &msg.role {
            MessageRole::User => theme::bg_user(),
            MessageRole::Assistant => theme::bg_assistant(),
            MessageRole::System => theme::bg_system(),
            MessageRole::Tool => theme::bg_tool(),
            MessageRole::Error => theme::bg_error(),
            _ => theme::bg_chat(),
        };
        self.view(id!(bubble_bg)).apply_over(
            cx,
            live! { draw_bg: { color: (bubble_bg) } },
        );
    }
}

// ── MessageListPanel ──────────────────────────────────────────────────────────

#[derive(Clone, Debug, DefaultNone)]
pub enum MessageListAction {
    None,
}

#[derive(Live, LiveHook, Widget)]
pub struct MessageListPanel {
    #[deref]
    view: View,
    #[rust]
    messages: Vec<GuiMessage>,
    #[rust]
    is_processing: bool,
    #[rust]
    current_tool: Option<String>,
}

impl Widget for MessageListPanel {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }

    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        // Update processing bar visibility
        let processing_text = if self.is_processing {
            if let Some(tool) = &self.current_tool {
                format!("Agent is using {tool}…")
            } else {
                "Agent is thinking…".to_string()
            }
        } else {
            String::new()
        };

        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            if let Some(processing_bar) = item.as_view().borrow().as_ref().map(|_| ()) {
                let _ = processing_bar;
                // Handled via apply_over below
            }

            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                list.set_item_range(cx, 0, self.messages.len());
                while let Some((index, item)) = list.next_visible_item(cx) {
                    if index < self.messages.len() {
                        let msg = &self.messages[index];
                        if let Some(mut bubble) = item.as_widget(live_id!(MessageBubble)).borrow_mut() {
                            bubble.set_message(cx, msg);
                        }
                        item.draw_all(cx, scope);
                    }
                }
            }
        }

        // Processing bar
        self.view(id!(processing_bar)).apply_over(
            cx,
            live! { visible: (self.is_processing) },
        );
        if self.is_processing {
            self.label(id!(processing_bar.processing_label))
                .set_text(cx, &processing_text);
        }

        DrawStep::done()
    }
}

impl MessageListPanel {
    pub fn set_messages(&mut self, cx: &mut Cx, messages: Vec<GuiMessage>) {
        self.messages = messages;
        self.redraw(cx);
    }

    pub fn push_message(&mut self, cx: &mut Cx, msg: GuiMessage) {
        self.messages.push(msg);
        self.redraw(cx);
    }

    pub fn set_processing(&mut self, cx: &mut Cx, is_processing: bool, tool: Option<String>) {
        self.is_processing = is_processing;
        self.current_tool = tool;
        self.redraw(cx);
    }

    pub fn clear(&mut self, cx: &mut Cx) {
        self.messages.clear();
        self.redraw(cx);
    }
}
