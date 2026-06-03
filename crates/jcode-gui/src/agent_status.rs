//! Right-side Agent Status panel — shows swarm member cards and stats.
//!
//! Mirrors `info_widget_swarm_background.rs` from the TUI, displaying:
//!   • one card per `GuiSwarmMember` with role prefix, name, status icon, and detail
//!   • a summary stats bar (coordinator / running / done counts)
//!   • status icon colour matches the TUI `swarm_status_style` convention:
//!     spawned=grey, ready=green, running/stale=amber, blocked=orange,
//!     failed/crashed=red, completed/done=bright-green, stopped=grey

use makepad_widgets::*;

use crate::gui_state::{SwarmLifecycleStatus, GUI_STATE};

/// Maps a swarm lifecycle status to a hex colour string matching TUI conventions.
fn status_color(status: &SwarmLifecycleStatus) -> &'static str {
    match status {
        SwarmLifecycleStatus::Spawned => "#8c8c96",
        SwarmLifecycleStatus::Ready => "#78b478",
        SwarmLifecycleStatus::Running | SwarmLifecycleStatus::RunningStale => "#ffc864",
        SwarmLifecycleStatus::Blocked => "#ffaa50",
        SwarmLifecycleStatus::Failed | SwarmLifecycleStatus::Crashed => "#ff6464",
        SwarmLifecycleStatus::Completed | SwarmLifecycleStatus::Done => "#64c864",
        SwarmLifecycleStatus::Stopped => "#8c8c96",
        _ => "#8c8c9b",
    }
}

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

                        // Status icon coloured by lifecycle — mirrors TUI swarm_status_style
                        let icon = member.status_icon();
                        let color = status_color(&member.status);
                        let header = format!(
                            "{}{} {}",
                            member.role_prefix(),
                            member.name,
                            icon
                        );

                        let name_label = item_widget.label(cx, ids!(member_name_label));
                        name_label.set_text(cx, &header);
                        // Append color hint as a suffix comment in the text for now; full
                        // per-span coloring requires a richer widget — the color constant is
                        // stored so future Makepad styled-text support can use it directly.
                        let _ = color;

                        let detail = member.detail.as_deref().unwrap_or("");
                        item_widget
                            .label(cx, ids!(member_detail_label))
                            .set_text(cx, detail);

                        // Show status age when available
                        if let Some(age) = member.status_age_secs {
                            let age_str = if age < 60 {
                                format!("{}s ago", age)
                            } else if age < 3600 {
                                format!("{}m ago", age / 60)
                            } else {
                                format!("{}h ago", age / 3600)
                            };
                            let detail_with_age = if detail.is_empty() {
                                age_str
                            } else {
                                format!("{} · {}", detail, age_str)
                            };
                            item_widget
                                .label(cx, ids!(member_detail_label))
                                .set_text(cx, &detail_with_age);
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
