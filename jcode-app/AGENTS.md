# JCode App — Agent Guide

This is **JCode Desktop**, a Tauri v2 desktop application for the JCode coding agent. It wraps the Rust `jcode` agent core with a React/TypeScript frontend.

**Important distinction**: The `crates/jcode-desktop/` directory in the parent repo is a *separate* wgpu/winit native desktop implementation. This `jcode-app/` directory is the **Tauri-based** desktop app.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | React 19 (strict mode) |
| Build tool | Vite 7 |
| Language | TypeScript 5.8 (strict, `noUnusedLocals`, `noUnusedParameters`) |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite` plugin) |
| UI components | shadcn/ui (base-nova style) via `@base-ui/react` and `@radix-ui/react-slot` |
| Icons | `lucide-react` |
| Animations | `motion` |
| AI message rendering | `ai-elements` + `streamdown` (streaming markdown with CJK/math/mermaid/code plugins) |
| Backend | Tauri v2 (Rust 2021 edition) |
| Package manager | pnpm |

## Project Structure

```
jcode-app/
├── package.json              # Frontend dependencies & scripts
├── vite.config.ts            # Vite config (port 1420, @/ alias)
├── tsconfig.json             # Strict TypeScript, @/* maps to src/*
├── tsconfig.node.json        # Vite/Node-specific TS config
├── components.json           # shadcn/ui config (style: base-nova)
├── index.html                # Entry HTML with theme hydration script
├── pnpm-workspace.yaml       # Minimal workspace config (esbuild/msw disabled)
├── src/
│   ├── main.tsx              # React root mount (StrictMode)
│   ├── App.tsx               # Main layout: header + sidebar + chat + dialogs
│   ├── App.css               # Tailwind v4 theme imports, CSS variables, light/dark themes, native cursor resets
│   ├── types.ts              # Central type definitions (~800 lines) for all events and UI state
│   ├── vite-env.d.ts         # Vite client types
│   ├── hooks/
│   │   ├── useJcodeSession.ts # Core state hook: reducer-based session state + Tauri invoke (~2200 lines)
│   │   └── useTheme.ts       # Light/dark/system theme with localStorage persistence
│   ├── lib/
│   │   ├── serverEventAdapter.ts  # Maps raw backend ServerEvents → DesktopSemanticEvents
│   │   ├── messageAdapter.ts      # (legacy / minimal)
│   │   └── utils.ts               # `cn()` helper (clsx + tailwind-merge)
│   └── components/
│       ├── ChatArea.tsx           # Message list, input area, slash commands, agent settings popover
│       ├── ChatView.tsx           # Message list scroll container with unread separators
│       ├── MessageBubble.tsx      # Individual message rendering with streaming support
│       ├── InputArea.tsx          # Text input, image paste, send/queue/cancel
│       ├── NavBar.tsx             # Left vertical navigation bar (chat / agents tabs)
│       ├── ConversationsList.tsx  # Session/workspace conversation list with unread badges
│       ├── SessionSidebar.tsx     # (legacy) Workspace-grouped session list
│       ├── SessionSwitcherDialog.tsx  # Cmd/Ctrl+P session search dialog
│       ├── CreateSessionDialog.tsx    # New session creation (normal or swarm mode)
│       ├── ModelSelector.tsx      # Provider/model selection combobox
│       ├── ActivityPanel.tsx      # Right-side activity/metadata panel
│       ├── ToolCard.tsx           # Tool execution display
│       ├── StdinInputModal.tsx    # Interactive stdin prompt modal
│       ├── AgentAvatar.tsx        # Avatar component for swarm agents
│       ├── DiffView.tsx           # Diff rendering component
│       ├── SlashCommands.tsx      # Slash command palette, model picker, agent settings popover
│       ├── ai-elements/           # Custom wrappers around ai-elements components
│       │   ├── conversation.tsx
│       │   ├── message.tsx
│       │   └── prompt-input.tsx
│       └── ui/                    # shadcn/ui primitive components
│           ├── badge.tsx, button.tsx, button-group.tsx, card.tsx, combobox.tsx,
│           ├── command.tsx, dialog.tsx, dropdown-menu.tsx, hover-card.tsx,
│           ├── input.tsx, input-group.tsx, scroll-area.tsx, select.tsx,
│           ├── separator.tsx, spinner.tsx, textarea.tsx, tooltip.tsx
│
├── src-tauri/
│   ├── Cargo.toml              # Rust package (name: jcode-app, depends on `jcode` workspace crate)
│   ├── tauri.conf.json         # Tauri app config (window size, build hooks, CSP)
│   ├── build.rs                # Tauri build script
│   └── src/
│       ├── main.rs             # Entry point (calls `jcode_app_lib::run()`)
│       ├── lib.rs              # All Tauri commands, event streaming, session management (~3500 lines)
│       └── commands.rs         # AppState, SessionRuntime, agent/provider factory functions
```

## Build and Development Commands

Run all commands from inside `jcode-app/` unless noted otherwise.

### Frontend
```bash
# Frontend dev server only (port 1420)
pnpm dev

