//! Swarm plan kanban board.
//!
//! Displays `PlanTaskCard` items grouped into columns:
//!   To Do | Running | Done | Failed | Blocked
//!
//! Each column is a vertical list of task cards. The board is horizontally
//! scrollable so all columns remain visible.
//!
//! Column header colours match the TUI swarm status palette.

use makepad_widgets::*;

use crate::gui_state::{KanbanColumn, PlanTaskCard};
use crate::theme;

live_design! {
    use link::theme::*;
    use link::shaders::*;
    use makepad_widgets::base::*;

    // ── Task card ─────────────────────────────────────────────────────────────
    TaskCard = {{TaskCard}} {
        width: Fill,
        height: Fit,
        flow: Down,
        margin: { bottom: 4.0 }
        padding: { top: 7.0, bottom: 7.0, left: 10.0, right: 10.0 }

        draw_bg: {
            color: #26293700,
            border_radius: 6.0
        }

        title_label = <Label> {
            width: Fill,
            height: Fit,
            draw_text: {
                color: #dcdce6,
                text_style: { font_size: 12.0 }
            }
            text: ""
        }

        id_label = <Label> {
            width: Fit,
            height: Fit,
            draw_text: {
                color: #8c8c9b,
                text_style: { font_size: 10.0 }
            }
            text: ""
        }

        assigned_label = <Label> {
            width: Fit,
            height: Fit,
            draw_text: {
                color: #8ab4f8,
                text_style: { font_size: 10.0 }
            }
            text: ""
        }
    }

    // ── Column ────────────────────────────────────────────────────────────────
    KanbanColumnWidget = {{KanbanColumnWidget}} {
        width: 180.0,
        height: Fill,
        flow: Down,
        margin: { right: 8.0 }

        header = <View> {
            width: Fill,
            height: Fit,
            padding: { top: 6.0, bottom: 6.0, left: 8.0, right: 8.0 }
            draw_bg: { color: #26293700 }

            header_label = <Label> {
                width: Fill,
                height: Fit,
                draw_text: {
                    color: #8ab4f8,
                    text_style: { font_size: 12.0, font_weight: 700.0 }
                }
                text: "Column"
            }

            count_label = <Label> {
                width: Fit,
                height: Fit,
                draw_text: {
                    color: #8c8c9b,
                    text_style: { font_size: 11.0 }
                }
                text: "0"
            }
        }

        cards_scroll = <ScrollYView> {
            width: Fill,
            height: Fill,

            cards = <PortalList> {
                width: Fill,
                height: Fill,
                drag_scrolling: true,
                TaskCard = <TaskCard> {}
            }
        }
    }

    // ── Board ─────────────────────────────────────────────────────────────────
    pub SwarmBoardPanel = {{SwarmBoardPanel}} {
        width: Fill,
        height: Fill,
        flow: Down,
        draw_bg: { color: #14141800 }

        board_header = <View> {
            width: Fill,
            height: Fit,
            padding: { top: 10.0, bottom: 6.0, left: 14.0, right: 8.0 }

            board_title = <Label> {
                width: Fill,
                height: Fit,
                draw_text: {
                    color: #dcdce6,
                    text_style: { font_size: 14.0, font_weight: 700.0 }
                }
                text: "Swarm Plan"
            }

            swarm_id_label = <Label> {
                width: Fit,
                height: Fit,
                draw_text: {
                    color: #8c8c9b,
                    text_style: { font_size: 11.0 }
                }
                text: ""
            }
        }

        columns_row = <ScrollXView> {
            width: Fill,
            height: Fill,
            flow: Right,

            todo_col    = <KanbanColumnWidget> {}
            running_col = <KanbanColumnWidget> {}
            done_col    = <KanbanColumnWidget> {}
            failed_col  = <KanbanColumnWidget> {}
            blocked_col = <KanbanColumnWidget> {}
        }
    }
}

// ── TaskCard ──────────────────────────────────────────────────────────────────

#[derive(Live, LiveHook, Widget)]
pub struct TaskCard {
    #[deref]
    view: View,
}

impl Widget for TaskCard {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }

    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        self.view.draw_walk(cx, scope, walk)
    }
}

impl TaskCard {
    pub fn set_task(&mut self, cx: &mut Cx, task: &PlanTaskCard) {
        let title = if task.title.len() > 80 {
            format!("{}…", &task.title[..80])
        } else {
            task.title.clone()
        };
        self.label(id!(title_label)).set_text(cx, &title);

        let id_text = format!("#{}", task.id);
        self.label(id!(id_label)).set_text(cx, &id_text);

        let assigned = task
            .assigned_to
            .as_deref()
            .map(|a| format!("→ {}", a))
            .unwrap_or_default();
        self.label(id!(assigned_label)).set_text(cx, &assigned);

        // Card background tinted by column
        let bg = match &task.column {
            KanbanColumn::Todo => theme::bg_panel(),
            KanbanColumn::Running => {
                let mut c = theme::kanban_running();
                c.w = 0.08; // very subtle tint
                c
            }
            KanbanColumn::Done => {
                let mut c = theme::kanban_done();
                c.w = 0.06;
                c
            }
            KanbanColumn::Failed => {
                let mut c = theme::kanban_failed();
                c.w = 0.08;
                c
            }
            KanbanColumn::Blocked => {
                let mut c = theme::kanban_blocked();
                c.w = 0.08;
                c
            }
        };
        self.apply_over(cx, live! { draw_bg: { color: (bg) } });
    }
}

