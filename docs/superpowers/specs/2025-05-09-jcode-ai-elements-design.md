# JCode Desktop UI/UX Optimization with AI Elements Style

## Overview

Replace JCode Desktop's UI components with AI Elements-inspired designs while preserving all JCode functionality (multi-workspace, session management, rewind, clear, compact, reasoning effort, etc.).

## Goal

- Use AI Elements visual style and interaction patterns
- Maintain JCode backend integration (Tauri + custom hooks)
- Adapt data formats for AI Elements component compatibility
- Preserve all JCode-specific features

---

## 1. Component Architecture

### Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│  Header (App.tsx)                                          │
│  [Logo] [Connection Badge] [WorkingDir] [ModelSelector] [Tokens] │
├──────────┬──────────────────────────────────────────────────┤
│ Session  │  Toolbar (ChatView)                             │
│ Sidebar  │  [Reasoning] [Compact] [Rewind] [Clear]          │
│          ├──────────────────────────────────────────────────┤
│ Workspaces│                                                │
│   ↓      │        Conversation (AI Elements Style)         │
│ Sessions │                                                │
│          │  - Message bubbles with role-based styling      │
│          │  - Reasoning expand/collapse                    │
│          │  - Tool invocation cards                        │
│          │  - Code blocks with syntax highlighting        │
│          │  - MessageActions (copy, retry)                 │
│          │                                                │
│          ├──────────────────────────────────────────────────┤
│          │        PromptInput (AI Elements Style)          │
└──────────┴──────────────────────────────────────────────────┘
```

---

## 2. Message Component Design

### AI Elements Style Adaptation

#### User Message (Right-aligned, filled background)
- AI Elements `Message from="user"` with background
- No avatar, just content bubble
- Images displayed as thumbnail grid

#### Assistant Message (Left-aligned, card-based)
- AI Elements `Message from="assistant"` with card wrapper
- `MessageContent` contains:
  - `Reasoning` component (collapsible, shows "💭 Thinking...")
  - `MessageResponse` for text content
  - `Tool` component for tool invocations
  - Code blocks with language labels

### Data Format Adapter

```typescript
// Convert ChatMessage → AI Elements UIMessage format
function adaptMessage(msg: ChatMessage): AdaptedMessage {
  const parts: Part[] = [];

  // Add reasoning part if present
  if (msg.reasoningContent) {
    parts.push({ type: "reasoning", text: msg.reasoningContent });
  }

  // Add text part
  if (msg.content) {
    parts.push({ type: "text", text: msg.content });
  }

  // Add tool invocations
  for (const tool of msg.toolExecutions) {
    parts.push({
      type: "tool-invocation",
      toolCallId: tool.id,
      toolName: tool.name,
      input: tool.input,
      output: tool.output,
      status: tool.status // "executing" | "done" | "error"
    });
  }

  return {
    id: msg.id,
    role: msg.role,
    parts
  };
}
```

---

## 3. Conversation Container

### Components
- `Conversation` - wrapper with built-in scroll management
- `ConversationContent` - scrollable message list
- `ConversationScrollButton` - floating scroll-to-bottom button
- `ConversationEmptyState` - shown when no messages

### Empty State
```tsx
<ConversationEmptyState
  icon={<MessageSquare className="size-12" />}
  title="Start a conversation"
  description="Type a message below to begin chatting"
/>
```

---

## 4. PromptInput (Input Area)

### Components
- `PromptInput` - wrapper
- `PromptInputTextarea` - auto-growing textarea
- `PromptInputFooter` - action buttons container
- `PromptInputSubmit` - send button with streaming indicator

### Features
- Auto-focus on mount
- Enter to submit, Shift+Enter for newline
- Streaming state shows animated indicator
- Placeholder text contextual based on connection state

### Streaming Status States
- `"idle"` - input ready
- `"submitting"` - message sent, awaiting response
- `"streaming"` - receiving response, show animation
- `"done"` - response complete

---

## 5. MessageActions (Post-Message Actions)

### Actions for Assistant Messages
- **Copy** - copy full message text to clipboard
- **Retry** - resend last user message

### Visual Style
- Collapsed by default, show on hover
- Positioned below message content
- Icon + label for each action

---

## 6. Reasoning Component

### Structure
```tsx
<Reasoning isStreaming={isStreaming} defaultOpen={false}>
  <ReasoningTrigger getThinkingMessage={(s) => s ? "Thinking..." : "Thought"} />
  <ReasoningContent>{reasoningText}</ReasoningContent>
</Reasoning>
```

### States
- **Collapsed** - shows trigger button
- **Expanded** - shows full reasoning content
- **Streaming** - shows animated thinking indicator

---

## 7. Tool Component

### Structure
```tsx
<Tool>
  <ToolHeader type="tool-call" state="executing" />
  <ToolContent>
    <ToolInput input={toolInput} />
    <ToolOutput output={toolOutput} />
  </ToolContent>
</Tool>
```

### States
- `executing` - shows spinner
- `done` - shows green checkmark
- `error` - shows error message

---

## 8. Toolbar (JCode-Specific)

### Location
Top of ChatView, below header info bar

### Buttons
| Button | Icon | Action | States |
|--------|------|--------|--------|
| Reasoning | Brain icon | Dropdown selector | Connected only |
| Compact | ArrowDownWideNarrow | Trigger context compaction | Connected, idle |
| Rewind | Undo2 | Rewind to last message | Connected, has messages |
| Clear | Trash2 | Clear chat history | Connected, has messages |

---

## 9. SessionSidebar (Unchanged)

Preserve existing workspace/session tree structure:
- Grouped by working directory
- Expand/collapse per workspace
- Session selection triggers resume

---

## 10. Header (App.tsx)

Preserve current layout:
- Logo + connection badge
- Working directory display
- Model selector dropdown
- Token usage stats

---

## 11. Implementation Order

1. **Install AI Elements**
   ```
   pnpm add @ai-elements/react @ai-sdk/react
   ```

2. **Create message adapter utility**
   - `src/lib/messageAdapter.ts`

3. **Refactor MessageBubble**
   - Use AI Elements `Message`, `MessageContent`, `MessageResponse`
   - Add `Reasoning` and `Tool` components
   - Add `MessageActions`

4. **Refactor ChatView**
   - Use `Conversation`, `ConversationContent`
   - Add `ConversationScrollButton`
   - Add `ConversationEmptyState`

5. **Refactor InputArea**
   - Use `PromptInput`, `PromptInputTextarea`, `PromptInputSubmit`
   - Adapt to existing `onSend`/`onCancel` props

6. **Update App.tsx**
   - Minimal changes if layout preserved

---

## 12. Styling Approach

- Keep Tailwind CSS as base
- AI Elements components are shadcn/ui-based - compatible with existing setup
- Override default AI Elements theme variables if needed
- Use CSS custom properties for consistent theming

---

## Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add AI Elements dependencies |
| `src/lib/messageAdapter.ts` | NEW - format adapter |
| `src/components/MessageBubble.tsx` | Replace with AI Elements style |
| `src/components/ChatView.tsx` | Use Conversation container |
| `src/components/InputArea.tsx` | Use PromptInput components |
| `src/components/ToolCard.tsx` | May be replaced by AI Elements Tool |
| `src/types.ts` | Add UIMessage types if needed |
| `src/App.tsx` | Minimal - layout already good |

---

## Backward Compatibility

- `useJcodeSession` hook unchanged - continues to provide `ChatMessage[]`
- Adapter layer converts to AI Elements format at render time
- No changes to Tauri commands or Rust backend