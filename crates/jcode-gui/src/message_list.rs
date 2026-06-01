//! Central message list — renders conversation bubbles in a scrollable portal list.
//!
//! Message layout mirrors the TUI `MessageRole` distinctions:
//!   • User    → right-aligned blue bubble
//!   • Assistant → left-aligned dark bubble (supports markdown via Makepad Markdown widget)
//!   • Tool / System / Error → full-width status card

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

        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                let count = state.messages.len();
                // +1 if we're streaming to show the in-progress bubble
                let total = count + if state.is_processing { 1 } else { 0 };
                list.set_item_range(cx, 0, total);

                while let Some(idx) = list.next_visible_item(cx) {
                    // Streaming placeholder at the end
                    if state.is_processing && idx == count {
                        let (item_widget, _) = list.item_with_existed(cx, idx, id!(AssistantMsg));
                        item_widget
                            .label(cx, ids!(sender_label))
                            .set_text(cx, "Agent");
                        item_widget
                            .label(cx, ids!(content_label))
                            .set_text(cx, "…");
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

                        let sender = msg
                            .agent_name
                            .as_deref()
                            .unwrap_or_else(|| msg.role.label());

                        item_widget
                            .label(cx, ids!(sender_label))
                            .set_text(cx, sender);
                        item_widget
                            .label(cx, ids!(content_label))
                            .set_text(cx, &msg.content);

                        if let Some(d) = msg.duration_secs {
                            let dur_text = format!("{:.1}s", d);
                            item_widget
                                .label(cx, ids!(duration_label))
                                .set_text(cx, &dur_text);
                            item_widget
                                .view(cx, ids!(duration_view))
                                .set_visible(cx, true);
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