// ── KanbanColumnWidget ────────────────────────────────────────────────────────

#[derive(Live, LiveHook, Widget)]
pub struct KanbanColumnWidget {
    #[deref]
    view: View,
    #[rust]
    column: KanbanColumn,
    #[rust]
    tasks: Vec<PlanTaskCard>,
}

impl Widget for KanbanColumnWidget {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }

    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                list.set_item_range(cx, 0, self.tasks.len());
                while let Some((index, item)) = list.next_visible_item(cx) {
                    if index < self.tasks.len() {
                        if let Some(mut card) = item.as_widget(live_id!(TaskCard)).borrow_mut() {
                            card.set_task(cx, &self.tasks[index]);
                        }
                        item.draw_all(cx, scope);
                    }
                }
            }
        }
        DrawStep::done()
    }
}

impl KanbanColumnWidget {
    pub fn configure(&mut self, cx: &mut Cx, column: KanbanColumn, tasks: Vec<PlanTaskCard>) {
        self.tasks = tasks;
        self.column = column.clone();

        // Header label text
        let title = column.label();
        self.label(id!(header.header_label)).set_text(cx, title);
        self.label(id!(header.count_label))
            .set_text(cx, &self.tasks.len().to_string());

        // Header colour per column
        let header_color = match &column {
            KanbanColumn::Todo => theme::kanban_todo(),
            KanbanColumn::Running => theme::kanban_running(),
            KanbanColumn::Done => theme::kanban_done(),
            KanbanColumn::Failed => theme::kanban_failed(),
            KanbanColumn::Blocked => theme::kanban_blocked(),
        };
        self.label(id!(header.header_label)).apply_over(
            cx,
            live! { draw_text: { color: (header_color) } },
        );

        self.redraw(cx);
    }
}

// ── SwarmBoardPanel ───────────────────────────────────────────────────────────

#[derive(Clone, Debug, DefaultNone)]
pub enum SwarmBoardAction {
    None,
}

#[derive(Live, LiveHook, Widget)]
pub struct SwarmBoardPanel {
    #[deref]
    view: View,
    #[rust]
    swarm_id: Option<String>,
    #[rust]
    tasks: Vec<PlanTaskCard>,
}

impl Widget for SwarmBoardPanel {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }

    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        self.view.draw_walk(cx, scope, walk)
    }
}

impl SwarmBoardPanel {
    pub fn update_plan(
        &mut self,
        cx: &mut Cx,
        swarm_id: Option<String>,
        tasks: Vec<PlanTaskCard>,
    ) {
        self.swarm_id = swarm_id.clone();
        self.tasks = tasks;

        // Update swarm id label in header
        let id_text = swarm_id
            .as_deref()
            .map(|id| format!("swarm: {}", &id[..id.len().min(12)]))
            .unwrap_or_default();
        self.label(id!(board_header.swarm_id_label))
            .set_text(cx, &id_text);

        // Partition tasks into columns
        let make_col = |col: KanbanColumn| {
            self.tasks
                .iter()
                .filter(|t| t.column == col)
                .cloned()
                .collect::<Vec<_>>()
        };

        let todo_tasks = make_col(KanbanColumn::Todo);
        let running_tasks = make_col(KanbanColumn::Running);
        let done_tasks = make_col(KanbanColumn::Done);
        let failed_tasks = make_col(KanbanColumn::Failed);
        let blocked_tasks = make_col(KanbanColumn::Blocked);

        if let Some(mut col) = self
            .widget(id!(columns_row.todo_col))
            .as_widget(live_id!(KanbanColumnWidget))
            .borrow_mut()
        {
            col.configure(cx, KanbanColumn::Todo, todo_tasks);
        }
        if let Some(mut col) = self
            .widget(id!(columns_row.running_col))
            .as_widget(live_id!(KanbanColumnWidget))
            .borrow_mut()
        {
            col.configure(cx, KanbanColumn::Running, running_tasks);
        }
        if let Some(mut col) = self
            .widget(id!(columns_row.done_col))
            .as_widget(live_id!(KanbanColumnWidget))
            .borrow_mut()
        {
            col.configure(cx, KanbanColumn::Done, done_tasks);
        }
        if let Some(mut col) = self
            .widget(id!(columns_row.failed_col))
            .as_widget(live_id!(KanbanColumnWidget))
            .borrow_mut()
        {
            col.configure(cx, KanbanColumn::Failed, failed_tasks);
        }
        if let Some(mut col) = self
            .widget(id!(columns_row.blocked_col))
            .as_widget(live_id!(KanbanColumnWidget))
            .borrow_mut()
        {
            col.configure(cx, KanbanColumn::Blocked, blocked_tasks);
        }

        self.redraw(cx);
    }
}
