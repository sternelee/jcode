//! Slash-command autocomplete popup widget.
//!
//! Rendered as a compact list above the composer input.  The list entries and
//! the currently-selected index are read from [`GUI_STATE`].

use makepad_widgets::*;

use crate::gui_state::GUI_STATE;

/// Slash-command suggestion popup backed by a `PortalList`.
#[derive(Script, ScriptHook, Widget)]
pub struct SlashPopupWidget {
    #[deref]
    view: View,
}

impl Widget for SlashPopupWidget {
    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        let state = GUI_STATE.read().unwrap();
        let suggestions = &state.slash_suggestions;
        let selected = state.slash_selected;
        let count = suggestions.len();

        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                list.set_item_range(cx, 0, count);
                while let Some(idx) = list.next_visible_item(cx) {
                    if let Some((cmd, desc)) = suggestions.get(idx) {
                        let template = if idx == selected {
                            id!(SlashRowSelected)
                        } else {
                            id!(SlashRow)
                        };
                        let (item_widget, _) = list.item_with_existed(cx, idx, template);
                        item_widget
                            .label(cx, ids!(slash_cmd_label))
                            .set_text(cx, cmd);
                        item_widget
                            .label(cx, ids!(slash_desc_label))
                            .set_text(cx, desc);
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
