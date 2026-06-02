//! Composer input bar — bottom input row with slash-command detection,
//! slash-command autocomplete suggestions, and @ file-mention support.
//!
//! The actual input widget is a `TextInput` defined in the `script_mod!` layout.
//! This module provides:
//!   - `ComposerMode` — detects the current input mode.
//!   - `SLASH_COMMANDS` — the catalogue of available / commands.
//!   - `slash_suggestions` — filters the catalogue to match the current input.
//!   - `at_file_query` — extracts the partial path after the last `@`.
//!   - `file_suggestions` — lists files in the working directory matching a query.

use std::path::Path;

// ── Mode detection ────────────────────────────────────────────────────────────

/// Detected composer mode based on the current input text.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum ComposerMode {
    #[default]
    Chat,
    SlashCommand,
    AtMention,
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
        } else if text.starts_with('/') || text.trim_start().starts_with('/') {
            Self::SlashCommand
        } else if at_file_query(text).is_some() {
            Self::AtMention
        } else {
            Self::Chat
        }
    }

    /// Placeholder hint text for the input box.
    pub fn placeholder(&self) -> &'static str {
        match self {
            Self::Chat => "Message… (Enter to send)",
            Self::SlashCommand => "/ command…",
            Self::AtMention => "@ file path… (Tab to complete)",
            Self::ShellLocal => "! shell command (local)…",
            Self::ShellRemote => "!> shell command (remote)…",
        }
    }

    /// Short keyboard hint shown below the composer bar.
    /// Returns an empty string for Chat mode to avoid duplicating the placeholder.
    pub fn mode_hint(&self) -> &'static str {
        match self {
            Self::Chat => "",
            Self::SlashCommand => "↑↓ navigate  ·  Tab accept  ·  Esc dismiss",
            Self::AtMention => "↑↓ navigate  ·  Tab complete  ·  Esc dismiss",
            Self::ShellLocal => "! runs in local shell",
            Self::ShellRemote => "!> runs on remote host",
        }
    }
}

// ── Slash command catalogue ───────────────────────────────────────────────────

/// A slash command shown in the autocomplete popup.
pub struct SlashCommand {
    pub name: &'static str,
    pub desc: &'static str,
}

/// Full catalogue of slash commands available in the GUI composer.
/// Mirrors the most commonly used commands from the TUI.
pub const SLASH_COMMANDS: &[SlashCommand] = &[
    SlashCommand { name: "/help",     desc: "Show help and keyboard shortcuts" },
    SlashCommand { name: "/model",    desc: "List or switch models" },
    SlashCommand { name: "/clear",    desc: "Clear conversation history" },
    SlashCommand { name: "/compact",  desc: "Compact context" },
    SlashCommand { name: "/diff",     desc: "Cycle or set diff display mode" },
    SlashCommand { name: "/plan",     desc: "Create a plan-only response in the side panel" },
    SlashCommand { name: "/improve",  desc: "Autonomously improve the repository" },
    SlashCommand { name: "/refactor", desc: "Run a safe refactor loop" },
    SlashCommand { name: "/test",     desc: "Verify a claim/current changes with tests" },
    SlashCommand { name: "/commit",   desc: "Make logical commits from current changes" },
    SlashCommand { name: "/review",   desc: "Launch a one-shot headed review session" },
    SlashCommand { name: "/git",      desc: "Show git status for the session working directory" },
    SlashCommand { name: "/observe",  desc: "Show the latest tool context in the side panel" },
    SlashCommand { name: "/todos",    desc: "Show the current session todo list" },
    SlashCommand { name: "/context",  desc: "Show the full session context snapshot" },
    SlashCommand { name: "/memory",   desc: "Toggle memory feature" },
    SlashCommand { name: "/swarm",    desc: "Toggle swarm feature" },
    SlashCommand { name: "/resume",   desc: "Open session picker" },
    SlashCommand { name: "/sessions", desc: "Alias for /resume" },
    SlashCommand { name: "/save",     desc: "Bookmark session for easy access" },
    SlashCommand { name: "/rename",   desc: "Rename current session" },
    SlashCommand { name: "/transfer", desc: "Compact context into a fresh handoff session" },
    SlashCommand { name: "/info",     desc: "Show session info and tokens" },
    SlashCommand { name: "/usage",    desc: "Show connected provider usage limits" },
    SlashCommand { name: "/version",  desc: "Show current version" },
    SlashCommand { name: "/config",   desc: "Show or edit configuration" },
    SlashCommand { name: "/login",    desc: "Login to a provider" },
    SlashCommand { name: "/logout",   desc: "Log out of a provider" },
    SlashCommand { name: "/auth",     desc: "Show authentication status" },
    SlashCommand { name: "/account",  desc: "Open the combined account picker" },
    SlashCommand { name: "/agents",   desc: "Configure models for agent roles" },
    SlashCommand { name: "/quit",     desc: "Exit jcode" },
];

