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
| Side panel (BTW, diff, plans) | ✅ | ❌ Missing | P2 | Needs backend event types for desktop |
| Usage/cost overlay | ✅ | ✅ Implemented | — | Token count in settings popover |
| Memory search/graph | ✅ | ❌ Missing | P3 | Can add to Settings |
| Browser status indicator | ✅ | ❌ Missing | P3 | Hooks exist, not wired |
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

1. **Side panel** — TUI has a dedicated right panel for BTW messages, diffs, and plan previews. The desktop types don't include `SidePanelEvent` or similar. Needs backend support.
2. **Memory graph visualization** — The TUI can show a memory graph. Desktop has export/import but no visual graph.
3. **Browser status indicator** — Hooks `getBrowserStatus`/`setupBrowser` exist but aren't shown anywhere in the UI.
