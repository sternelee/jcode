//! File-mention autocomplete popup widget.
//!
//! Shown when the user is typing an `@`-mention in the composer.  The list of
//! matching file names and the currently-selected index come from [`GUI_STATE`].

use makepad_widgets::*;

use crate::gui_state::GUI_STATE;

/// File-path autocomplete popup backed by a `PortalList`.
#[derive(Script, ScriptHook, Widget)]
pub struct FilePopupWidget {
    #[deref]
    view: View,
}

impl Widget for FilePopupWidget {
    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        let state = GUI_STATE.read().unwrap();
        let suggestions = &state.file_suggestions;
        let selected = state.file_selected;
        let count = suggestions.len();

        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                list.set_item_range(cx, 0, count);
                while let Some(idx) = list.next_visible_item(cx) {
                    if let Some(name) = suggestions.get(idx) {
                        let template = if idx == selected {
                            id!(FileRowSelected)
                        } else {
                            id!(FileRow)
                        };
                        let (item_widget, _) = list.item_with_existed(cx, idx, template);
                        item_widget
                            .label(cx, ids!(file_name_label))
                            .set_text(cx, name);
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
