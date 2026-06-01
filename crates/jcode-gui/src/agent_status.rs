//! Right-panel agent/swarm status widget.
//!
//! Shows:
//!   1. Swarm statistics line (total / running / completed / failed)
//!   2. Individual agent member cards (icon + role prefix + name + status)
//!   3. Session info when not in a swarm (model, session id, token usage)

use makepad_widgets::*;

use crate::gui_state::GuiSwarmMember;
use crate::theme;
use jcode_swarm_core::SwarmLifecycleStatus;

live_design! {
    use link::theme::*;
    use link::shaders::*;
    use makepad_widgets::base::*;

    // ── Single member card ────────────────────────────────────────────────────
    MemberCard = {{MemberCard}} {
        width: Fill,
        height: Fit,
        flow: Right,
        padding: { top: 6.0, bottom: 6.0, left: 12.0, right: 8.0 }
        align: { y: 0.5 }

        status_icon = <Label> {
            width: 18.0,
            height: Fit,
            draw_text: {
                color: #78c88c,
                text_style: { font_size: 12.0 }
            }
            text: "●"
        }

        name_label = <Label> {
            width: Fill,
            height: Fit,
            padding: { left: 6.0 }
            draw_text: {
                color: #dcdce6,
                text_style: { font_size: 12.5 }
            }
            text: "agent"
        }

        detail_label = <Label> {
            width: Fit,
            height: Fit,
            draw_text: {
                color: #8c8c9b,
                text_style: { font_size: 10.5 }
            }
            text: ""
        }
    }

    // ── Stats header ──────────────────────────────────────────────────────────
    SwarmStatsBar = {{SwarmStatsBar}} {
        width: Fill,
        height: Fit,
        padding: { top: 8.0, bottom: 8.0, left: 12.0, right: 8.0 }
        flow: Right,

        total_label = <Label> {
            width: Fit,
            height: Fit,
            draw_text: {
                color: #8ab4f8,
                text_style: { font_size: 11.5 }
            }
            text: "Swarm"
        }

        stats_label = <Label> {
            width: Fill,
            height: Fit,
            padding: { left: 8.0 }
            draw_text: {
                color: #8c8c9b,
                text_style: { font_size: 11.0 }
            }
            text: ""
        }
    }

    // ── Panel ─────────────────────────────────────────────────────────────────
    pub AgentStatusPanel = {{AgentStatusPanel}} {
        width: 240.0,
        height: Fill,
        flow: Down,
        draw_bg: { color: #20202600 }

        header = <View> {
            width: Fill,
            height: Fit,
            padding: { top: 12.0, bottom: 4.0, left: 16.0, right: 8.0 }

            title = <Label> {
                width: Fill,
                height: Fit,
                draw_text: {
                    color: #dcdce6,
                    text_style: { font_size: 14.0, font_weight: 700.0 }
                }
                text: "Agents"
            }
        }

        stats_bar = <SwarmStatsBar> {}

        list_scroll = <ScrollYView> {
            width: Fill,
            height: Fill,

            list = <PortalList> {
                width: Fill,
                height: Fill,
                drag_scrolling: true,
                MemberCard = <MemberCard> {}
            }
        }

        session_info = <View> {
            width: Fill,
            height: Fit,
            flow: Down,
            padding: { top: 8.0, bottom: 8.0, left: 12.0, right: 8.0 }

            session_id_label = <Label> {
                width: Fill,
                height: Fit,
                draw_text: {
                    color: #8c8c9b,
                    text_style: { font_size: 10.5 }
                }
                text: ""
            }

            model_label = <Label> {
                width: Fill,
                height: Fit,
                draw_text: {
                    color: #8c8c9b,
                    text_style: { font_size: 10.5 }
                }
                text: ""
            }
        }
    }
}

// ── SwarmStatsBar ─────────────────────────────────────────────────────────────

#[derive(Live, LiveHook, Widget)]
pub struct SwarmStatsBar {
    #[deref]
    view: View,
}

impl Widget for SwarmStatsBar {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }

    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        self.view.draw_walk(cx, scope, walk)
    }
}

