# Repository Guidelines

## Project Overview

**JCode App** is a Tauri v2 desktop application for the JCode coding agent. It wraps the Rust `jcode` agent core with a React 19 / TypeScript frontend. This is the **Tauri-based** desktop app; the `crates/jcode-desktop/` directory in the parent repo is a separate wgpu/winit native experiment.

## Architecture & Data Flow

### Frontend-Backend Bridge
The app uses Tauri's `invoke` / `listen` event model:

1. Frontend calls `invoke("begin_session", ...)` or `invoke("resume_session", ...)`
2. Backend (`src-tauri/src/lib.rs`) creates a `jcode::Agent` with a `Session`, spawns a tokio task
3. Agent emits `jcode::protocol::ServerEvent`s → backend serializes to JSON → emits `"server-event"` Tauri events
4. Frontend `useJcodeSession` listens via `listen("server-event", ...)` and dispatches reducer actions

### Frontend State (`useJcodeSession`)
- Single `useReducer` with discriminated-union actions (~50+ action types)
- `SessionState` tracks: `messages`, `sessions`, `providerName`, `providerModel`, `availableModels`, `isProcessing`, `stdinPrompt`, `workingDir`, `sessionData`, etc.
- `sessionData: Record<string, PerSessionData>` preserves per-session state across workspace switches
- `listSessions()` polls the backend to refresh the sidebar

### Backend State (`AppState` in `commands.rs`)
- `runtimes: HashMap<String, Arc<SessionRuntime>>` — active session runtimes
- `active_session_id` — focused session
- `pending_stdin` — stdin request ID → response channel map
- `live_swarm_members`, `live_swarm_plans`, `live_swarm_proposals` — swarm coordination

### Event Protocol
`rawServerEventToDesktopEvents()` in `src/lib/serverEventAdapter.ts` maps raw protocol events to `DesktopSemanticEvent`s:
- Text: `text_delta`, `text_replace`
- Tools: `tool_start`, `tool_input`, `tool_exec`, `tool_done`
- Session: history loading, compaction, rewind, clear chat
- Swarm: status, plan, proposal events

## Key Directories

```
jcode-app/
├── src/
│   ├── main.tsx              # React root (StrictMode)
│   ├── App.tsx               # Main layout: nav + sidebar + chat + dialogs
│   ├── types.ts              # Central type definitions (~800 lines)
│   ├── App.css               # Tailwind v4 theme, CSS variables, light/dark
│   ├── hooks/
│   │   ├── useJcodeSession.ts # Core state hook (~2200 lines)
│   │   └── useTheme.ts       # Theme with localStorage persistence
│   ├── lib/
│   │   ├── serverEventAdapter.ts  # Protocol event mapping
│   │   └── utils.ts               # `cn()` (clsx + tailwind-merge)
│   └── components/
│       ├── ChatArea.tsx           # Message list + input + slash commands
│       ├── ChatView.tsx           # Scroll container with unread separators
│       ├── MessageBubble.tsx      # Streaming message rendering
│       ├── InputArea.tsx          # Text input, image paste, send/cancel
│       ├── NavBar.tsx             # Left nav (chat / agents tabs)
│       ├── ConversationsList.tsx  # Session list with unread badges
│       ├── SessionSidebar.tsx     # Workspace-grouped session list
│       ├── SessionSwitcherDialog.tsx  # Cmd/Ctrl+P session search
│       ├── CreateSessionDialog.tsx    # New session (normal / swarm)
│       ├── ModelSelector.tsx      # Provider/model combobox
│       ├── ActivityPanel.tsx      # Right-side activity/metadata
│       ├── ToolCard.tsx           # Tool execution display
│       ├── StdinInputModal.tsx    # Interactive stdin prompt
│       ├── SlashCommands.tsx      # Slash command palette
│       ├── ai-elements/           # Wrappers around ai-elements
│       └── ui/                    # shadcn/ui primitives
├── src-tauri/
│   ├── src/
│   │   ├── main.rs             # Entry → `jcode_app_lib::run()`
│   │   ├── lib.rs              # Tauri commands, events, sessions (~3500 lines)
│   │   └── commands.rs         # AppState, SessionRuntime, factories
│   ├── Cargo.toml              # Rust deps: tauri 2.11, tokio, jcode workspace
│   └── tauri.conf.json         # Window config, CSP (null), macOS private API
├── package.json                # Vite 7, React 19, Tailwind v4, pnpm
├── vite.config.ts              # Port 1420, @/ alias, Tailwind v4 plugin
├── tsconfig.json               # Strict TS, noUnusedLocals, noUnusedParameters
└── components.json             # shadcn/ui (style: base-nova)
```

## Development Commands

Run all commands from inside `jcode-app/` unless noted.

### Frontend
```bash
pnpm dev      # Dev server on port 1420
pnpm build    # tsc + vite build
pnpm tsc      # Type check only
```

### Full Desktop App
```bash
pnpm tauri dev   # Tauri dev mode (Rust + Vite)
pnpm tauri build # Production build
```

