# Goal
Round 5 — UX Polish (Direction B).

# Checklist
- [x] Token usage badge in ChatArea agent message header (↑input ↓output, mono, hover-visible)
- [x] In-chat search (Cmd+F toggles bar, yellow ring highlights, ↑↓ prev/next, Esc close)
- [x] DM loading skeleton (4 pulse rows when connectionPhase=initializing/connecting + messages empty)
- [x] Coordinator session shown in ConversationsList (non-role swarmRole=coordinator entry)
- [ ] CreateSessionDialog step wizard — deferred (low ROI vs complexity)
- [x] Validate tsc --noEmit ✅

# Changes made
- **ChatArea.tsx**
  - Added `isLoading?: boolean` prop
  - Added search state: `searchOpen`, `searchText`, `searchMatchIdx`, `searchInputRef`, `feedRef`
  - `searchMatchIds` memo: filters messages containing search text
  - `useEffect` resets matchIdx on query change, focuses input when opened, scrolls to match
  - `useEffect` Cmd+F / Ctrl+F keyboard shortcut (window listener)
  - Search bar UI: above message feed, with prev/next/close buttons, match counter
  - Message feed wrapped in `<div ref={feedRef}>` for scroll targeting
  - Loading skeleton: 4 animated rows shown when `isLoading && messages.length === 0`
  - Empty state gated on `!isLoading`
  - All 4 message branches get `data-msg-id={msg.id}` for search scroll targeting
  - User and agent messages get `ring-2 ring-yellow-400` when current match, `ring-yellow-200` when search match
  - Agent header now shows token badge (↑N ↓M) + relative time in a shared hover div

- **ConversationsList.tsx**
  - After agent DM items, adds coordinator (non-role, swarmRole=coordinator) as a DM entry with "JCode (Lead)" name
  - Shows liveStatusDetail / preview text / "Lead agent — ready" fallback

- **App.tsx**
  - `displayIsLoading` memo: true when `connectionPhase === "initializing" || "connecting"` for selected DM
  - Passes `isLoading={displayIsLoading}` to ChatArea

# Validation
- `pnpm tsc --noEmit` ✅

# Deferred
- CreateSessionDialog step wizard (3-step wizard redesign — adds ~200 lines for marginal flow improvement; revisit if stakeholder feedback requests it)
