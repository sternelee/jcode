//! Swarm plan kanban board — displays plan tasks in three columns:
//!   To Do | Running | Done
//!
//! Each column is a separate portal list in the widget tree. The widget
//! renders all columns via a single top-level `View` that contains three
//! sub-views, each with its own `PortalList`.

use makepad_widgets::*;

use crate::gui_state::{KanbanColumn, GUI_STATE};

/// Kanban board widget: three-column task board for swarm plan items.
#[derive(Script, ScriptHook, Widget)]
pub struct SwarmBoardWidget {
    #[deref]
    view: View,
    #[rust]
    drawn_todo: usize,
    #[rust]
    drawn_running: usize,
    #[rust]
    drawn_done: usize,
}

impl Widget for SwarmBoardWidget {
    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        let state = GUI_STATE.read().unwrap();
        let todo_tasks: Vec<_> = state.tasks_in_column(&KanbanColumn::Todo);
        let running_tasks: Vec<_> = state.tasks_in_column(&KanbanColumn::Running);
        let done_tasks: Vec<_> = state.tasks_in_column(&KanbanColumn::Done);

        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                // Identify which column list we are drawing by tracking draw order
                let (tasks, counter) = if self.drawn_todo == 0 {
                    self.drawn_todo += 1;
                    (&todo_tasks, &mut self.drawn_todo)
                } else if self.drawn_running == 0 {
                    self.drawn_running += 1;
                    (&running_tasks, &mut self.drawn_running)
                } else {
                    self.drawn_done += 1;
                    (&done_tasks, &mut self.drawn_done)
                };
                let _ = counter;

                list.set_item_range(cx, 0, tasks.len());
                while let Some(idx) = list.next_visible_item(cx) {
                    if let Some(task) = tasks.get(idx) {
                        let (item_widget, _) = list.item_with_existed(cx, idx, id!(TaskCard));
                        item_widget
                            .label(cx, ids!(task_title_label))
                            .set_text(cx, &task.title);
                        let assignee = task.assigned_to.as_deref().unwrap_or("");
                        item_widget
                            .label(cx, ids!(task_assignee_label))
                            .set_text(cx, assignee);
                        item_widget.draw_all_unscoped(cx);
                    }
                }
            }
        }

        // Reset draw counters for next frame
        self.drawn_todo = 0;
        self.drawn_running = 0;
        self.drawn_done = 0;

        DrawStep::done()
    }

    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }
}