### Rust Backend
Run from the **parent repo root** (`../..`):
```bash
cargo check               # Fast check
cargo build -p jcode-app  # Build desktop crate
cargo test                # All Rust tests (none in jcode-app/ itself)
```

## Code Conventions & Common Patterns

### TypeScript
- **Strict mode** with `noUnusedLocals` and `noUnusedParameters` — unused variables are compile errors
- Use `@/` path alias for project imports: `@/hooks/useJcodeSession`, `@/components/ui/button`
- Prefer explicit interface definitions for component props
- `void handler()` pattern is common when promises should not be awaited in JSX handlers

### React
- Functional components with hooks only; no class components
- `React.StrictMode` is enabled in `main.tsx`

### Styling
- **Tailwind CSS v4** via Vite plugin (`@tailwindcss/vite`); no `tailwind.config.js`
- Theme tokens are CSS custom properties in `src/App.css` under `@theme inline`
- Light/dark themes via `:root` and `.dark` selectors
- **shadcn/ui** style: `base-nova`. Icons: `lucide-react`
- `cn()` helper (`clsx` + `tailwind-merge`) for conditional class composition

### UI Components
- Built on `@base-ui/react` primitives + `@radix-ui/react-slot`
- `class-variance-authority` (cva) for component variants (e.g., `buttonVariants`)
- Example pattern in `src/components/ui/button.tsx`:
  ```tsx
  const buttonVariants = cva("group/button inline-flex ...", { variants: { ... } });
  function Button({ className, variant = "default", size = "default", ...props }) { ... }
  ```

### State & Events
- Centralized `useReducer` in `useJcodeSession.ts` with action types like:
  ```ts
  type Action =
    | { type: "CONNECT" }
    | { type: "DISCONNECT" }
    | { type: "ADD_MESSAGE"; payload: Message }
    | ...
  ```
- Tauri events received via `listen("server-event", handler)` from `@tauri-apps/api/event`
- Backend commands invoked via `invoke("command_name", args)` from `@tauri-apps/api/core`

### Streaming Content
- AI messages rendered with `ai-elements` + `streamdown`
- Streamdown plugins for CJK, code blocks, math (KaTeX), mermaid diagrams
- Plugins eagerly imported in component files for side effects

### Native App Feel
- `cursor: default !important` globally in `App.css`
- Text selection disabled on chrome elements
- `acceptFirstMouse: true` in Tauri window config

## Important Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | React mount point (StrictMode) |
| `src/App.tsx` | Root layout, workspace/session orchestration, slash command routing |
| `src/types.ts` | All event types, UI state types, session types (~800 lines) |
| `src/hooks/useJcodeSession.ts` | Core state hook: reducer, Tauri invokes, event listeners |
| `src/lib/serverEventAdapter.ts` | Maps raw `ServerEvent` → `DesktopSemanticEvent` |
| `src/components/SlashCommands.tsx` | Slash command palette and definitions |
| `src-tauri/src/lib.rs` | All Tauri commands, event streaming, session management |
| `src-tauri/src/commands.rs` | `AppState`, `SessionRuntime`, agent/provider factories |
| `src-tauri/Cargo.toml` | Rust deps; depends on `jcode` workspace crate at `../../` |
| `src-tauri/tauri.conf.json` | Window size, CSP (disabled), macOS private API |
| `index.html` | Inline theme hydration script to prevent flash |
| `src/App.css` | Tailwind v4 imports, CSS variables, light/dark themes |

## Runtime/Tooling Preferences

| Tool | Version / Choice |
|------|-----------------|
| Package manager | **pnpm** |
| Frontend bundler | Vite 7 |
| React | 19 (strict mode) |
| TypeScript | 5.8 (strict, `noUnusedLocals`, `noUnusedParameters`) |
| Tailwind | v4 via `@tailwindcss/vite` |
| UI library | shadcn/ui (base-nova) on `@base-ui/react` |
| Icons | `lucide-react` |
| Animations | `motion` |
| AI rendering | `ai-elements` + `streamdown` |
| Backend | Tauri v2 (Rust 2021) |
| Rust deps | tauri 2.11, tokio, chrono, serde, anyhow |
| No ESLint/Prettier | Quality enforced by TS strict mode only |

### Path Aliases
- `@/*` → `./src/*` (Vite `resolve.alias` + TS `paths`)

### Theme System
- Light/dark/system persisted in `localStorage` under `jcode-theme`
- Theme class applied before React hydration (inline script in `index.html`)

## Testing & QA

- **No tests in `jcode-app/` itself.** All Rust tests live in the parent `jcode` workspace.
- Run `cargo test` from the repo root for backend validation.
- Frontend quality is enforced by TypeScript strict mode (`pnpm tsc`).
- The parent workspace runs CI gates: `cargo fmt`, `cargo clippy`, warning budgets, code size budgets, panic budgets.

### Security Notes
- `tauri.conf.json` sets `csp: null` (disabled). Be cautious adding external resources.
- Backend has filesystem access (`~/.jcode/sessions/`), process execution, and environment access.
- API keys and OAuth tokens managed by the parent `jcode` crate's auth system — never stored in frontend.
