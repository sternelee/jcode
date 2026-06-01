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

use crate::gui_state::{SessionEntry, SessionKind};
use crate::theme;

live_design! {
    use link::theme::*;
    use link::shaders::*;
    use makepad_widgets::base::*;

    // ── Row item ─────────────────────────────────────────────────────────────
    SessionRowItem = {{SessionRowItem}} {
        width: Fill,
        height: Fit,

        padding: { top: 8.0, bottom: 8.0, left: 12.0, right: 8.0 }

        icon_label = <Label> {
            width: 20.0,
            height: Fit,
            draw_text: { color: #8ab4f8 }
            text: "·"
        }

        body = <View> {
            width: Fill,
            height: Fit,
            flow: Down,
            padding: { left: 8.0 }

            title_label = <Label> {
                width: Fill,
                height: Fit,
                draw_text: {
                    color: #dcdce6,
                    text_style: { font_size: 13.5 }
                }
                text: "Session"
            }

            preview_label = <Label> {
                width: Fill,
                height: Fit,
                draw_text: {
                    color: #8c8c9b,
                    text_style: { font_size: 11.5 }
                }
                text: ""
            }
        }

        unread_badge = <Label> {
            width: Fit,
            height: Fit,
            padding: { left: 6.0, right: 6.0, top: 2.0, bottom: 2.0 }
            draw_text: {
                color: #1a1a1e,
                text_style: { font_size: 10.5 }
            }
            draw_bg: {
                color: #8ab4f8
                border_radius: 8.0
            }
            text: ""
        }
    }

    // ── Scroll container ──────────────────────────────────────────────────────
    pub SessionListPanel = {{SessionListPanel}} {
        width: 280.0,
        height: Fill,
        flow: Down,

        draw_bg: { color: #20202600 }

        header = <View> {
            width: Fill,
            height: Fit,
            padding: { top: 12.0, bottom: 8.0, left: 16.0, right: 8.0 }
            align: { y: 0.5 }

            title = <Label> {
                width: Fill,
                height: Fit,
                draw_text: {
                    color: #dcdce6,
                    text_style: { font_size: 15.0, font_weight: 700.0 }
                }
                text: "Sessions"
            }

            new_btn = <Button> {
                width: Fit,
                height: Fit,
                padding: { left: 8.0, right: 8.0, top: 4.0, bottom: 4.0 }
                draw_text: { color: #8ab4f8 }
                text: "+"
            }
        }

        list_scroll = <ScrollYView> {
            width: Fill,
            height: Fill,

            list = <PortalList> {
                width: Fill,
                height: Fill,
                drag_scrolling: true,
                SessionRowItem = <SessionRowItem> {}
            }
        }
    }
}

// ── Actions ───────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, DefaultNone)]
pub enum SessionListAction {
    Selected { session_id: String },
    NewSession,
    None,
}

// ── Row widget ────────────────────────────────────────────────────────────────

#[derive(Live, LiveHook, Widget)]
pub struct SessionRowItem {
    #[deref]
    view: View,
    #[rust]
    session_id: String,
}

impl Widget for SessionRowItem {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
        if let Hit::FingerUp(fu) = event.hits(cx, self.view.area()) {
            if fu.was_tap() {
                cx.widget_action(
                    self.widget_uid(),
                    &scope.path,
                    SessionListAction::Selected {
                        session_id: self.session_id.clone(),
                    },
                );
            }
        }
    }

    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        self.view.draw_walk(cx, scope, walk)
    }
}

impl SessionRowItem {
    pub fn set_entry(&mut self, cx: &mut Cx, entry: &SessionEntry, is_selected: bool) {
        self.session_id = entry.id.clone();

        // Icon
        let icon = entry.icon();
        self.label(id!(icon_label)).set_text(cx, icon);

        // Title
        self.label(id!(body.title_label)).set_text(cx, &entry.title);

        // Preview
        let preview = if entry.preview.len() > 60 {
            format!("{}…", &entry.preview[..60])
        } else {
            entry.preview.clone()
        };
        self.label(id!(body.preview_label)).set_text(cx, &preview);

        // Unread badge
        let badge = if entry.unread > 0 {
            entry.unread.to_string()
        } else {
            String::new()
        };
        self.label(id!(unread_badge)).set_text(cx, &badge);

        // Background highlight for selected row
        // (Makepad's draw_bg color can be set via apply_over)
        let bg_color = if is_selected {
            theme::bg_selected()
        } else {
            theme::bg_panel()
        };
        self.apply_over(
            cx,
            live! { draw_bg: { color: (bg_color) } },
        );
    }
}

// ── Panel widget ──────────────────────────────────────────────────────────────

#[derive(Live, LiveHook, Widget)]
pub struct SessionListPanel {
    #[deref]
    view: View,
    /// Cached entries — updated by App when session list changes.
    #[rust]
    entries: Vec<SessionEntry>,
    #[rust]
    selected_id: Option<String>,
}

impl Widget for SessionListPanel {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);

        // Forward new-session button press
        if self.button(id!(header.new_btn)).clicked(cx) {
            cx.widget_action(
                self.widget_uid(),
                &scope.path,
                SessionListAction::NewSession,
            );
        }

        // Handle list actions from child rows (bubble up)
        let widget_uid = self.widget_uid();
        for action in cx.capture_actions(|cx| self.view.handle_event(cx, event, scope)) {
            if let SessionListAction::Selected { .. } = action.as_widget_action().cast() {
                cx.widget_action(widget_uid, &scope.path, action.as_widget_action().cast::<SessionListAction>());
            }
        }
    }

    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                list.set_item_range(cx, 0, self.entries.len());
                while let Some((index, item)) = list.next_visible_item(cx) {
                    if index < self.entries.len() {
                        let entry = &self.entries[index];
                        let is_selected = self.selected_id.as_deref() == Some(&entry.id);
                        let mut row = item.as_widget(live_id!(SessionRowItem));
                        row.borrow_mut()
                            .unwrap()
                            .set_entry(cx, entry, is_selected);
                        item.draw_all(cx, scope);
                    }
                }
            }
        }
        DrawStep::done()
    }
}

impl SessionListPanel {
    pub fn set_entries(&mut self, cx: &mut Cx, entries: Vec<SessionEntry>) {
        self.entries = entries;
        self.redraw(cx);
    }

    pub fn set_selected(&mut self, cx: &mut Cx, id: Option<String>) {
        self.selected_id = id;
        self.redraw(cx);
    }
}
