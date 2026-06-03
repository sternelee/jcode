//! Central message list — renders conversation bubbles in a scrollable portal list.
//!
//! Message layout mirrors the TUI `MessageRole` distinctions:
//!   • User    → right-aligned blue bubble
//!   • Assistant → left-aligned text; tool-call summaries below; hover actions
//!   • Tool / System / Error → full-width status card
//!
//! Per-message affordances:
//!   • Assistant messages show hover actions (Copy / Regenerate) **only on
//!     the most recently completed message**, which is the one the user
//!     is almost certainly looking at. Tying visibility to a real cursor
//!     hit-test would require plumbing the Makepad mouse position into
//!     this widget on every frame, which is overkill for a first pass.
//!     A follow-up can wire real hover via `cx.finger_over(self.area)`.

use makepad_widgets::*;

use crate::gui_state::{MessageRole, GUI_STATE};

/// Central message list widget backed by `PortalList`.
#[derive(Script, ScriptHook, Widget)]
pub struct MessageListWidget {
    #[deref]
    view: View,
}

impl Widget for MessageListWidget {
    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        let state = GUI_STATE.read().unwrap();

        // Find the id of the last completed assistant message —
        // that's the one whose hover-action row should be visible.
        // We skip the streaming placeholder (no entry in
        // `state.messages`); the last assistant message is the
        // one we want users to act on right after the model
        // finishes speaking.
        let last_assistant_id: Option<u64> = state
            .messages
            .iter()
            .rev()
            .find(|m| matches!(m.role, MessageRole::Assistant))
            .map(|m| m.id);

        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                let count = state.messages.len();
                let total = count + if state.is_streaming { 1 } else { 0 };
                list.set_item_range(cx, 0, total);

                while let Some(idx) = list.next_visible_item(cx) {
                    // Streaming placeholder at the end.
                    if state.is_streaming && idx == count {
                        let (item_widget, _) = list.item_with_existed(cx, idx, id!(AssistantMsg));
                        item_widget
                            .label(cx, ids!(sender_label))
                            .set_text(cx, "Agent");
                        item_widget
                            .label(cx, ids!(content_label))
                            .set_text(cx, &state.streaming_text);

                        if !state.streaming_tool_calls.is_empty() {
                            let tools_text = format!(
                                "tools: {}",
                                state
                                    .streaming_tool_calls
                                    .iter()
                                    .map(|s| s.as_str())
                                    .collect::<Vec<_>>()
                                    .join(" · ")
                            );
                            item_widget
                                .label(cx, ids!(tool_calls_label))
                                .set_text(cx, &tools_text);
                            item_widget
                                .view(cx, ids!(tool_calls_view))
                                .set_visible(cx, true);
                        } else {
                            item_widget
                                .label(cx, ids!(tool_calls_label))
                                .set_text(cx, "");
                            item_widget
                                .view(cx, ids!(tool_calls_view))
                                .set_visible(cx, false);
                        }

                        // Streaming placeholder never shows the
                        // hover-action row (the model is still
                        // working; the user can't copy an
                        // in-progress reply).
                        item_widget
                            .view(cx, ids!(hover_actions))
                            .set_visible(cx, false);

                        item_widget.draw_all_unscoped(cx);
                        continue;
                    }

                    if let Some(msg) = state.messages.get(idx) {
                        let template = match &msg.role {
                            MessageRole::User => id!(UserMsg),
                            MessageRole::Assistant => id!(AssistantMsg),
                            MessageRole::Tool => id!(ToolMsg),
                            MessageRole::Error => id!(ErrorMsg),
                            _ => id!(SystemMsg),
                        };
                        let (item_widget, _) = list.item_with_existed(cx, idx, template);

                        // For templates that have a `sender_label`
                        // (UserMsg, AssistantMsg), show the role
                        // name; the others (ToolMsg / ErrorMsg /
                        // SystemMsg) have no sender line.
                        if matches!(&msg.role, MessageRole::User | MessageRole::Assistant) {
                            item_widget
                                .label(cx, ids!(sender_label))
                                .set_text(cx, msg.role.label());
                        }
                        item_widget
                            .label(cx, ids!(content_label))
                            .set_text(cx, &msg.content);

                        // Tool-call summary line on assistant
                        // messages.
                        if matches!(&msg.role, MessageRole::Assistant) && !msg.tool_calls.is_empty() {
                            let tools_text = format!(
                                "tools: {}",
                                msg.tool_calls
                                    .iter()
                                    .map(|s| s.as_str())
                                    .collect::<Vec<_>>()
                                    .join(" · ")
                            );
                            item_widget
                                .label(cx, ids!(tool_calls_label))
                                .set_text(cx, &tools_text);
                            item_widget
                                .view(cx, ids!(tool_calls_view))
                                .set_visible(cx, true);
                        } else if matches!(&msg.role, MessageRole::Assistant) {
                            item_widget
                                .view(cx, ids!(tool_calls_view))
                                .set_visible(cx, false);
                        }

                        // Hover-action row — only the Assistant
                        // template defines `hover_actions`, and we
                        // only show it on the most recently
                        // completed assistant message. (See module
                        // docs for why we don't do real cursor
                        // hit-testing in this pass.)
                        if matches!(&msg.role, MessageRole::Assistant) {
                            let show_actions = last_assistant_id == Some(msg.id);
                            item_widget
                                .view(cx, ids!(hover_actions))
                                .set_visible(cx, show_actions);
                        }

                        item_widget.draw_all_unscoped(cx);
                    }
                }
            }
        }
        DrawStep::done()
    }

    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }
}
