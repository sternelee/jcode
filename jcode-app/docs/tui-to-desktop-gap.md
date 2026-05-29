# TUI → Desktop App Feature Gap Analysis

## NavBar Tabs

| Tab | TUI Feature | Desktop Status |
|-----|-------------|----------------|
| Chat | Full chat, streaming, tool display, side panel | ✅ Implemented |
| Media | Generated images, transcripts, dictation | ❌ Placeholder |
| Tasks | Background tasks (`/task`, `/run`, `/overnight`) | ❌ Placeholder |
| Monitor | Ambient mode, telemetry, system health | ❌ Placeholder |
| Team | Swarm plan/proposal view, agent coordination | ❌ Placeholder |
| Settings | Theme, config | ✅ Implemented |
| Network | Provider config, auth status | ✅ Implemented |

## Global Features

| Feature | TUI | Desktop | Priority |
|---------|-----|---------|----------|
| Permission requests dialog | ✅ | ❌ Missing | P0 |
| Dictation (voice input) | ✅ | ❌ Missing | P1 |
| Mermaid diagram rendering | ✅ | ❌ Missing | P1 |
| Side panel (BTW, diff, plans) | ✅ | ❌ Missing | P1 |
| Usage/cost overlay | ✅ | ❌ Missing | P2 |
| Memory search/graph | ✅ | ❌ Missing | P2 |
| Browser status indicator | ✅ | ❌ Missing | P2 |
| Soft interrupt input | ✅ | ❌ Missing | P2 |
