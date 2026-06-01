//! Swarm plan kanban board — displays plan tasks in three columns:
//!   To Do | Running | Done
//!
//! The right panel renders three stacked `PortalList` widgets (todo_list,
//! running_list, done_list) each occupying equal vertical space. Task cards
//! are colour-coded per column: blue (to-do), amber (running), green (done).

use makepad_widgets::*;

use crate::gui_state::{KanbanColumn, GUI_STATE};

/// Kanban board widget: three-column task board for swarm plan items.
#[derive(Script, ScriptHook, Widget)]
pub struct SwarmBoardWidget {
    #[deref]
    view: View,
}

impl Widget for SwarmBoardWidget {
    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        let state = GUI_STATE.read().unwrap();
        let todo_tasks: Vec<_> = state.tasks_in_column(&KanbanColumn::Todo);
        let running_tasks: Vec<_> = state.tasks_in_column(&KanbanColumn::Running);
        let done_tasks: Vec<_> = state.tasks_in_column(&KanbanColumn::Done);

        // Portal lists are yielded in layout order: todo_list → running_list → done_list.
        let all_tasks: [&Vec<_>; 3] = [&todo_tasks, &running_tasks, &done_tasks];
        let mut list_idx = 0usize;
        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                let tasks = all_tasks[list_idx.min(2)];

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
                list_idx += 1;
            }
        }

        DrawStep::done()
    }

    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }
}
