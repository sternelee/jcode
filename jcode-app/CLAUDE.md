# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**JFlow** (`jcode-app/`) is the Tauri v2 desktop client wrapping the parent `jcode` Rust AI coding agent. It is evolving from a multi-pane workbench into a **Raycast-style launcher + expandable workbench**.

The parent repo contains a 60+ crate Rust workspace. The shipping desktop app lives in **`jcode-app/`** (Tauri + webview). The separate `crates/jcode-desktop/` wgpu/winit experiment in the parent repo is a long-term research project — **not** the shipping desktop.

Parent repo: `~/www/jcode/`. Run Node commands from `jcode-app/`; run Cargo commands from the **parent repo root** so the workspace is honored.

## Three-Window SPA

`src-tauri/tauri.conf.json` declares three windows that all load the same bundled `index.html`; `src/main.tsx` branches on `getCurrentWebviewWindow().label`:

| Window | Label | Size | Decorations | Purpose |
|--------|-------|------|-------------|---------|
| Workbench | `workbench` | 1200×800 | none, transparent | Main agent workspace (chat, sessions, tools, settings) |
| Launcher | `launcher` | 720×420, always-on-top | none, transparent | Raycast-style command palette (apps, sessions, builtin pages, agent queries) |
| Pages | `pages` | 960×680 | native | Settings / providers / MCP / skills / swarm |

Drag regions are marked explicitly with `data-tauri-drag-region` (e.g., `TitleBar.tsx`).

## Frontend → Backend → Frontend Flow

```
User input
  → useJcodeSession action
  → invoke("<command>", { ... })
  → src-tauri/src/lib.rs command handler
  → local SessionRuntime or ServerClient (optional Unix-socket)
  → agent.run_once_streaming_mpsc(...)
  → ServerEvent stream
  → app_handle.emit("server-event", payload)
  → frontend listen("server-event")
  → lib/serverEventAdapter.ts → DesktopSemanticEvent
  → hooks/processEvent.ts → reducer actions
  → React re-render
```

## State Management

- **Single reducer**: `src/hooks/sessionReducer.ts` is the single source of truth; `useJcodeSession.ts` provides actions and wires Tauri listeners.
- **Per-session map**: `sessionData: Record<string, PerSessionData>` preserves state across workspace switches; the active session is denormalized to the top-level `SessionState`.
- **Virtual workspace threads**: synthetic IDs like `workspace:<dir>` let the frontend show a unified chat for sessions sharing a working directory.
- **Workspace = workingDir**: `workspaceId` is derived from `workingDir`; `"default"` means no directory.

### Backend State (Rust)

- `AppState` (`src-tauri/src/commands.rs`) holds active runtimes, provider cache, swarm snapshots, pending stdin responses, launcher app index.
- `SessionRuntime` wraps an `Arc<Mutex<Agent>>` plus cancel/processing/status signals.
- `ServerClient` (`src-tauri/src/server_client.rs`) is an optional Unix-socket client for server-backed sessions.
- **Dual session model**: handlers check whether a session is server-managed; local sessions run directly, server-managed sessions are forwarded via `jcode::protocol::Request`.

## Event Protocol

`src/lib/serverEventAdapter.ts` maps raw `ServerEvent` shapes to `DesktopSemanticEvent`s:

- `text_delta` / `text_replace`
- `tool_start` / `tool_input` / `tool_exec` / `tool_done`
- Session lifecycle: history load, compaction, rewind, clear
- Swarm: status, plan summaries, proposals

## Key Directories

