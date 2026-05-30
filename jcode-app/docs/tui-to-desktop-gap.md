# TUI → Desktop App Feature Gap Analysis

Updated: 2026-05-29

## NavBar Tabs

| Tab | TUI Feature | Desktop Status |
|-----|-------------|----------------|
| Chat | Full chat, streaming, tool display, side panel | ✅ Implemented |
| Media | Generated images, transcripts, dictation | ✅ Implemented (image gallery + lightbox) |
| Tasks | Background tasks (`/task`, `/run`, `/overnight`) | ✅ Implemented (list + cancel) |
| Monitor | Ambient mode, telemetry, system health | ✅ Implemented (ambient toggle + stats) |
| Team | Swarm plan/proposal view, agent coordination | ✅ Implemented (agents + plans + proposals) |
| Settings | Theme, config, memory export/import | ✅ Implemented |
| Network | Provider config, auth status, auth doctor | ✅ Implemented |

## Global Features

| Feature | TUI | Desktop | Priority | Notes |
|---------|-----|---------|----------|-------|
| Permission requests dialog | ✅ | ✅ Implemented | — | Modal with approve/deny |
| Dictation (voice input) | ✅ | ✅ Implemented | — | Mic button, insert/append/replace/send modes |
| Mermaid diagram rendering | ✅ | ✅ (via @streamdown/mermaid) | — | Already in MessageBubble |
| Side panel (BTW, diff, plans) | ✅ | ✅ Implemented | — | Toggle with `O` key, page tabs, content view |
| Usage/cost overlay | ✅ | ✅ Implemented | — | Token count in settings popover |
| Memory search/graph | ✅ | ✅ Implemented | — | Search, semantic search, tag filter, scope, stats in Settings |
| Git branch indicator | ✅ | ✅ Implemented | — | Shown next to workspace name |
| Code block copy | ✅ | ✅ Implemented | — | Streamdown controls enabled |
| Soft interrupt | ✅ | ✅ Implemented | — | Interrupt mode toggle in ChatArea |
| Device pairing | ✅ | ❌ Missing | P3 | generate_pairing_code, list_paired_devices, revoke_device |
| Ambient transcripts | ✅ | ✅ Implemented | — | Shown in MonitorPage with visible cycle |
| Workspace memory preference | ✅ | ✅ Implemented | — | Toggle default + per-workspace in Settings |
| Message regeneration | ✅ | ✅ Implemented | — | RotateCcw button on assistant messages |
| Browser status indicator | ✅ | ✅ Implemented | — | Shown in MonitorPage |
| Soft interrupt input | ✅ | ✅ (via /stop /cancel) | — | Slash commands wired |
| Keyboard shortcuts help | ✅ | ✅ Implemented | — | `?` key modal |
| Connection status indicator | ✅ | ✅ Implemented | — | Dot in ChatArea header |
| File attachment | ✅ | ✅ Implemented | — | Hidden input + FileReader |
| Session switcher (Cmd+P) | ✅ | ✅ Implemented | — | |
| @mention routing | ✅ | ✅ Implemented | — | |
| Swarm sidebar | ✅ | ✅ Implemented | — | Normal + swarm coexist |
| Agent avatar config popover | ✅ | ✅ Implemented | — | Per-avatar model picker |
| Real-time processing indicators | ✅ | ✅ Implemented | — | Pulse dots, agent status bar |
| Multi-session concurrent streaming | ✅ | ✅ Implemented | — | streamingIndexByRole |

## Remaining Gaps (Backend-dependent)

1. **Memory graph visualization** — The TUI can show a memory graph. Desktop has export/import but no visual graph. Needs backend API exposing graph nodes/edges.
2. **Message regeneration** — ✅ Implemented. Click `RotateCcw` button on assistant message to rewind and re-send.
3. **Device pairing** — Backend has `generate_pairing_code`, `list_paired_devices`, `revoke_device` commands. Not wired in desktop UI.
