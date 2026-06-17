# Shared Chat Architecture: Launcher + Workbench

## Problem

Two independent chat implementations with duplicated session management:
- **Launcher**: `LauncherChat.tsx` (210L) + `useLauncherChat.ts` (231L) — plain text, own session management
- **Workbench**: `ChatArea.tsx` (~1343L) + `MessageBubble.tsx` + `useJcodeSession.ts` + `sessionReducer.ts` — rich rendering, reducer-based

Both invoke the same Tauri commands (`begin_session`, `send_message`, `cancel`, `set_model`) and listen to the same `server-event` stream, but the frontend plumbing is completely separate.

## Design Goals

1. **Shared rendering**: Both surfaces use the same message bubble component with streamdown markdown
2. **Shared session hook**: Common `useChatSession` hook for session lifecycle, streaming, model switching
3. **Independent sessions**: Launcher and workbench each have their own session, can run simultaneously
4. **Launcher stays simpler**: No mentions, slash commands, search, images, swarm — just chat
5. **Non-breaking**: Workbench's existing `useJcodeSession` + `sessionReducer` stay intact; shared components are additive

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Shared Layer                      │
│                                                     │
│  useChatSession(provider, opts)                     │
│  ├── begin_session, send_message, cancel, set_model │
│  ├── server-event listener (filtered by sessionId)  │
│  └── returns { messages, send, cancel, setModel, … }│
│                                                     │
│  ChatBubble(message, isStreaming, variant)           │
│  ├── user: primary bubble, plain text                │
│  ├── assistant: streamdown markdown, reasoning       │
│  ├── tool summary: compact tool execution indicator  │
│  └── variant: "compact" (launcher) | "full" (bench) │
│                                                     │
│  MessageList(messages, scrollRef, variant)           │
│  ├── auto-scroll, scroll-down button                 │
│  ├── empty state                                     │
│  └── maps messages → ChatBubble                      │
├─────────────────────────────────────────────────────┤
│  Launcher Chat              │  Workbench Chat       │
│  LauncherChat.tsx           │  ChatArea.tsx         │
│  ├── useChatSession         │  ├── useJcodeSession  │
│  ├── MessageList (compact)  │  │   (delegates to    │
│  ├── ChatBubble (compact)   │  │    useChatSession  │
│  ├── textarea input         │  │    for basic ops)  │
│  └── model picker           │  ├── MessageBubble    │
│                             │  │   (full features)  │
│                             │  ├── mentions, slash  │
│                             │  ├── search, images   │
│                             │  └── swarm, stdin     │
└─────────────────────────────┴───────────────────────┘
```

## Shared Components

### `useChatSession` hook

Extracts the core session lifecycle from `useLauncherChat.ts`:

```ts
interface UseChatSessionOptions {
  providerKey: string;
  model: string;
  models: string[];
  workingDir?: string | null;
  memoryEnabled?: boolean;
  roleName?: string | null;
  forceProvider?: boolean;
}

interface UseChatSessionReturn {
  sessionId: string | null;
  messages: ChatMessage[];
  isProcessing: boolean;
  error: string | null;
  currentModel: string;
  send: (content: string, images?: [string, string][]) => Promise<void>;
  cancel: () => Promise<void>;
  setModel: (model: string) => Promise<void>;
  reset: () => void;
}
```

Internals:
- Lazy `begin_session` on first `send()` (same as current `useLauncherChat`)
- `server-event` listener filtered by `sessionIdRef`
- Handles: `text_delta`, `text_replace`, `reasoning_delta`, `tool_start/input/exec/done`, `done`, `interrupted`, `error`
- Sets `currentModel` on `set_model` success

### `ChatBubble` component

Shared message renderer with two variants:

```ts
interface ChatBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  variant?: "compact" | "full";
}
```

- **compact** (launcher): tighter padding, no timestamp, no role header, no action buttons, no images
- **full** (workbench): role label, timestamp, token usage, tool cards, action buttons, images

Both variants use `streamdown` for assistant content and show:
- Streaming pulse indicator
- Reasoning block (collapsible in full, inline italic in compact)
- Tool execution summary (compact: "🔧 bash" inline; full: expandable `ToolCard`)

### `MessageList` component

Shared message feed with auto-scroll:

```ts
interface MessageListProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  variant?: "compact" | "full";
  emptyState?: React.ReactNode;
  scrollRef: React.RefObject<HTMLDivElement>;
  onRegenerate?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage, content: string) => void;
}
```

- Auto-scroll when near bottom (200px threshold, same as current ChatArea)
- "Scroll down" button when not at bottom
- Empty state customizable per surface

## What Stays Separate

| Feature | Launcher | Workbench |
|---------|----------|-----------|
| Input | Simple textarea | Textarea + mentions + slash + images + dictation |
| Session mgmt | `useChatSession` directly | `useJcodeSession` (wraps `useChatSession` + reducer + workspace + swarm) |
| Message actions | None | Edit, regenerate, quote |
| Search | None | Cmd+F in-chat search |
| Swarm | None | Full swarm role rendering |
| stdin prompts | None | Interactive stdin modal |
| Draft queue | None | Queue drafts while processing |

## File Plan

### New files
- `src/hooks/useChatSession.ts` — shared session hook (~150 lines, extracted from `useLauncherChat.ts`)
- `src/components/ChatBubble.tsx` — shared message bubble (~200 lines)
- `src/components/MessageList.tsx` — shared message feed (~80 lines)

### Modified files
- `src/components/LauncherChat.tsx` — rewrite to use `useChatSession`, `MessageList`, `ChatBubble`
- `src/hooks/useLauncherChat.ts` — delete (replaced by `useChatSession`)
- `src/hooks/useJcodeSession.ts` — optional: delegate basic send/cancel to `useChatSession` internally

### Unchanged files
- `src/components/ChatArea.tsx` — continues using `MessageBubble` + `useJcodeSession`
- `src/components/MessageBubble.tsx` — stays as full-featured workbench renderer
- `src/hooks/sessionReducer.ts` — unchanged
- `src/hooks/processEvent.ts` — unchanged

## Implementation Order

1. Create `useChatSession.ts` — extract from `useLauncherChat.ts`
2. Create `ChatBubble.tsx` — shared renderer with compact/full variants
3. Create `MessageList.tsx` — shared feed with auto-scroll
4. Rewrite `LauncherChat.tsx` — use shared components
5. Delete `useLauncherChat.ts`
6. Test both surfaces independently and simultaneously

## Risks

- **useJcodeSession complexity**: It handles workspace threads, swarm, draft queue, stdin — can't easily be replaced by `useChatSession`. Keep it as-is; the sharing is at the rendering layer.
- **server-event routing**: Both sessions listen to all `server-event` emissions and filter by `sessionId`. This already works (launcher does it today). No backend changes needed.
- **Bundle size**: Adding streamdown to the launcher increases bundle. Mitigated by Vite's existing `manualChunks` split.