```
jcode-app/
├── src/
│   ├── main.tsx                 # React entry; picks root by window label
│   ├── App.tsx                  # Workbench root layout
│   ├── App.css                  # Tailwind v4 theme, tokens, light/dark
│   ├── types.ts                 # Central TS types
│   ├── rolePresets.ts           # Preset agent roles
│   ├── hooks/
│   │   ├── useJcodeSession.ts   # Session API + Tauri listeners
│   │   ├── sessionReducer.ts    # Single source of truth for session state
│   │   ├── processEvent.ts      # Routes events to reducer actions
│   │   ├── useLauncher.ts       # Launcher query, MRU, selection state
│   │   ├── useApplications.ts   # macOS app discovery polling
│   │   └── useTheme.ts          # Theme persistence/sync
│   ├── lib/
│   │   ├── serverEventAdapter.ts   # ServerEvent → DesktopSemanticEvent
│   │   ├── messageAdapter.ts       # ChatMessage → UIMessage
│   │   ├── launcherTypes.ts        # Launcher item types
│   │   └── utils.ts                # cn() helper
│   └── components/
│       ├── Launcher.tsx             # Command palette window
│       ├── PagesApp.tsx             # Settings/pages window
│       ├── LauncherCommandItem.tsx  # Unified launcher row
│       ├── ChatArea.tsx             # Chat surface
│       ├── MessageBubble.tsx        # Streaming message render
│       ├── InputArea.tsx            # Text input + image paste
│       ├── TitleBar.tsx             # Custom drag region + traffic lights
│       ├── LeftSidebar.tsx          # Session/workspace sidebar
│       ├── RightSidebar.tsx         # Activity/metadata panel
│       ├── SlashCommands.tsx        # Slash command palette
│       ├── ToolCard.tsx             # Tool execution display
│       ├── StdinInputModal.tsx      # Interactive stdin prompt
│       └── ui/                      # shadcn/ui primitives
├── src-tauri/
│   ├── src/
│   │   ├── main.rs             # Entry → jcode_app_lib::run()
│   │   ├── lib.rs              # Tauri commands, events, sessions (~4k lines)
│   │   ├── commands.rs         # AppState, SessionRuntime, factories; re-exports modules below
│   │   ├── commands/
│   │   │   ├── config.rs       # Config view/edit commands
│   │   │   ├── env.rs          # Environment variable management
│   │   │   ├── launcher.rs     # macOS app discovery/launch commands
│   │   │   ├── memory.rs       # Memory list/search/export/import/stats
│   │   │   ├── provider.rs     # Provider profiles, auth flows, model listing
│   │   │   ├── session.rs      # begin/resume/send/cancel/clear/rewind/compact
│   │   │   ├── swarm.rs        # Swarm status and coordination
│   │   │   ├── system.rs       # Version info, usage, git status
│   │   │   └── tools.rs        # Tool registry and MCP tool commands
│   │   ├── server_client.rs    # Optional jcode server socket client
│   │   ├── launcher.rs         # macOS app discovery + launch helpers
│   │   ├── error.rs            # TauriError unified error enum (thiserror-derived)
│   │   └── utils.rs            # Serialization helpers
│   ├── Cargo.toml              # Rust deps + workspace link
│   ├── tauri.conf.json         # Windows, plugins, capabilities, CSP
│   └── capabilities/default.json
├── docs/
│   ├── plans/                  # Design docs (e.g. raycast launcher workbench)
│   ├── AGENT_TEAM_GUI_REVIEW.md
│   └── tui-to-desktop-gap.md
├── SLACK_MODE_REVIEW.md        # Slack-based review workflow
├── package.json
├── vite.config.ts
├── tsconfig.json
├── components.json             # shadcn/ui base-nova config
└── pnpm-workspace.yaml
```

## Development Commands

### Frontend (from `jcode-app/`)

```bash
pnpm dev       # Vite dev server on port 1420
pnpm build     # tsc + vite build
pnpm tsc       # Type check only
pnpm preview   # Preview production build
```

### Full Desktop App (from `jcode-app/`)

```bash
pnpm tauri dev    # Rust + Vite dev
pnpm tauri build  # Production Tauri bundle
```

### Rust (from parent repo root)

```bash
cargo check -p jcode-app
cargo build -p jcode-app
cargo clippy -p jcode-app -- -D warnings
cargo test -p jcode-app --lib --bins
```

### Parent Workspace (from `~/www/jcode/`)

```bash
cargo check --all-targets --all-features
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --all -- --check
scripts/test_fast.sh
scripts/test_e2e.sh
```

`scripts/dev_cargo.sh` is the preferred build wrapper on Linux x86_64 — auto-detects sccache and fast linkers (lld/mold + clang). Set `JCODE_DEV_FEATURE_PROFILE` to `default`, `minimal`, `pdf`, `embeddings`, or `full`.