/// Returns slash commands whose name starts with `input` (case-insensitive).
/// `input` should be the full raw text (e.g. `"/mo"`).
/// Returns at most `max` results; passing `0` means no limit.
pub fn slash_suggestions(input: &str, max: usize) -> Vec<(&'static str, &'static str)> {
    let prefix = input.trim_start().to_ascii_lowercase();
    if !prefix.starts_with('/') {
        return vec![];
    }
    let iter = SLASH_COMMANDS
        .iter()
        .filter(|cmd| cmd.name.to_ascii_lowercase().starts_with(prefix.as_str()))
        .map(|cmd| (cmd.name, cmd.desc));
    if max == 0 {
        iter.collect()
    } else {
        iter.take(max).collect()
    }
}

// ── @ file-mention support ────────────────────────────────────────────────────

/// If the input ends with an `@`-prefixed token (possibly partial path), returns
/// that partial path (the text after the last `@`).  Returns `None` otherwise.
pub fn at_file_query(input: &str) -> Option<&str> {
    // Find the last '@' that is preceded by whitespace or is at the start.
    let at_pos = input.rfind('@')?;
    // Ensure the '@' is at the start of a word (position 0 or preceded by whitespace).
    if at_pos > 0 {
        let before = &input[..at_pos];
        if !before.ends_with(|c: char| c.is_whitespace()) {
            return None;
        }
    }
    let query = &input[at_pos + 1..];
    // Only treat it as an active @ query if there are no spaces after the '@'.
    if query.contains(char::is_whitespace) {
        return None;
    }
    Some(query)
}

/// Lists files whose names start with `query` relative to `working_dir`.
///
/// Supports subdirectory navigation: if `query` contains a `/` the path up to
/// the last `/` is treated as a subdirectory to descend into, and only the
/// trailing component is used as the name filter.  Results include the
/// directory prefix so that Tab-completing a suggestion produces the full
/// relative path (e.g. `src/main.rs`).
///
/// Hidden files (starting with `.`) are omitted unless the user explicitly
/// typed a `.` prefix for the name component.  Returns at most `max` results;
/// `max == 0` means no limit.
pub fn file_suggestions(working_dir: &Path, query: &str, max: usize) -> Vec<String> {
    // Split query into optional directory prefix and file-name filter.
    let (dir, name_prefix, path_prefix) = if let Some(slash_pos) = query.rfind('/') {
        let subdir = &query[..slash_pos];
        let name_part = &query[slash_pos + 1..];
        let dir = working_dir.join(subdir);
        (dir, name_part.to_owned(), format!("{}/", subdir))
    } else {
        (working_dir.to_path_buf(), query.to_owned(), String::new())
    };

    let Ok(entries) = std::fs::read_dir(&dir) else {
        return vec![];
    };
    let q = name_prefix.to_ascii_lowercase();
    let query_is_hidden = q.starts_with('.');
    let mut results: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            // Skip hidden files unless the user explicitly typed a '.' prefix.
            if name.starts_with('.') && !query_is_hidden {
                return None;
            }
            if name.to_ascii_lowercase().starts_with(q.as_str()) {
                // Append '/' suffix for directories so the user can keep navigating.
                let suffix = if entry.path().is_dir() { "/" } else { "" };
                Some(format!("{}{}{}", path_prefix, name, suffix))
            } else {
                None
            }
        })
        .collect();
    results.sort();
    if max > 0 {
        results.truncate(max);
    }
    results
}