impl SwarmStatsBar {
    pub fn update(&mut self, cx: &mut Cx, members: &[GuiSwarmMember]) {
        if members.is_empty() {
            self.label(id!(stats_label)).set_text(cx, "no members");
            return;
        }
        let running = members
            .iter()
            .filter(|m| {
                matches!(
                    m.status,
                    SwarmLifecycleStatus::Running | SwarmLifecycleStatus::RunningStale
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
        let failed = members
            .iter()
            .filter(|m| matches!(m.status, SwarmLifecycleStatus::Failed | SwarmLifecycleStatus::Crashed))
            .count();

        let stats = format!(
            "{} total · {} running · {} done · {} failed",
            members.len(),
            running,
            done,
            failed
        );
        self.label(id!(stats_label)).set_text(cx, &stats);
    }
}

// ── MemberCard ────────────────────────────────────────────────────────────────

#[derive(Live, LiveHook, Widget)]
pub struct MemberCard {
    #[deref]
    view: View,
}

impl Widget for MemberCard {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }

    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        self.view.draw_walk(cx, scope, walk)
    }
}

impl MemberCard {
    pub fn set_member(&mut self, cx: &mut Cx, member: &GuiSwarmMember) {
        // Status icon + colour
        let icon = member.status_icon();
        self.label(id!(status_icon)).set_text(cx, icon);

        let icon_color = match &member.status {
            SwarmLifecycleStatus::Spawned => theme::swarm_spawned(),
            SwarmLifecycleStatus::Ready => theme::swarm_ready(),
            SwarmLifecycleStatus::Running | SwarmLifecycleStatus::RunningStale => theme::swarm_running(),
            SwarmLifecycleStatus::Blocked => theme::swarm_blocked(),
            SwarmLifecycleStatus::Failed | SwarmLifecycleStatus::Crashed => theme::swarm_failed(),
            SwarmLifecycleStatus::Completed | SwarmLifecycleStatus::Done => theme::swarm_completed(),
            SwarmLifecycleStatus::Stopped => theme::swarm_stopped(),
            _ => theme::fg_dim(),
        };
        self.label(id!(status_icon)).apply_over(
            cx,
            live! { draw_text: { color: (icon_color) } },
        );

        // Name with role prefix
        let full_name = format!("{}{}", member.role_prefix(), member.name);
        self.label(id!(name_label)).set_text(cx, &full_name);

        // Coordinator gets accent colour
        if member.is_coordinator {
            self.label(id!(name_label)).apply_over(
                cx,
                live! { draw_text: { color: (theme::fg_accent()) } },
            );
        }

        // Detail / age
        let detail = match (&member.detail, member.status_age_secs) {
            (Some(d), _) => d.clone(),
            (None, Some(age)) if age > 5 => format!("{}s ago", age),
            _ => String::new(),
        };
        self.label(id!(detail_label)).set_text(cx, &detail);
    }
}

// ── AgentStatusPanel ──────────────────────────────────────────────────────────

#[derive(Clone, Debug, DefaultNone)]
pub enum AgentStatusAction {
    None,
}

#[derive(Live, LiveHook, Widget)]
pub struct AgentStatusPanel {
    #[deref]
    view: View,
    #[rust]
    members: Vec<GuiSwarmMember>,
    #[rust]
    session_id: Option<String>,
    #[rust]
    model: Option<String>,
}

impl Widget for AgentStatusPanel {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }

    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            // Stats bar
            if let Some(mut stats) = item.as_widget(live_id!(SwarmStatsBar)).borrow_mut() {
                stats.update(cx, &self.members);
            }

            // Member list via PortalList
            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                let sorted = self.sorted_members_owned();
                list.set_item_range(cx, 0, sorted.len());
                while let Some((index, item)) = list.next_visible_item(cx) {
                    if index < sorted.len() {
                        if let Some(mut card) = item.as_widget(live_id!(MemberCard)).borrow_mut() {
                            card.set_member(cx, &sorted[index]);
                        }
                        item.draw_all(cx, scope);
                    }
                }
            }

            // Session info at bottom
            if let Some(label) = item.as_widget(live_id!(session_id_label)).borrow_mut().as_deref_mut() {
                let text = self
                    .session_id
                    .as_deref()
                    .map(|id| format!("ID: {}", &id[..id.len().min(16)]))
                    .unwrap_or_default();
                label.set_text(cx, &text);
            }
            if let Some(label) = item.as_widget(live_id!(model_label)).borrow_mut().as_deref_mut() {
                let text = self
                    .model
                    .as_deref()
                    .map(|m| format!("Model: {}", m))
                    .unwrap_or_default();
                label.set_text(cx, &text);
            }
        }
        DrawStep::done()
    }
}

impl AgentStatusPanel {
    fn sorted_members_owned(&self) -> Vec<GuiSwarmMember> {
        let mut members = self.members.clone();
        members.sort_by(|a, b| b.is_coordinator.cmp(&a.is_coordinator));
        members
    }

    pub fn set_members(&mut self, cx: &mut Cx, members: Vec<GuiSwarmMember>) {
        self.members = members;
        self.redraw(cx);
    }

    pub fn set_session_info(&mut self, cx: &mut Cx, session_id: Option<String>, model: Option<String>) {
        self.session_id = session_id;
        self.model = model;
        self.redraw(cx);
    }
}
