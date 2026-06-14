# Repository Guidelines

## Project Overview

**JFlow** is the Tauri v2 desktop client for the JFlow AI coding agent. It wraps the Rust `jcode` agent/server core in a React 19 / TypeScript frontend. The app is currently evolving from a traditional multi-pane workbench into a **Raycast-style launcher + expandable workbench** model.

> **Not the native desktop experiment.** The shipping desktop app lives in `jcode-app/` (Tauri + webview). The separate `crates/jcode-desktop/` wgpu/winit experiment in the parent repo is a long-term research project.

## Architecture & Data Flow

### Three-window SPA

`src-tauri/tauri.conf.json` declares three windows that all load the same bundled `index.html`; `src/main.tsx` branches on `getCurrentWebviewWindow().label`:

| Window | Label | Purpose |
|--------|-------|---------|
| Workbench | `workbench` | Main 1200×800 agent workspace (chat, sessions, tools, settings) |
| Launcher | `launcher` | 720×420 always-on-top command palette (apps, sessions, builtin pages, agent queries) |
| Pages | `pages` | 960×680 settings/providers/MCP/skills/swarm window |

### Frontend → Backend → Frontend Flow

```
User input
  → useJcodeSession action
  → invoke("<command>", { ... })
  → src-tauri/src/lib.rs command handler
  → local SessionRuntime or ServerClient
  → agent.run_once_streaming_mpsc(...)
  → ServerEvent stream
  → app_handle.emit("server-event", payload)
  → frontend listen("server-event")
  → serverEventAdapter.ts → DesktopSemanticEvent
  → processEvent.ts → reducer actions
  → React re-render
```

### State Management

- **Single reducer**: `src/hooks/sessionReducer.ts` owns all session state; `useJcodeSession.ts` provides actions and wires Tauri listeners.
- **Per-session map**: `sessionData: Record<string, PerSessionData>` preserves state across workspace switches; the active session is denormalized to the top-level `SessionState`.
- **Virtual workspace threads**: synthetic IDs like `workspace:<dir>` let the frontend show a unified chat for sessions that share a working directory.
- **Workspace = workingDir**: `workspaceId` is derived from `workingDir`; `"default"` means no directory.

### Backend State

- `AppState` (`src-tauri/src/commands.rs`) holds active runtimes, provider cache, swarm snapshots, pending stdin responses, and launcher app index.
- `SessionRuntime` wraps an `Arc<Mutex<Agent>>` plus cancel/processing/status signals.
- `ServerClient` (`src-tauri/src/server_client.rs`) is an optional Unix-socket client for server-backed sessions.
- **Dual session model**: handlers check whether a session is server-managed; local sessions run directly, server-managed sessions are forwarded via `jcode::protocol::Request`.

