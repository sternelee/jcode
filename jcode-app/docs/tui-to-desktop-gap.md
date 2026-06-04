# TUI → Desktop App Feature Gap Analysis

Updated: 2026-06-03

## NavBar Tabs

| Tab      | TUI Feature                                      | Desktop Status                              |
| -------- | ------------------------------------------------ | ------------------------------------------- |
| Chat     | Full chat, streaming, tool display, side panel   | ✅ Implemented                              |
| Media    | Generated images, transcripts, dictation         | ✅ Implemented (image gallery + lightbox)   |
| Tasks    | Background tasks (`/task`, `/run`, `/overnight`) | ✅ Implemented (list + cancel)              |
| Monitor  | Ambient mode, telemetry, system health           | ✅ Implemented (ambient toggle + stats)     |
| Team     | Swarm plan/proposal view, agent coordination     | ✅ Implemented (agents + plans + proposals) |
| Settings | Theme, config, memory export/import              | ✅ Implemented                              |
| Network  | Provider config, auth status, auth doctor        | ✅ Implemented                              |

## Global Features

| Feature                            | TUI | Desktop                      | Priority | Notes                                                         |
| ---------------------------------- | --- | ---------------------------- | -------- | ------------------------------------------------------------- |
| Permission requests dialog         | ✅  | ✅ Implemented               | —        | Modal with approve/deny                                       |
| Dictation (voice input)            | ✅  | ✅ Implemented               | —        | Mic button, insert/append/replace/send modes                  |
| Mermaid diagram rendering          | ✅  | ✅ (via @streamdown/mermaid) | —        | Already in MessageBubble                                      |
| Side panel (BTW, diff, plans)      | ✅  | ✅ Implemented               | —        | Toggle with `O` key, page tabs, content view                  |
| Usage/cost overlay                 | ✅  | ✅ Implemented               | —        | Token count in settings popover                               |
| Memory search/graph                | ✅  | ✅ Implemented               | —        | Search, semantic search, tag filter, scope, stats in Settings |
| Git branch indicator               | ✅  | ✅ Implemented               | —        | Shown next to workspace name                                  |
| Code block copy                    | ✅  | ✅ Implemented               | —        | Streamdown controls enabled                                   |
| Soft interrupt                     | ✅  | ✅ Implemented               | —        | Interrupt mode toggle in ChatArea                             |
| Device pairing                     | ✅  | ✅ Implemented               | —        | generate_pairing_code, list_paired_devices, revoke_device     |
| Ambient transcripts                | ✅  | ✅ Implemented               | —        | Shown in MonitorPage with visible cycle                       |
| Workspace memory preference        | ✅  | ✅ Implemented               | —        | Toggle default + per-workspace in Settings                    |
| Message regeneration               | ✅  | ✅ Implemented               | —        | RotateCcw button on assistant messages                        |
| Browser status indicator           | ✅  | ✅ Implemented               | —        | Shown in MonitorPage                                          |
| Soft interrupt input               | ✅  | ✅ (via /stop /cancel)       | —        | Slash commands wired                                          |
| Keyboard shortcuts help            | ✅  | ✅ Implemented               | —        | `?` key modal                                                 |
| Connection status indicator        | ✅  | ✅ Implemented               | —        | Dot in ChatArea header                                        |
| File attachment                    | ✅  | ✅ Implemented               | —        | Hidden input + FileReader                                     |
| Session switcher (Cmd+P)           | ✅  | ✅ Implemented               | —        |                                                               |
| @mention routing                   | ✅  | ✅ Implemented               | —        |                                                               |
| Swarm sidebar                      | ✅  | ✅ Implemented               | —        | Normal + swarm coexist                                        |
| Agent avatar config popover        | ✅  | ✅ Implemented               | —        | Per-avatar model picker                                       |
| Real-time processing indicators    | ✅  | ✅ Implemented               | —        | Pulse dots, agent status bar                                  |
| Multi-session concurrent streaming | ✅  | ✅ Implemented               | —        | streamingIndexByRole                                          |

## New TUI Features (from master merge, 2026-06-01)

### 1. Onboarding Flow (Login + Import Review)

**Status**: ✅ Implemented

Desktop now has a guided first-run onboarding flow:

- Welcome screen with feature highlights
- Import review dialog for external credentials (Codex, Claude Code, Cursor)
- Model selection step
- Completion state persisted to localStorage

### 2. Cursor Auth Support

**Status**: ✅ Implemented

New auth source for Cursor IDE:

- `cursor_auth_json` — Cursor's `auth.json` file
- `cursor_vscdb` — Cursor IDE's SQLite storage (state.vscdb)
- API key exchange support
- Displayed in Network page with status indicators
- Import from external logins during onboarding

### 3. Provider Doctor (diagnostic tool)

**Status**: ✅ Implemented

Desktop has full provider doctor support:

- "Diagnose" button per configured provider
- Displays pass/fail checkpoints with details
- Shows spend info for full tier tests
- Three tiers: Offline, Catalog, Full

### 4. Live Provider Probes

**Status**: ✅ Implemented

Desktop has live connection testing:

- "Test" button per configured provider
- Shows live model count
- Displays response time
- Lists available models

### 5. Plan Commands

**Status**: ✅ Implemented

Desktop supports plan commands:

- `/plan` — Enter planning mode
- `/plan <goal>` — Plan with specific goal
- `/convene` — Ask all agents to contribute
- Plans are written to side panel for review

### 6. Session Picker Loading States

**Status**: ✅ Implemented

Desktop has loading states for session list:

- Skeleton loading animation during initial load
- Error state with retry button
- Empty state with create session prompt
- Search empty state

### 7. Memory graph visualization

**Status**: ✅ Implemented (2026-06-03)

The TUI can render a memory graph in its info widget via `build_graph_topology` (`crates/jcode-tui-core/src/graph_topology.rs`). The desktop now mirrors this:

- `get_memory_graph` Tauri command in `jcode-app/src-tauri/src/lib.rs` reuses the same topology builder on the loaded project + global memory graphs.
- `GraphNode` / `GraphEdge` gained `Serialize` derives in `jcode-tui-core` so they cross the Tauri JSON wire.
- `MemoryGraph.tsx` SVG renderer in `jcode-app/src/components/MemoryGraph.tsx` provides a deterministic circular layout (no jitter on re-render), color-coded nodes/edges by kind, hover tooltips, and click-to-expand node details. ~290 LOC, no external graph library.
- Wired into `SettingsPage.tsx` as a collapsible "Graph view" section inside the Memory Browser card.

## Remaining Gaps (Backend-dependent)

All previously listed gaps closed. None remaining.
