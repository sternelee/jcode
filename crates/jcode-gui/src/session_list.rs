//! Session list panel — left sidebar showing sessions and swarm groups.
//!
//! Displays each `SessionEntry` as a row with:
//!   • an icon (· for single sessions, ★ for swarm groups)
//!   • the session title
//!   • a short preview of the last message
//!   • an unread badge when applicable
//!
//! Clicking a row emits `SessionListAction::Selected { session_id }` so the
//! parent `App` can switch the active session.

use makepad_widgets::*;

use crate::gui_state::{SessionKind, GUI_STATE};

/// Action emitted when the user clicks a session row.
#[derive(Clone, Debug, Default)]
pub enum SessionListAction {
    Selected { session_id: String },
    #[default]
    None,
}

/// Left-panel session list widget backed by a `PortalList`.
#[derive(Script, ScriptHook, Widget)]
pub struct SessionListWidget {
    #[deref]
    view: View,
}

impl Widget for SessionListWidget {
    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        let state = GUI_STATE.read().unwrap();

        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                let count = state.sessions.len();
                list.set_item_range(cx, 0, count);

                while let Some(idx) = list.next_visible_item(cx) {
                    if let Some(entry) = state.sessions.get(idx) {
                        let is_swarm = matches!(&entry.kind, SessionKind::SwarmGroup { .. });
                        let template = if is_swarm { id!(SwarmRow) } else { id!(SessionRow) };
                        let (item_widget, _) = list.item_with_existed(cx, idx, template);

                        // Icon + title
                        let title_text = format!("{} {}", entry.icon(), entry.title);
                        item_widget.label(cx, ids!(title_label)).set_text(cx, &title_text);
                        item_widget.label(cx, ids!(preview_label)).set_text(cx, &entry.preview);

                        // Unread badge
                        let badge_vis = entry.unread > 0;
                        item_widget.view(cx, ids!(badge_view)).set_visible(cx, badge_vis);
                        if badge_vis {
                            item_widget
                                .label(cx, ids!(badge_label))
                                .set_text(cx, &entry.unread.to_string());
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
