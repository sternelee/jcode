# Goal
Repair and advance the staged jcode-app swarm/workspace UI so it behaves like a true multi-agent collaboration space: correct message routing, recoverable workspace threads, and functional workspace navigation/creation.

# Success criteria
- Sending from a workspace thread targets the intended live session/coordinator rather than an arbitrary active member.
- First-send / reconnect flow does not race on an undefined session id.
- Workspace thread history is hydrated from member sessions when entering or resuming swarm mode.
- Workspace selection/creation UX is functional enough to move between agent-team workspaces.
- TypeScript typecheck passes.

# Checklist
- [x] Inspect current App / hook / component data flow
- [x] Implement conversation-target-aware send routing
- [x] Add workspace-thread hydration from workspace sessions
- [x] Improve workspace switcher and workspace creation affordances
- [x] Run validation and summarize remaining gaps

# Progress
- App routing now resolves the actual target session for workspace threads and sends to the coordinator/preferred live session instead of whatever session happened to be active.
- Cold-start send flow no longer relies on a timeout; `begin_session` now returns a session id and the frontend waits for it before sending.
- Added backend workspace-history aggregation plus frontend hydration/merge logic so workspace threads can recover prior member conversation history.
- Workspace switcher is now functional, and the create-session dialog supports selecting existing workspaces or entering a custom path.
- Removed fake demo swarm messages so empty workspaces show a real empty state instead of misleading canned content.

# Validation
- `pnpm tsc --noEmit` ✅
- `cargo check -p jcode-app` ✅

# Remaining gaps
- Mentions / targeted agent wake-up semantics are still basic; workspace chat now routes correctly but does not yet provide rich `@agent` UX.
- Conversation previews/unread state for workspace threads vs DMs are still minimal.

# Constraints
- Preserve existing jcode session model and Tauri command contracts.
- Prefer minimal, targeted changes over broad rewrites.
- Keep staged swarm UI direction intact while making it actually work.
