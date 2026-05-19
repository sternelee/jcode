# Goal
Round 3: Directed @agent send, read cursors, Add/Remove agent controls.

# Checklist
- [x] Parse @AgentName prefix in outbound messages → route directly to that agent's DM session
- [x] Add per-conversation lastReadTimestamp → compute real unread counts
- [x] Add "Add Agent" button in workspace thread status bar (opens CreateSessionDialog in swarm mode)
- [x] Add per-agent "Remove" hover button in ConversationsList DM items (deleteSession + cleanup)
- [x] CreateSessionDialog accepts initMode prop, resets on open
- [x] Validate tsc --noEmit ✅

# Changes made
- **App.tsx**
  - Added `deleteSession` to hook destructure
  - Added `lastReadAt: Record<string, number>` state
  - `handleSelectConversation` and `handleResume` update `lastReadAt` on navigation
  - `handleSendMessage`: parses `@AgentName` prefix → resolves to that agent's session
  - `sessionPreviewMap` extended with `unread` count (assistant messages since lastReadAt)
  - `handleAddAgentToWorkspace` opens CreateSessionDialog in swarm initMode
  - `handleRemoveAgentSession` calls deleteSession + navigates back to workspace thread
  - NavBar unreadCount derived from actual `sessionPreviewMap[*].unread > 0` count
  - `onAddAgent` and `onRemoveSession` wired to ChatArea and ConversationsList

- **ChatArea.tsx**
  - Added `onAddAgent` prop
  - Status bar shows "+ Add Agent" button when `onAddAgent` provided

- **ConversationsList.tsx**
  - Added `onRemoveSession` prop
  - `SessionPreview` extended with optional `unread` field
  - DM items show hover ✕ remove button, displays real unread badge (99+ cap)
  - Unread tab filter uses real `isActive` data

- **CreateSessionDialog.tsx**
  - Added `initMode` prop (default "swarm")
  - `useEffect` resets `mode` to `initMode` when dialog opens

# Validation
- `pnpm tsc --noEmit` ✅

# Remaining gaps (for future rounds)
- `@mention` routes to the specific agent but both the workspace thread and the DM session
  will show the message — this is correct but could be confusing if the user doesn't notice
  they're viewing the group thread vs DM thread simultaneously.
- Read cursor resets to "now" on every select, so all pre-existing messages count as read
  immediately; a proper "first unread" separator line would improve the UX further.
