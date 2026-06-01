//! Right-side Agent Status panel — shows swarm member cards and stats.
//!
//! Mirrors `info_widget_swarm_background.rs` from the TUI, displaying:
//!   • one card per `GuiSwarmMember` with role prefix, name, status icon, and detail
//!   • a summary stats bar (coordinator / running / done counts)

use makepad_widgets::*;

use crate::gui_state::{SwarmLifecycleStatus, GUI_STATE};

/// Right-side agent status panel backed by `PortalList`.
#[derive(Script, ScriptHook, Widget)]
pub struct AgentStatusWidget {
    #[deref]
    view: View,
}

impl Widget for AgentStatusWidget {
    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        let state = GUI_STATE.read().unwrap();
        let members = state.sorted_members();

        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                // +1 for the stats header row
                list.set_item_range(cx, 0, members.len() + 1);

                while let Some(idx) = list.next_visible_item(cx) {
                    if idx == 0 {
                        // Stats bar
                        let (item_widget, _) = list.item_with_existed(cx, idx, id!(StatsRow));
                        let total = members.len();
                        let running = members
                            .iter()
                            .filter(|m| {
                                matches!(
                                    m.status,
                                    SwarmLifecycleStatus::Running
                                        | SwarmLifecycleStatus::RunningStale
                                )
                            })
                            .count();
                        let done = members
                            .iter()
                            .filter(|m| {
                                matches!(
                                    m.status,
                                    SwarmLifecycleStatus::Completed | SwarmLifecycleStatus::Done
                                )
                            })
                            .count();
                        item_widget.label(cx, ids!(stats_label)).set_text(
                            cx,
                            &format!("Agents: {}  ▶ {}  ✓ {}", total, running, done),
                        );
                        item_widget.draw_all_unscoped(cx);
                    } else if let Some(member) = members.get(idx - 1) {
                        let template = if member.is_coordinator {
                            id!(CoordinatorCard)
                        } else {
                            id!(MemberCard)
                        };
                        let (item_widget, _) = list.item_with_existed(cx, idx, template);

                        let header = format!(
                            "{}{} {}",
                            member.role_prefix(),
                            member.name,
                            member.status_icon()
                        );
                        item_widget
                            .label(cx, ids!(member_name_label))
                            .set_text(cx, &header);

                        let detail = member.detail.as_deref().unwrap_or("");
                        item_widget
                            .label(cx, ids!(member_detail_label))
                            .set_text(cx, detail);

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
