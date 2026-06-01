//! Bottom composer / input widget.
//!
//! Mirrors the TUI's `ComposerMode` concept:
//!   • Default (Chat): plain message input
//!   • SlashCommand: triggered by leading `/`, shows command hint
//!   • ShellLocal: triggered by `!` prefix, shows "shell mode" badge
//!   • ShellRemote: triggered by `!>` prefix (remote server)
//!
//! Emits `ComposerAction::Submit { text }` when the user presses Enter (or the
//! Send button). Shift+Enter inserts a newline.

use makepad_widgets::*;

live_design! {
    use link::theme::*;
    use link::shaders::*;
    use makepad_widgets::base::*;

    pub ComposerWidget = {{ComposerWidget}} {
        width: Fill,
        height: Fit,
        flow: Down,
        padding: { top: 4.0, bottom: 8.0, left: 12.0, right: 12.0 }
        draw_bg: { color: #1e1e2400 }

        // Mode hint bar (visible only in slash/shell mode)
        mode_hint_bar = <View> {
            width: Fill,
            height: Fit,
            visible: false,
            padding: { top: 4.0, bottom: 4.0, left: 8.0, right: 8.0 }
            draw_bg: { color: #26293700 }

            mode_hint_label = <Label> {
                width: Fit,
                height: Fit,
                draw_text: {
                    color: #8ab4f8,
                    text_style: { font_size: 11.0 }
                }
                text: ""
            }
        }

        // Input row: text field + send button
        input_row = <View> {
            width: Fill,
            height: Fit,
            flow: Right,
            align: { y: 1.0 }
            padding: { top: 4.0 }

            text_input = <TextInput> {
                width: Fill,
                height: Fit,
                empty_message: "Message agent…  (/ for commands · ! for shell)"

                draw_bg: {
                    color: #1e1e2c,
                    border_radius: 8.0,
                    border_color: #3a3a4a,
                    border_width: 1.0
                }

                draw_text: {
                    color: #dcdce6,
                    text_style: { font_size: 13.0 }
                }

                draw_cursor: {
                    color: #8ab4f8
                }

                draw_selection: {
                    color: #2a4a6a
                }
            }

            send_btn = <Button> {
                width: Fit,
                height: Fit,
                margin: { left: 8.0 }
                padding: { left: 14.0, right: 14.0, top: 8.0, bottom: 8.0 }
                draw_bg: {
                    color: #8ab4f8,
                    border_radius: 8.0
                }
                draw_text: {
                    color: #1a1a1e,
                    text_style: { font_size: 13.0, font_weight: 700.0 }
                }
                text: "Send"
            }
        }
    }
}

// ── Composer mode ─────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ComposerMode {
    Chat,
    SlashCommand,
    ShellLocal,
    ShellRemote,
}

impl ComposerMode {
    /// Derive from the current draft text (mirrors TUI `composer_mode` logic).
    pub fn from_text(text: &str) -> Self {
        let trimmed = text.trim_start();
        if trimmed.starts_with("!>") {
            Self::ShellRemote
        } else if trimmed.starts_with('!') {
            Self::ShellLocal
        } else if trimmed.starts_with('/') {
            Self::SlashCommand
        } else {
            Self::Chat
        }
    }

    pub fn hint(&self) -> Option<&'static str> {
        match self {
            Self::Chat => None,
            Self::SlashCommand => Some("/ — slash command mode"),
            Self::ShellLocal => Some("! — shell mode  ·  Enter runs locally"),
            Self::ShellRemote => Some("!> — remote shell mode  ·  Enter runs on server"),
        }
    }
}

// ── Actions ───────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, DefaultNone)]
pub enum ComposerAction {
    /// User pressed Enter (or Send button) — carry the finalized text.
    Submit { text: String },
    /// Draft text changed — carry current text for mode-hint updates etc.
    TextChanged { text: String },
    None,
}

// ── Widget ────────────────────────────────────────────────────────────────────

#[derive(Live, LiveHook, Widget)]
pub struct ComposerWidget {
    #[deref]
    view: View,
    #[rust]
    mode: ComposerMode,
}

impl Widget for ComposerWidget {
    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);

        let input = self.text_input(id!(input_row.text_input));

        // Track text changes for mode hints
        if input.changed(cx) {
            let text = input.text();
            let new_mode = ComposerMode::from_text(&text);
            if new_mode != self.mode {
                self.mode = new_mode;
                self.update_mode_hint(cx);
            }
            cx.widget_action(
                self.widget_uid(),
                &scope.path,
                ComposerAction::TextChanged { text },
            );
        }

        // Send on button click
        if self.button(id!(input_row.send_btn)).clicked(cx) {
            self.emit_submit(cx, scope);
        }

        // Send on Enter (TextInput fires KeyDown with Enter)
        if let Event::KeyDown(ke) = event {
            if ke.key_code == KeyCode::ReturnKey && !ke.modifiers.shift {
                // Only intercept if text input is focused
                if cx.has_key_focus(self.text_input(id!(input_row.text_input)).area()) {
                    self.emit_submit(cx, scope);
                }
            }
        }
    }

    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        self.view.draw_walk(cx, scope, walk)
    }
}

impl ComposerWidget {
    fn emit_submit(&mut self, cx: &mut Cx, scope: &mut Scope) {
        let input = self.text_input(id!(input_row.text_input));
        let text = input.text();
        if text.trim().is_empty() {
            return;
        }
        input.set_text(cx, "");
        self.mode = ComposerMode::Chat;
        self.update_mode_hint(cx);
        cx.widget_action(
            self.widget_uid(),
            &scope.path,
            ComposerAction::Submit { text },
        );
    }

    fn update_mode_hint(&mut self, cx: &mut Cx) {
        let hint = self.mode.hint();
        let visible = hint.is_some();
        self.view(id!(mode_hint_bar)).apply_over(
            cx,
            live! { visible: (visible) },
        );
        if let Some(h) = hint {
            self.label(id!(mode_hint_bar.mode_hint_label))
                .set_text(cx, h);
        }
    }

    /// Programmatically set the draft text (e.g. when switching sessions).
    pub fn set_draft(&mut self, cx: &mut Cx, draft: &str) {
        self.text_input(id!(input_row.text_input))
            .set_text(cx, draft);
        self.mode = ComposerMode::from_text(draft);
        self.update_mode_hint(cx);
    }

    /// Return the current draft text without clearing.
    pub fn current_text(&self) -> String {
        self.text_input(id!(input_row.text_input)).text()
    }
}
