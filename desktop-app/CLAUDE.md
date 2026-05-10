# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **JCode Desktop**, a Tauri v2 desktop application for the JCode coding agent. It wraps the Rust `jcode` agent core with a React/TypeScript frontend.

**Important distinction**: The `crates/jcode-desktop/` directory in the parent repo is a *separate* wgpu/winit native desktop implementation. This `desktop-app/` directory is the **Tauri-based** desktop app.

## Architecture

### Frontend (`src/`)
- **React 19** with Vite, TypeScript strict mode, Tailwind CSS v4
- **UI framework**: shadcn/ui (base-nova style) via `@base-ui/react` and `@radix-ui/react-slot`
- **AI message rendering**: `ai-elements` + `streamdown` (streaming markdown with CJK/math/mermaid/code plugins)
- **State management**: Single `useJcodeSession` hook with a reducer pattern (`SessionState` + action types)
- **Icons**: `lucide-react`
- **Animations**: `motion`
- Path alias `@/` maps to `src/`

### Backend (`src-tauri/src/`)
- **Tauri v2** Rust app depending on the `jcode` crate (`path = "../../"`)
- **`lib.rs`**: ~90KB, defines all Tauri commands and event streaming logic
- **`commands.rs`**: `AppState`, `SessionRuntime`, agent/provider factory functions
- **Session model**: Each session gets a `SessionRuntime` (agent + cancel signal + processing state) stored in `AppState.runtimes`. Only one session is "active" at a time.
- **Event protocol**: Backend emits `server-event` Tauri events. Frontend listens via `listen("server-event", ...)` and feeds events into `rawServerEventToDesktopEvents()` in `src/lib/serverEventAdapter.ts`

### Communication Flow
1. Frontend calls `invoke("begin_session", ...)` or `invoke("resume_session", ...)`
2. Backend creates a `jcode::Agent` with a `Session`, spawns a tokio task
3. Agent produces `jcode::protocol::ServerEvent`s → backend maps them to JSON → emits `"server-event"`
4. Frontend `useJcodeSession` listens and dispatches actions to the reducer

## Common Commands

### Development
```bash
# Tauri dev mode (builds Rust backend + starts Vite frontend)
pnpm tauri dev

# Frontend only (Vite dev server on port 1420)
pnpm dev

# Frontend production build
pnpm build

# Type check
pnpm tauri
```

### Rust Backend
All Rust commands run from the **parent repo root** (`../..`):
```bash
# Fast check while iterating
cargo check

# Build the desktop app (from parent root)
cargo build -p desktop-app

# Or use the Tauri CLI from within desktop-app/
pnpm tauri build

# Remote build (if local resources are constrained)
../scripts/remote_build.sh
```

### Running
There are no tests in `desktop-app/` itself. The parent `jcode` workspace contains tests run via `cargo test`.

## Key Files and Concepts

### Frontend State (`src/hooks/useJcodeSession.ts`)
- `SessionState` tracks: `connected`, `connecting`, `messages`, `sessions`, `providerName`, `providerModel`, `availableModels`, `availableModelRoutes`, `isProcessing`, `stdinPrompt`, `workingDir`, `reasoningEffort`, `memoryEnabled`, `queuedDrafts`, `expandedWorkspaces`
- Actions like `APPEND_TEXT`, `TOOL_START`, `TOOL_DONE`, `MODEL_CHANGED`, `STDIN_REQUEST`, `LOAD_HISTORY`, etc.
- `listSessions()` polls every 2s when connected to refresh the session sidebar

### Tauri Commands
Key commands defined in `src-tauri/src/lib.rs`:
- `begin_session(working_dir, model, memory_enabled)` — start new session
- `resume_session(session_id, working_dir)` — load existing session
- `send_message(content, images, system_reminder)` — send user message to active session
- `cancel()` — interrupt current agent run
- `set_model(model)` — switch model mid-session
- `set_memory_enabled(enabled)` — toggle memory feature
- `list_sessions()` — returns all sessions with metadata
- `clear_chat()` / `rewind_chat(visible_conversation_count)` / `compact_context()` — session management
- `send_stdin_response(response)` — respond to tool stdin prompts
- `get_models()` — list available models and auth state
- `save_provider_api_key` / `start_provider_auth_flow` / `complete_provider_auth_flow` — provider auth
- `delete_session(session_id)` / `delete_workspace_sessions(working_dir)` — cleanup
- `get_workspace_memory_preferences()` / `set_workspace_memory_preference(working_dir, enabled)` — per-workspace memory defaults

### Server Event Adapter (`src/lib/serverEventAdapter.ts`)
Translates raw `jcode` protocol events into frontend `DesktopSemanticEvent`s. Handles text streaming, tool execution lifecycle, token usage, session ID assignment, model changes, stdin prompts, swarm status, etc.

### Types (`src/types.ts`)
Central type definitions for `ChatMessage`, `ServerEvent`, `SessionInfo`, `ToolExecution`, `ModelRoute`, `StdinPrompt`, and swarm-related types.

## Workspace / Session Model
- Sessions are organized by `working_dir` (workspace). `null` or missing = "default" workspace.
- Memory preference is per-workspace and persisted via `get_workspace_memory_preferences` / `set_workspace_memory_preference`.
- Session sidebar shows grouped sessions by workspace, expandable/collapsible.

## Important Notes
- `tsconfig.json`: strict TypeScript with `noUnusedLocals` and `noUnusedParameters` enabled
- Tailwind v4 is configured via Vite plugin (`@tailwindcss/vite`), not a traditional `tailwind.config.js`
- `components.json` is shadcn/ui config (style: base-nova, iconLibrary: lucide)
- The `ai` package (v6) is imported but appears to be used indirectly via `ai-elements`
- `streamdown` plugins are imported for CJK, code blocks, math, and mermaid rendering