## Tauri Backend Commands

Commands use `#[tauri::command]` and live in `src-tauri/src/lib.rs`. Snake_case command names in Rust; `#[serde(rename_all = "camelCase")]` for typed request structs.

- Command handlers return `Result<T, TauriError>` (defined in `error.rs`). `TauriError` is `thiserror`-derived and `Serialize`-able; Tauri sends its `Display` string to the frontend.
- `AppState` and shared types live in `commands.rs`; domain-specific handlers are in `commands/<domain>.rs` submodules (session, provider, memory, etc.).

Major command groups:
- **Sessions**: `begin_session`, `resume_session`, `send_message`, `cancel`, `send_soft_interrupt`, `clear_chat`, `rewind_chat`, `compact_context`, `set_model`, `set_memory_enabled`, `set_reasoning_effort`
- **Persistence**: `list_sessions`, `delete_session`, `delete_workspace_sessions`, `rename_session`, `save_session_state`, `get_last_session_state`, `clear_session_state`
- **Providers**: `get_models`, `save_provider_api_key`, `start_provider_auth_flow` / `complete_provider_auth_flow`, `get_auth_status`, `run_auth_doctor`, `add_provider_profile`
- **Memory**: `get_memory_list`, `search_memories`, `get_memory_stats`, `export_memories`, `import_memories`
- **Ambient**: `trigger_ambient`, `stop_ambient`, `get_ambient_status`, `get_ambient_transcripts`
- **Devices / Mobile**: `generate_pairing_code`, `list_paired_devices`, `revoke_device`
- **Browser**: `get_browser_status`, `setup_browser`
- **Voice**: `send_transcript`, `run_dictation`
- **Safety**: `get_permission_requests`, `respond_to_permission`
- **Background**: `list_background_tasks`, `cancel_background_task`
- **Misc**: `get_version_info`, `get_usage_info`, `git_status`

## Code Conventions

### TypeScript
- **Strict mode** with `noUnusedLocals` and `noUnusedParameters` — unused variables are compile errors.
- Path alias `@/*` → `./src/*` (Vite + TS `paths`).
- Explicit component prop interfaces are preferred.
- `void handler()` is common when promises should not be awaited in JSX handlers.

### React
- Functional components and hooks only; `React.StrictMode` in `main.tsx`.
- Single `useReducer` for session state; actions are discriminated unions.
- Example action shape:
  ```ts
  type Action =
    | { type: "CONNECT" }
    | { type: "ADD_MESSAGE"; payload: Message }
    | { type: "APPEND_TEXT"; payload: { sessionId: string; text: string } }
    | ...
  ```

### Styling
- **Tailwind CSS v4** via `@tailwindcss/vite`; no `tailwind.config.js`.
- Theme tokens are CSS custom properties in `src/App.css` under `@theme inline`.
- Light/dark themes via `:root` and `.dark` selectors; theme class applied before React hydration (inline script in `index.html`).
- **shadcn/ui** style `base-nova` on `@base-ui/react`; icons from `lucide-react`.
- `cn()` = `clsx` + `tailwind-merge` for conditional classes.
- Transparent/undecorated windows: `body` is transparent and each top-level component paints its own `bg-background` surface; `body`/`#root` clip to rounded corners.

### Streaming Content
- AI messages rendered with `ai-elements` + `streamdown`.
- Streamdown plugins for CJK, code blocks, math (KaTeX), mermaid diagrams.
- Vite bundles streamdown as a separate chunk (`manualChunks` in `vite.config.ts`).

### Vite & Build
- Uses `@rolldown/plugin-babel` (not `@vitejs/plugin-react`) with `babel-plugin-react-compiler` — React Compiler runs at build time.
- Bundle analysis: `ANALYZE=1 pnpm build` generates `dist/stats.html`.

### Tauri Plugins
- `tauri-plugin-dialog` — native file/message dialogs
- `tauri-plugin-global-shortcut` — system-wide hotkeys
- `tauri-plugin-shell` — open URLs/paths in default app
- `protocol-asset` — serve local files via `asset://` protocol (scoped to `/Applications/**`, `$HOME/Applications/**` in `tauri.conf.json`)

