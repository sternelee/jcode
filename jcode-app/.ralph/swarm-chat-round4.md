# Goal
Round 4: Message bubble polish, first unread separator, coordinator badge, Convene feedback, relative timestamps.

# Checklist
- [x] User messages: right-aligned blue bubble; assistant: left Slack-style; system: centered via MessageBubble
- [x] "First Unread" separator — UnreadSeparator component, firstUnreadIdx from lastReadTimestamp prop
- [x] Coordinator badge — LEAD badge in agent message header + JCode coordinator avatar
- [x] Convene button feedback — status bar shows "Convening team…" (violet pulse, 4s)
- [x] Relative timestamp — hover reveals "just now / Xm ago / Xh ago" via relativeTime()
- [x] Validate tsc --noEmit ✅

# Changes made
- **MessageBubble.tsx**
  - Added `hideHeader?: boolean` prop
  - When `hideHeader=true` and swarm roleName path: skip the colored circle+header, render content-only (images, text, tools, copy action)

- **ChatArea.tsx**
  - Added `lastReadTimestamp?: number` prop
  - Added `convening: boolean` state — set to true 4s on Convene click
  - Added `relativeTime(ts)` helper for hover timestamps
  - Added `firstUnreadIdx` memo from lastReadTimestamp
  - Added `UnreadSeparator` component (red divider line + "New Messages" label)
  - Rewrote message loop into 4 branches:
    1. User → right-aligned blue bubble (max-w-72%), images above, relative time below on hover
    2. System → centered via `<MessageBubble>`
    3. Agent (roleName) → Slack-style: AgentAvatar + role badge + optional LEAD badge + `<MessageBubble hideHeader>`
    4. Non-role assistant (coordinator) → purple/blue gradient J avatar + LEAD badge + `<MessageBubble hideHeader>`
  - UnreadSeparator inserted at `firstUnreadIdx` position
  - Status bar: responding → amber pulse; convening → violet pulse; idle → green "All agents ready"

- **App.tsx**
  - Passes `lastReadTimestamp={selectedConvId ? lastReadAt[selectedConvId] : undefined}` to ChatArea

# Validation
- `pnpm tsc --noEmit` ✅

# Remaining
- `hideHeader=true` also suppresses token usage badges in MessageBubble swarm path — could be re-added as a footer row if desired
- lastReadTimestamp is set on conversation SELECT; it does NOT update when new messages arrive in the background (by design — prevents flickering separator)
