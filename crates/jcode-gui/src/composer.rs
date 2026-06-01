//! Composer input bar — bottom input row with slash-command detection.
//!
//! The actual input widget is a `TextInput` defined in the `script_mod!` layout.
//! This module provides helper types and the mode detection logic.

/// Detected composer mode based on the current input text.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum ComposerMode {
    #[default]
    Chat,
    SlashCommand,
    ShellLocal,
    ShellRemote,
}

impl ComposerMode {
    /// Detect mode from the raw input string prefix, mirroring TUI `ComposerMode`.
    pub fn detect(text: &str) -> Self {
        if text.starts_with("!>") {
            Self::ShellRemote
        } else if text.starts_with('!') {
            Self::ShellLocal
        } else if text.starts_with('/') {
            Self::SlashCommand
        } else {
            Self::Chat
        }
    }

    /// Placeholder hint text for the input box.
    pub fn placeholder(&self) -> &'static str {
        match self {
            Self::Chat => "Message… (Enter to send, Shift+Enter for newline)",
            Self::SlashCommand => "/ command…",
            Self::ShellLocal => "! shell command (local)…",
            Self::ShellRemote => "!> shell command (remote)…",
        }
    }
}
