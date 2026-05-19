# Goal
Continue advancing jcode-app swarm/workspace UI toward a real multi-agent collaboration product.

# This round focuses on
1. **True group-chat semantics** — @agent mention UX, coordinator identity, per-session DM routing
2. **Productized experience** — unread/preview in ConversationsList, agent presence (typing / online), workspace-thread status bar

# Checklist
- [x] Add @mention autocomplete in ChatArea input (suggests current workspace agent names)
- [x] Route @agent DMs to the correct individual session from the conversations list
- [x] Show agent presence (online dot, typing animation) driven by real liveProcessing / livePhase data
- [x] Wire real unread counts and latest-message previews into ConversationsList from sessionData
- [x] Add workspace thread status bar (member count, who is currently responding)
- [x] Validate with tsc --noEmit

# Changes made
- **ChatArea.tsx** — full rewrite with:
  - `@mention` autocomplete dropdown (↑↓ navigate, Enter insert, Escape close)
  - `@` toolbar button triggers mention popup at cursor
  - Presence dots per member: amber+pulse when liveProcessing, green when idle
  - Workspace status bar below header (member count + "X is responding…" / "All agents ready")
  - All responding roles shown as separate typing indicators (not just the first one)
- **ConversationsList.tsx** — updated with:
  - `sessionPreviewMap` prop for real last-message text + timestamp
  - "Unread" tab filter now shows sessions where `isActive` (liveProcessing=true)
  - Live unread badge count from actual active sessions (not hardcoded 5)
  - "Groups" and "Agents" filter tabs wired up
  - Workspace thread preview text derived from last mirrored message
- **App.tsx** — added:
  - `sessionPreviewMap` computed from `state.sessionData` (last user/assistant message per session)
  - Passed to `ConversationsList`
  - NavBar `unreadCount` derived from actual sessions with data

# Validation
- `pnpm tsc --noEmit` ✅

# Remaining gaps
- `@mention` inserts the name but does not auto-route the send to that specific agent's DM session (would require parsing the message content before send)
- Unread tracking has no "last read" marker so we proxy with `liveProcessing`; true unread requires a per-conversation read-cursor

# Constraints
- No new backend commands unless essential.
- Keep all changes within jcode-app/ (frontend only unless a tiny Rust addition is truly needed).
- TypeScript strict mode must pass.