### Event Protocol

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
│   │   ├── commands.rs         # AppState, SessionRuntime, factories
│   │   ├── server_client.rs    # Optional jcode server socket client
│   │   ├── launcher.rs         # macOS app discovery + launch helpers
│   │   └── utils.rs            # Serialization helpers
│   ├── Cargo.toml              # Rust deps + workspace link
│   ├── tauri.conf.json         # Windows, plugins, capabilities, CSP
│   └── capabilities/default.json
├── docs/                       # jcode-app-specific design docs and plans
├── package.json
├── vite.config.ts
├── tsconfig.json
├── components.json             # shadcn/ui base-nova config
└── pnpm-workspace.yaml
```

## Development Commands

Run Node commands from `jcode-app/`; run Cargo commands from the parent repo root (`~/www/jcode`).

### Frontend

```bash
pnpm dev       # Vite dev server on port 1420
pnpm build     # tsc + vite build
pnpm tsc       # Type check only
pnpm preview   # Preview production build
```

### Full Desktop App

```bash
pnpm tauri dev    # Rust + Vite dev
pnpm tauri build  # Production Tauri bundle
```

### Rust

```bash
cargo check -p jcode-app
cargo build -p jcode-app
cargo clippy -p jcode-app -- -D warnings
cargo test -p jcode-app --lib --bins
```

### Parent Workspace (from repo root)

```bash
cargo check --all-targets --all-features
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --all -- --check
scripts/test_fast.sh
scripts/test_e2e.sh
```

## Code Conventions & Common Patterns

### TypeScript

- **Strict mode** with `noUnusedLocals` and `noUnusedParameters`; unused variables are compile errors.
- Path alias `@/` maps to `./src/*`.
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
- Light/dark themes via `:root` and `.dark` selectors.
- **shadcn/ui** style `base-nova`; icons from `lucide-react`.
- `cn()` = `clsx` + `tailwind-merge` for conditional classes.
- Transparent/undecorated windows: `body` is transparent and each top-level component paints its own `bg-background` surface; `body`/`#root` clip to rounded corners.

### Tauri Backend

- Commands use `#[tauri::command]` and live in `src-tauri/src/lib.rs`.
- Window config in `tauri.conf.json`: `workbench`/`launcher` use `decorations: false` + `transparent: true`; `pages` uses native decorations.
- `data-tauri-drag-region` is used explicitly on draggable areas (e.g., `TitleBar.tsx`).
- macOS private API is enabled; capabilities are scoped in `capabilities/default.json`.

### Serialization & Communication

- Snake_case command names in Rust; `#[serde(rename_all = "camelCase")]` for typed request structs.
- Backend emits many ad-hoc `serde_json::json!` payloads; frontend maps them manually in hooks/adapters.
- `ServerEvent` is the central wire type from `jcode::protocol`.

### State & Dependency Injection

- `AppState` is a Tauri managed state shared across commands.
- Provider is lazily cached and cleared on config changes.
- `localStorage` is used for theme and launcher MRU/frequency; theme syncs across windows via `storage` events.

### Streaming Content

- AI messages rendered with `ai-elements` + `streamdown`.
- Streamdown plugins for CJK, code blocks, math (KaTeX), mermaid diagrams.

## Important Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | React mount point; selects root by Tauri window label |
| `src/App.tsx` | Workbench root layout |
| `src/components/Launcher.tsx` | Always-on-top command palette |
| `src/components/PagesApp.tsx` | Settings/providers/MCP/skills/swarm tabs |
| `src/hooks/useJcodeSession.ts` | Session API, Tauri invoke/listen wiring |
| `src/hooks/sessionReducer.ts` | Central session state reducer |
| `src/hooks/processEvent.ts` | Event → reducer action routing |
| `src/lib/serverEventAdapter.ts` | Raw `ServerEvent` → `DesktopSemanticEvent` |
| `src/types.ts` | Domain types |
| `src/App.css` | Tailwind v4 theme, CSS variables, window transparency |
| `index.html` | Inline theme hydration script |
| `src-tauri/src/lib.rs` | Tauri commands, event streaming, session management |
| `src-tauri/src/commands.rs` | `AppState`, `SessionRuntime`, factories |
| `src-tauri/src/server_client.rs` | Optional server socket client |
| `src-tauri/src/launcher.rs` | macOS application discovery/launch |
| `src-tauri/tauri.conf.json` | Window model, plugins, capabilities, CSP |
| `src-tauri/Cargo.toml` | Rust deps; depends on parent `jcode` workspace |
| `vite.config.ts` | Vite + React Compiler + Tailwind v4 + bundle analyzer |
| `tsconfig.json` | Strict TypeScript config |
| `components.json` | shadcn/ui base-nova config |

## Runtime/Tooling Preferences

| Tool | Version / Choice |
|------|-----------------|
| Package manager | **pnpm** |
| Frontend bundler | Vite 7 |
| React | 19 (strict mode) |
| TypeScript | 5.8 (strict, `noUnusedLocals`, `noUnusedParameters`) |
| Tailwind | v4 via `@tailwindcss/vite` |
| UI library | shadcn/ui `base-nova` on `@base-ui/react` |
| Icons | `lucide-react` |
| Animations | `motion` |
| AI rendering | `ai-elements` + `streamdown` |
| Backend | Tauri v2.11 (Rust 2021) |
| Rust workspace | Parent `jcode` workspace includes `jcode-app/src-tauri` |
| Build helper | `scripts/dev_cargo.sh` (sccache, fast linker, adaptive jobs) |
| No ESLint/Prettier | Quality enforced by TypeScript strict mode |

### Path Aliases

- `@/*` → `./src/*` (Vite + TS `paths`).

### Theme System

- Light/dark/system persisted in `localStorage` under `jcode-theme`.
- Theme class is applied before React hydration (inline script in `index.html`).

## Testing & QA

### Frontend

- `jcode-app` has **no JS/TS tests or lint/format scripts** currently.
- Quality is enforced by TypeScript strict mode via `pnpm build` (`tsc && vite build`).

### Rust

- `cargo test -p jcode-app --lib --bins` currently compiles and reports 0 tests; there are no `#[test]` modules in `src-tauri/src/`.
- `cargo check -p jcode-app` and `cargo clippy -p jcode-app -- -D warnings` are the local gates.

### CI (parent workspace)

`.github/workflows/ci.yml` runs:

- `cargo fmt --all -- --check`
- `cargo check --all-targets --all-features`
- `cargo clippy --all-targets --all-features -- -D warnings`
- Warning, code-size, test-size, panic, and swallowed-error budgets via `scripts/check_*_budget.*`
- Linux/macOS/Windows builds and e2e tests

> **Note:** CI does not currently build or type-check the Tauri front-end; `pnpm build` is not invoked in CI.

### Quality Budgets (from repo root)

```bash
scripts/check_warning_budget.sh
python3 scripts/check_code_size_budget.py
python3 scripts/check_test_size_budget.py
python3 scripts/check_panic_budget.py
python3 scripts/check_swallowed_error_budget.py
```

Most budget scripts scan `src/` and `crates/` but not `jcode-app/src-tauri/`, except for the warning budget which is hit by workspace-wide `cargo check`.

### Security Notes

- `tauri.conf.json` sets `csp: null` (disabled). Be cautious adding external resources.
- The backend has filesystem access (`~/.jcode/sessions/`), process execution, and environment access.
- API keys and OAuth tokens are managed by the parent `jcode` crate's auth system — never stored in the frontend.