# Frontend production build
pnpm build

# Type check
pnpm tsc
```

### Tauri (full desktop app)
```bash
# Tauri dev mode — builds Rust backend + starts Vite frontend
pnpm tauri dev

# Production Tauri build (from inside jcode-app/)
pnpm tauri build
```

### Rust backend
Rust commands for the backend should generally be run from the **parent repo root** (`../..`):
```bash
# Fast check while iterating
cargo check

# Build the desktop app crate
cargo build -p jcode-app
```

### No local tests
There are no tests inside `jcode-app/` itself. The parent `jcode` workspace contains all Rust tests, run via `cargo test` from the repo root.

## Architecture

### Frontend-Backend Communication
1. Frontend calls `invoke("begin_session", ...)` or `invoke("resume_session", ...)`
2. Backend creates a `jcode::Agent` with a `Session`, spawns a tokio task
3. Agent produces `jcode::protocol::ServerEvent`s → backend maps them to JSON → emits `"server-event"` Tauri events
4. Frontend `useJcodeSession` listens via `listen("server-event", ...)` and dispatches actions to the reducer

### Frontend State (`useJcodeSession`)
- Uses a single `useReducer` with a `sessionReducer` and `SessionState`
- Tracks: `connected`, `connecting`, `messages`, `sessions`, `providerName`, `providerModel`, `availableModels`, `availableModelRoutes`, `isProcessing`, `stdinPrompt`, `workingDir`, `reasoningEffort`, `memoryEnabled`, `queuedDrafts`, `expandedWorkspaces`, `sessionData`, `activeWorkspaceId`, `workspaceModes`
- `sessionData` is a `Record<string, PerSessionData>` that stores per-session state so switching between sessions preserves message history and UI state
- `listSessions()` polls the backend to refresh the session sidebar

### Backend State (`AppState` in `commands.rs`)
- `runtimes`: `HashMap<String, Arc<SessionRuntime>>` — all active session runtimes
- `active_session_id`: currently focused session
- `pending_stdin`: map of pending stdin request IDs to response channels
- `live_swarm_members`, `live_swarm_plans`, `live_swarm_proposals`: swarm coordination state

### Event Protocol
The backend emits `server-event` Tauri events. Frontend listens and routes them through `rawServerEventToDesktopEvents()` in `src/lib/serverEventAdapter.ts`. This adapter translates raw `jcode` protocol events into `DesktopSemanticEvent`s. Handles:
- Text streaming (`text_delta`, `text_replace`)
- Tool execution lifecycle (`tool_start`, `tool_input`, `tool_exec`, `tool_done`)
- Token usage, session ID assignment, model changes
- Stdin prompts, swarm status/plan/proposal events
- History loading, compaction, rewind, clear chat

## Key Tauri Commands

Defined in `src-tauri/src/lib.rs`:

| Command | Purpose |
|---------|---------|
| `begin_session(working_dir, model, memory_enabled)` | Start a new session |
| `resume_session(session_id, working_dir)` | Load and resume an existing session |
| `send_message(content, images, system_reminder)` | Send a user message to the active session |
| `cancel(session_id)` | Interrupt the current agent run |
| `send_soft_interrupt(session_id)` | Send a soft interrupt signal |
| `set_model(model, profile_id, session_id)` | Switch model mid-session |
| `set_memory_enabled(enabled, session_id)` | Toggle memory feature |
| `get_workspace_memory_preferences()` | Get per-workspace memory defaults |
| `set_workspace_memory_preference(working_dir, enabled)` | Set per-workspace memory default |
| `get_workspace_thread_history(working_dir)` | Load workspace thread history |
| `list_sessions()` | Return all sessions with metadata |
| `rename_session(session_id, title)` | Rename a session |
| `delete_session(session_id)` | Delete a session |
| `delete_workspace_sessions(working_dir)` | Delete all sessions in a workspace |
| `clear_chat(session_id)` / `rewind_chat(message_index, session_id)` / `compact_context(session_id)` | Session management |
| `set_reasoning_effort(effort, session_id)` | Set reasoning effort level |
| `send_stdin_response(request_id, response, session_id)` | Respond to tool stdin prompts |
| `get_models()` | List available models and auth state |
| `save_provider_api_key(provider_id, api_key, extra)` | Save provider API key |
| `start_provider_auth_flow(provider_id)` | Start OAuth/device-code auth flow |
| `complete_provider_auth_flow(provider_id, code, callback_url)` | Complete auth flow |
| `add_provider_profile(profile)` | Add an OpenAI-compatible provider profile |
| `get_auth_status()` | Get authentication status for all providers |
| `run_auth_doctor()` | Run auth diagnostics |
| `run_auth_test(provider_id)` | Test provider authentication |
| `get_usage_info()` | Get usage/limit information |
| `get_version_info()` | Get app version info |
| `get_memory_list()` / `search_memories(query, semantic)` | Memory queries |
| `get_memory_stats()` / `export_memories(path)` / `import_memories(path)` | Memory management |
| `generate_pairing_code()` / `list_paired_devices()` / `revoke_device(device_id)` | Device pairing |
| `list_background_tasks()` / `cancel_background_task(task_id)` | Background task management |
| `get_permission_requests()` / `respond_to_permission(request_id, granted)` | Permission system |
| `get_ambient_status()` / `get_ambient_transcripts()` | Ambient mode status |
| `trigger_ambient()` / `stop_ambient()` | Ambient mode control |
| `get_browser_status()` / `setup_browser()` | Browser automation setup |
| `send_transcript(text, mode)` | Send a transcript/dictation result |
| `run_dictation()` | Run voice dictation |
| `list_workspace_files(working_dir)` | List files in a workspace |
| `git_status(working_dir)` | Get git status for a workspace |
| `save_session_state(session_id, working_dir)` | Persist last active session |
| `get_last_session_state()` / `clear_session_state()` | Session state persistence |

## Workspace / Session Model

- Sessions are organized by `working_dir` (workspace). `null` or missing = "default" workspace.
- Memory preference is per-workspace and persisted via `get_workspace_memory_preferences` / `set_workspace_memory_preference`.
- Session sidebar shows grouped sessions by workspace, expandable/collapsible.
- Swarm mode: multiple sessions can coordinate within the same workspace. One session acts as coordinator, others as agents.

## Slash Commands

The app supports a rich slash command system defined in `src/components/SlashCommands.tsx`:

**Frontend-handled commands** (executed locally without sending to backend):
- `/model [name]` / `/models [name]` — List or switch AI model
- `/effort <low|medium|high|auto>` — Set reasoning effort
- `/memory` — Toggle memory feature on/off
- `/clear` — Clear conversation history
- `/compact` — Compact context (background summarisation)
- `/rewind <N|undo>` — Rewind to a previous message
- `/git` — Show git status for the working directory
- `/help [command]` — Show help and available commands

**Backend-passed commands** (sent to the agent for execution):
- `/btw <question>` — Ask a side question in the background
- `/review` — Launch a one-shot review session
- `/judge` — Launch a one-shot judge session
- `/poke [on|off|status]` — Poke model to resume with incomplete todos
- `/fix` — Recover when the model cannot continue
- `/refactor [focus]` — Run a safe refactor loop
- `/improve` — Autonomously improve the repository
- `/overnight` — Run a supervised overnight coordinator
- `/convene` — Convene all agents in this workspace
- `/context` — Show full session context snapshot
- `/info` — Show session info and token usage
- `/version` — Show current version
- `/subagent <prompt>` — Launch a subagent manually
- `/agents [role]` — Configure models for agent roles
- `/observe [on|off|status]` — Show latest tool context in the side panel

## Code Style and Conventions

- **TypeScript**: Strict mode with `noUnusedLocals` and `noUnusedParameters`. The compiler will error on unused variables.
- **Imports**: Use `@/` path alias for project imports (e.g., `@/hooks/useJcodeSession`, `@/components/ui/button`).
- **Tailwind v4**: Configured via Vite plugin (`@tailwindcss/vite`), not a traditional `tailwind.config.js`. Theme tokens are CSS custom properties in `src/App.css`.
- **shadcn/ui**: Style is `base-nova`. Icon library is `lucide`. New components are added via `npx shadcn add <component>`.
- **React**: Functional components with hooks. No class components.
- **Component props**: Prefer explicit interface definitions over inline types.
- **Event handling**: `void handler()` pattern is common when we don't want to await promises in JSX event handlers.
- **Streaming markdown**: The `ai-elements` and `streamdown` packages handle message rendering. CJK, code blocks, math (KaTeX), and mermaid diagrams are supported via streamdown plugins.
- **No ESLint/Prettier configs**: The project relies on TypeScript strict mode for quality enforcement. There is no `.eslintrc` or `.prettierrc`.
- **Native app feel**: `App.css` sets `cursor: default !important` globally and disables text selection on chrome elements to mimic native desktop app behavior.

## Theme System

- Themes are light/dark/system, persisted in `localStorage` under `jcode-theme`.
- `index.html` contains an inline script that applies the theme class before React hydrates to prevent flash.
- CSS variables are defined in `src/App.css` under `:root` (light) and `.dark` (dark).
- `useTheme.ts` manages theme state and syncs `meta[name="theme-color"]` for mobile browsers.

## Security Considerations

- `tauri.conf.json` sets `csp: null` (Content Security Policy is disabled). Be cautious if adding external resources.
- The backend has access to the filesystem (session files in `~/.jcode/sessions/`), process execution (tools), and environment variables.
- Provider API keys and OAuth tokens are managed by the parent `jcode` crate's auth system, not stored in the frontend.
- `StdinInputModal` supports password masking (`is_password`) for sensitive interactive prompts.

## Important Notes for Agents

- When modifying Rust backend code, remember the `jcode` crate lives at `../../` relative to `src-tauri/`. Changes to the agent core, protocol, or provider system require building from the repo root.
- The `ai` npm package (v6) is listed as a dependency but is primarily used transitively through `ai-elements`.
- `streamdown` plugins are eagerly imported in `main.tsx` or component files for side effects.
- Session files are JSON files stored in the user's `~/.jcode/sessions/` directory. The backend reads them directly; the frontend never sees the raw file paths.
- The `SessionSidebar` component groups sessions into workspaces based on `working_dir`. The "default" workspace is a special case for sessions with no working directory.
- The `App.tsx` component manages workspace switching, session restoration on startup, slash command interception, and `@AgentName` mention routing in swarm mode.