### State & Dependency Injection
- `AppState` is a Tauri managed state shared across commands.
- Provider is lazily cached and cleared on config changes.
- `localStorage` is used for theme and launcher MRU/frequency; theme syncs across windows via `storage` events.

## Tooling Versions

| Tool | Version / Choice |
|------|-----------------|
| Package manager | **pnpm** |
| Frontend bundler | Vite 7 (rolldown-based) |
| React | 19 (strict mode) |
| TypeScript | 5.8 (strict, `noUnusedLocals`, `noUnusedParameters`) |
| Tailwind | v4 via `@tailwindcss/vite` |
| UI library | shadcn/ui `base-nova` on `@base-ui/react` |
| Icons | `lucide-react` |
| Animations | `motion` |
| React Compiler | `babel-plugin-react-compiler` via `@rolldown/plugin-babel` |
| AI rendering | `ai-elements` + `streamdown` |
| Backend | Tauri v2.11 (Rust 2021) |
| Rust workspace | Parent `jcode` workspace includes `jcode-app/src-tauri` |
| Build helper | `scripts/dev_cargo.sh` (sccache, fast linker, adaptive jobs) |
| No ESLint/Prettier | Quality enforced by TypeScript strict mode via `pnpm build` (`tsc && vite build`) |

## Testing & QA

### Frontend
- `jcode-app` has **no JS/TS tests or lint/format scripts** currently. Quality is enforced by TypeScript strict mode via `pnpm build`.

### Rust
- `cargo test -p jcode-app --lib --bins` — few tests exist (currently in `error.rs` only). Most backend code has no `#[test]` modules.
- `cargo check -p jcode-app` and `cargo clippy -p jcode-app -- -D warnings` are the local gates.

### CI (parent workspace)

`.github/workflows/ci.yml` runs:
- `cargo fmt --all -- --check`
- `cargo check --all-targets --all-features`
- `cargo clippy --all-targets --all-features -- -D warnings`
- Warning, code-size, test-size, panic, and swallowed-error budgets via `scripts/check_*_budget.*`
- Linux/macOS/Windows builds and e2e tests

> CI does not currently build or type-check the Tauri front-end; `pnpm build` is not invoked in CI.

### Quality Budgets (from repo root)

```bash
scripts/check_warning_budget.sh
python3 scripts/check_code_size_budget.py
python3 scripts/check_test_size_budget.py
python3 scripts/check_panic_budget.py
python3 scripts/check_swallowed_error_budget.py
python3 scripts/check_dependency_boundaries.py
```

Most budget scripts scan `src/` and `crates/` but not `jcode-app/src-tauri/`, except for the warning budget which is hit by workspace-wide `cargo check`. Run `--update` flag on budget scripts after intentional cleanup to reset baselines.

## Security Notes

- `tauri.conf.json` sets `csp: null` (disabled). Be cautious adding external resources.
- The backend has filesystem access (`~/.jcode/sessions/`), process execution, and environment access.
- macOS private API is enabled; capabilities are scoped in `capabilities/default.json`.
- API keys and OAuth tokens are managed by the parent `jcode` crate's auth system — never stored in the frontend.

## Important Notes

- Logs: `~/.jcode/logs/jcode-YYYY-MM-DD.log`
- Server registry: `~/.jcode/servers.json`
- Install paths (parent crate): `~/.local/bin/jcode` (launcher), `~/.jcode/builds/current/` (self-dev), `~/.jcode/builds/stable/` (release).

## References

- Parent repo `CLAUDE.md` — workspace-wide guidance, build/test/lint gates, architecture overview
- Parent repo `AGENTS.md` — full repo guidelines
- `docs/plans/` — design docs (raycast launcher workbench, etc.)
- `docs/tui-to-desktop-gap.md` — feature parity tracking between TUI and desktop
- `TODO.md` — feature gap analysis and implementation status
- `SLACK_MODE_REVIEW.md` — Slack-based review workflow
- `docs/SERVER_ARCHITECTURE.md` — server design and lifecycle (parent repo)
- `docs/CRATE_OWNERSHIP_BOUNDARIES.md` — crate dependency rules (parent repo)
