# JCode Desktop App (Tauri v2)

## Overview

`jcode-app/` is the Tauri v2 desktop application wrapping the `jcode` Rust library.
It provides a native macOS/Windows/Linux UI for jcode's AI coding assistant capabilities.

## Architecture

### Frontend (React 19 + TypeScript + Tailwind v4)

```
src/
├── App.tsx                          # Root component with tab-based navigation
├── main.tsx                         # React entry point
├── App.css                          # Global styles (Tailwind + shadcn/ui)
├── types.ts                         # TypeScript interfaces for server events & state
├── hooks/
│   ├── useJcodeSession.ts           # Main session state management (useReducer)
│   └── useTheme.ts                  # Light/dark/system theme management
├── components/
│   ├── NavBar.tsx                   # App shell sidebar with tab navigation
│   ├── ConversationsList.tsx        # Workspace & session list
│   ├── ChatArea.tsx                 # Main chat view with messages + input
│   ├── ChatView.tsx                 # Chat message rendering
│   ├── MessageBubble.tsx            # Individual message display
│   ├── InputArea.tsx                # Message composition area
│   ├── ModelSelector.tsx            # Model picker
│   ├── SettingsPage.tsx             # Appearance, version, devices, memory stats
│   ├── ProviderConfigPage.tsx       # Provider auth & model route management
│   ├── SlashCommands.tsx            # /command parser
│   ├── CreateSessionDialog.tsx      # New session dialog (normal/swarm)
│   ├── SessionSwitcherDialog.tsx    # Cmd+P session switcher
│   ├── StdinInputModal.tsx          # Interactive stdin prompt modal
│   ├── AgentAvatar.tsx              # Agent/role avatar display
│   ├── ActivityPanel.tsx            # Right sidebar: session status, tools, timeline
│   ├── DiffView.tsx                 # Code diff renderer
│   ├── ToolCard.tsx                 # Tool execution display
│   ├── SessionSidebar.tsx           # Session list sidebar
│   ├── ai-elements/                 # AI chat UI elements (conversation, message, prompt)
│   └── ui/                          # shadcn/ui primitive components
├── lib/
│   ├── utils.ts                     # cn() utility for class merging
│   ├── messageAdapter.ts            # Server event → desktop event adapter
│   └── serverEventAdapter.ts        # Raw server event parsing
└── vite-env.d.ts                   # Vite type declarations
```

### Backend (Rust + Tauri v2)

```
src-tauri/
├── Cargo.toml                      # Rust dependencies (jcode, tauri, plugins)
├── tauri.conf.json                 # Tauri app configuration
├── build.rs                        # Tauri build script
├── capabilities/
│   ├── default.json                # Core permissions (fs, dialog, shell, notification, etc.)
│   └── shell-exec.json             # Shell command execution permissions (git)
├── icons/                          # App icons (32x32, 128x128, icns, ico)
└── src/
    ├── main.rs                     # Binary entry point
    ├── lib.rs                      # Tauri plugin registration + 50+ #[tauri::command] handlers
    └── commands.rs                 # SessionRuntime + AppState + helper functions
```

### Key Tauri Backend Commands

| Command                                                                 | Description                                   |
| ----------------------------------------------------------------------- | --------------------------------------------- |
| `begin_session`                                                         | Start a new AI session                        |
| `resume_session`                                                        | Resume an existing session from disk          |
| `send_message`                                                          | Send a message to the AI (streaming)          |
| `cancel`                                                                | Cancel the current AI response                |
| `send_soft_interrupt`                                                   | Soft interrupt with follow-up content         |
| `set_model`                                                             | Switch model for a session                    |
| `set_memory_enabled`                                                    | Toggle memory on/off                          |
| `set_reasoning_effort`                                                  | Set reasoning effort (low/medium/high)        |
| `compact_context`                                                       | Force context compaction                      |
| `clear_chat`                                                            | Clear all messages in session                 |
| `rewind_chat`                                                           | Rewind to a specific message index            |
| `list_sessions`                                                         | List all persisted sessions                   |
| `delete_session` / `delete_workspace_sessions`                          | Delete sessions                               |
| `rename_session`                                                        | Rename a session                              |
| `get_models`                                                            | Get available model routes + provider catalog |
| `save_provider_api_key`                                                 | Save provider API keys locally                |
| `start_provider_auth_flow` / `complete_provider_auth_flow`              | OAuth/device auth flow                        |
| `get_auth_status` / `run_auth_doctor`                                   | Auth diagnostics                              |
| `get_memory_list` / `search_memories` / `get_memory_stats`              | Memory management                             |
| `export_memories` / `import_memories`                                   | Memory import/export                          |
| `trigger_ambient` / `stop_ambient`                                      | Ambient mode control                          |
| `get_ambient_status` / `get_ambient_transcripts`                        | Ambient monitoring                            |
| `generate_pairing_code` / `list_paired_devices` / `revoke_device`       | Mobile device pairing                         |
| `get_browser_status` / `setup_browser`                                  | Browser tool setup                            |
| `send_transcript` / `run_dictation`                                     | Voice transcription                           |
| `get_version_info`                                                      | App version info                              |
| `get_usage_info`                                                        | Provider usage limits                         |
| `add_provider_profile`                                                  | Add custom OpenAI-compatible provider         |
| `get_permission_requests` / `respond_to_permission`                     | Safety system                                 |
| `list_background_tasks` / `cancel_background_task`                      | Background task management                    |
| `save_session_state` / `get_last_session_state` / `clear_session_state` | Session persistence                           |
| `git_status`                                                            | Git status display                            |

## State Management

Uses React `useReducer` for predictable state management. The state is organized as:

- **Global state** (`SessionState`): connection status, active session, available models
- **Per-session state** (`PerSessionData`): messages, processing status, model info, errors
- **`sessionData`** map: `Record<string, PerSessionData>` — indexed by session ID

### Swarm Mode

Sessions in the same working directory form a "workspace". In swarm mode:

- A virtual session `workspace:{id}` aggregates messages from all agent sessions
- Messages are mirrored from individual sessions to the workspace thread
- `@AgentName` routing allows directing messages to specific agents

## Events

Server events flow through Tauri's event system (`server-event` channel):

1. Backend emits events with `session_id`
2. Frontend `listen("server-event", ...)` dispatches to the reducer
3. Swarm mode mirrors events to the workspace virtual session

## Build & Run

```bash
# From repo root or jcode-app/
pnpm tauri dev           # Full Tauri dev (Rust + Vite)
pnpm dev                 # Frontend only (port 1420)
pnpm build               # Frontend production build

# Rust backend (from repo root)
cargo check              # Fast checks
cargo build -p jcode-app # Build Tauri app
```

## Configuration

- `tauri.conf.json`: App metadata, window config, security CSP, bundle settings, plugin config
- `capabilities/default.json`: Tauri v2 permissions (fs, dialog, shell, notification, clipboard, process)
- `capabilities/shell-exec.json`: Scoped shell command permissions (git)
- Plugins: clipboard-manager, dialog, fs, notification, process, shell

## Design Decisions

- **Tab-based navigation**: Chat, Network (providers), Media, Tasks, Monitor, Team, Settings
- **Purple (#7C3AED) primary** with subtle shadows for native-feel
- **System font stack** (SF Pro, Segoe UI) rather than custom fonts for speed
- **No custom scrollbars** — native WebKit overlay scrollbars only
- **`cursor: default`** on everything except inputs — native apps don't change cursor
- **`user-select: none`** on chrome, text on content — standard native pattern
- **Side panels** collapse on non-chat tabs for full-width settings pages
