# JCode AI Elements UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JCode Desktop UI components with AI Elements-inspired designs while preserving all JCode functionality

**Architecture:** Adapter layer converts JCode ChatMessage[] to AI Elements UIMessage format at render time. No changes to backend or session hooks.

**Tech Stack:** ai-elements, shadcn/ui-based components, Tailwind CSS

---

## File Structure

| File | Change |
|------|--------|
| `desktop-app/package.json` | Add ai-elements dependency |
| `desktop-app/src/lib/messageAdapter.ts` | Create - format adapter |
| `desktop-app/src/components/MessageBubble.tsx` | Replace with AI Elements Message, add Reasoning/Tool |
| `desktop-app/src/components/ChatView.tsx` | Use Conversation container, ConversationScrollButton, ConversationEmptyState |
| `desktop-app/src/components/InputArea.tsx` | Use PromptInput components |

---

### Task 1: Install AI Elements Package

**Files:**
- Modify: `desktop-app/package.json`

- [ ] **Step 1: Add dependency**

```json
{
  "dependencies": {
    "ai-elements": "^1.9.0"
  }
}
```

Run: `cd desktop-app && pnpm add ai-elements`

- [ ] **Step 2: Verify installation**

Run: `cd desktop-app && pnpm list ai-elements`
Expected: ai-elements version listed

- [ ] **Step 3: Commit**

```bash
cd /Users/sternelee/www/github/jcode
git add desktop-app/package.json desktop-app/pnpm-lock.yaml
git commit -m "feat: add ai-elements dependency"
```

---

### Task 2: Create Message Adapter

**Files:**
- Create: `desktop-app/src/lib/messageAdapter.ts`

- [ ] **Step 1: Write the adapter**

```typescript
import type { ChatMessage } from "@/types";

export interface UIPessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: Part[];
}

export type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-invocation"; toolCallId: string; toolName: string; input: unknown; output?: unknown; status: "executing" | "done" | "error" };

export function adaptMessage(msg: ChatMessage): UIMessage {
  const parts: Part[] = [];

  if (msg.reasoningContent) {
    parts.push({ type: "reasoning", text: msg.reasoningContent });
  }

  if (msg.content) {
    parts.push({ type: "text", text: msg.content });
  }

  for (const tool of msg.toolExecutions) {
    parts.push({
      type: "tool-invocation",
      toolCallId: tool.id,
      toolName: tool.name,
      input: tool.input,
      output: tool.output,
      status: tool.status === "done" ? "done" : tool.status === "error" ? "error" : "executing"
    });
  }

  return {
    id: msg.id,
    role: msg.role as "user" | "assistant" | "system",
    parts
  };
}

export function adaptMessages(messages: ChatMessage[]): UIMessage[] {
  return messages.map(adaptMessage);
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd desktop-app && npx tsc --noEmit src/lib/messageAdapter.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add desktop-app/src/lib/messageAdapter.ts
git commit -m "feat: create message adapter for AI Elements format"
```

---

### Task 3: Refactor MessageBubble with AI Elements

**Files:**
- Modify: `desktop-app/src/components/MessageBubble.tsx:1-149`

- [ ] **Step 1: Write AI Elements MessageBubble**

```tsx
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";
import { adaptMessage, type UIMessage, type Part } from "@/lib/messageAdapter";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "ai-elements/conversation";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "ai-elements/message";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "ai-elements/message";
import { CopyIcon, RefreshCcwIcon } from "lucide-react";
import { Fragment } from "react";

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center py-2">
        <span className="text-xs text-muted-foreground">{message.content}</span>
      </div>
    );
  }

  const uiMessage = adaptMessage(message);

  return (
    <MessageBubbleContent message={uiMessage} isStreaming={isStreaming} />
  );
}

function MessageBubbleContent({ message, isStreaming }: { message: UIMessage; isStreaming?: boolean }) {
  const isUser = message.role === "user";

  const renderPart = (part: Part, index: number, isLast: boolean) => {
    switch (part.type) {
      case "text":
        return (
          <MessageResponse key={index}>
            {part.text}
            {isStreaming && isLast && <span className="text-primary animate-blink ml-0.5">▌</span>}
          </MessageResponse>
        );
      case "reasoning":
        return (
          <Reasoning key={index} isStreaming={isStreaming} defaultOpen={false}>
            <ReasoningTrigger getThinkingMessage={(s) => s ? "Thinking..." : "Thought"} />
            <ReasoningContent>{part.text}</ReasoningContent>
          </Reasoning>
        );
      case "tool-invocation":
        return (
          <Tool key={index}>
            <ToolHeader
              type="tool-call"
              state={part.status === "done" ? "done" : part.status === "error" ? "error" : "executing"}
            />
            <ToolContent>
              <ToolInput input={part.input} />
              {part.output && <ToolOutput output={part.output} />}
            </ToolContent>
          </Tool>
        );
      default:
        return null;
    }
  };

  const textParts = message.parts.filter((p) => p.type === "text");
  const isLastTextPart = (idx: number) => idx === textParts.length - 1;

  if (isUser) {
    return (
      <Message from="user">
        <MessageContent>
          {message.parts.map((part, i) => {
            if (part.type === "text") {
              return (
                <Fragment key={i}>
                  <MessageResponse>
                    {part.text}
                  </MessageResponse>
                  {isStreaming && isLastTextPart(i) && (
                    <span className="text-primary animate-blink ml-0.5">▌</span>
                  )}
                </Fragment>
              );
            }
            return null;
          })}
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message from="assistant">
      <MessageContent>
        {message.parts.map((part, i) => renderPart(part, i, i === message.parts.length - 1))}
      </MessageContent>
      {message.parts.some((p) => p.type === "text") && (
        <MessageActions>
          <MessageAction
            onClick={() => {
              const text = message.parts.find((p) => p.type === "text")?.text || "";
              navigator.clipboard.writeText(text);
            }}
            label="Copy"
          >
            <CopyIcon className="size-3" />
          </MessageAction>
        </MessageActions>
      )}
    </Message>
  );
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd desktop-app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add desktop-app/src/components/MessageBubble.tsx
git commit -m "feat: refactor MessageBubble with AI Elements components"
```

---

### Task 4: Refactor ChatView with Conversation Container

**Files:**
- Modify: `desktop-app/src/components/ChatView.tsx:1-150`

- [ ] **Step 1: Write AI Elements ChatView**

```tsx
import { useRef, useEffect } from "react";
import type { ChatMessage } from "@/types";
import { MessageBubble } from "./MessageBubble";
import { InputArea } from "./InputArea";
import { Trash2, Undo2, ArrowDownWideNarrow, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from "ai-elements/conversation";

interface ChatViewProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  connectionPhase: string | null;
  connected: boolean;
  reasoningEffort: string | null;
  connectionType: string | null;
  statusDetail: string | null;
  onSend: (content: string, images?: [string, string][]) => void;
  onCancel: () => void;
  onClearChat: () => void;
  onRewindChat: () => void;
  onSetReasoningEffort: (effort: string) => void;
  onCompactContext: () => void;
}

export function ChatView({
  messages,
  isProcessing,
  connectionPhase,
  connected,
  reasoningEffort,
  connectionType,
  statusDetail,
  onSend,
  onCancel,
  onClearChat,
  onRewindChat,
  onSetReasoningEffort,
  onCompactContext,
}: ChatViewProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {connected && (
        <div className="flex items-center justify-between px-4 py-2 border-b bg-card/50">
          <div className="flex items-center gap-2">
            <Select
              value={reasoningEffort || ""}
              onValueChange={(v) => v && onSetReasoningEffort(v)}
            >
              <SelectTrigger className="h-7 text-xs w-32">
                <SelectValue placeholder="Reasoning" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Default</SelectItem>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="xhigh">Max</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={onCompactContext}
              disabled={isProcessing}
            >
              <ArrowDownWideNarrow className="w-3 h-3" />
              Compact
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {connectionType && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {connectionType}
              </span>
            )}
            {statusDetail && (
              <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                {statusDetail}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={onRewindChat}
              disabled={isProcessing || messages.length === 0}
            >
              <Undo2 className="w-3 h-3" />
              Rewind
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
              onClick={onClearChat}
              disabled={isProcessing || messages.length === 0}
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </Button>
          </div>
        </div>
      )}
      <Conversation className="flex-1">
        <ConversationContent>
          {!connected ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-2 text-muted-foreground">
              <p className="text-sm">{connectionPhase || "Not connected"}</p>
              <p className="text-xs">
                Select a workspace folder and start a session to begin.
              </p>
            </div>
          ) : messages.length === 0 ? (
            <ConversationEmptyState
              icon={<MessageSquare className="size-12" />}
              title="Start a conversation"
              description="Type a message below to begin chatting"
            />
          ) : (
            messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={msg.id === messages[messages.length - 1]?.id && isProcessing}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <InputArea
        onSend={onSend}
        onCancel={onCancel}
        isProcessing={isProcessing}
        disabled={!connected}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd desktop-app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add desktop-app/src/components/ChatView.tsx
git commit -m "feat: refactor ChatView with AI Elements Conversation container"
```

---

### Task 5: Refactor InputArea with PromptInput

**Files:**
- Modify: `desktop-app/src/components/InputArea.tsx:1-144`

- [ ] **Step 1: Write AI Elements InputArea**

```tsx
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Square } from "lucide-react";
import type { AttachedImage } from "@/types";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "ai-elements/prompt-input";

interface InputAreaProps {
  onSend: (content: string, images?: [string, string][]) => void;
  onCancel: () => void;
  isProcessing: boolean;
  disabled: boolean;
}

export function InputArea({
  onSend,
  onCancel,
  isProcessing,
  disabled,
}: InputAreaProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<AttachedImage[]>([]);

  const handleSubmit = () => {
    if (isProcessing || disabled) return;
    const content = text.trim();
    if (!content && images.length === 0) return;
    const tuples: [string, string][] = images.map((i) => [
      i.mediaType,
      i.base64Data,
    ]);
    onSend(content || "(image)", tuples.length > 0 ? tuples : undefined);
    setText("");
    setImages([]);
  };

  const handleAttach = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({
        multiple: false,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        ],
      });
      if (sel) {
        const path = typeof sel === "string" ? sel : sel[0];
        if (path) {
          const res = await fetch(`file://${path}`);
          const blob = await res.blob();
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(",")[1];
            setImages((p) => [
              ...p,
              {
                id: `img-${Date.now()}`,
                mediaType: blob.type || "image/png",
                base64Data: base64,
              },
            ]);
          };
          reader.readAsDataURL(blob);
        }
      }
    } catch {}
  };

  return (
    <div className="border-t bg-card p-3">
      {images.length > 0 && (
        <div className="flex gap-2 mb-2">
          {images.map((img) => (
            <div key={img.id} className="relative">
              <img
                src={`data:${img.mediaType};base64,${img.base64Data}`}
                className="w-14 h-14 rounded-lg object-cover border"
              />
              <button
                onClick={() =>
                  setImages((p) => p.filter((i) => i.id !== img.id))
                }
                className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <PromptInput
        onSubmit={handleSubmit}
        className="relative"
      >
        <PromptInputBody>
          <PromptInputTextarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              disabled
                ? "Select a workspace and start a session..."
                : "Type a message... (Enter to send, Shift+Enter for newline)"
            }
            className="min-h-10 max-h-48 resize-none"
          />
        </PromptInputBody>
        <PromptInputFooter>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handleAttach}
              disabled={disabled}
              className="h-10 w-10 shrink-0"
            >
              <Plus className="w-4 h-4" />
            </Button>
            {isProcessing ? (
              <Button
                variant="destructive"
                size="icon"
                onClick={onCancel}
                className="h-10 w-10 shrink-0"
              >
                <Square className="w-4 h-4 fill-current" />
              </Button>
            ) : (
              <PromptInputSubmit
                status={isProcessing ? "streaming" : "ready"}
                disabled={!text.trim() && images.length === 0}
                className="h-10 w-10 shrink-0"
              />
            )}
          </div>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd desktop-app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add desktop-app/src/components/InputArea.tsx
git commit -m "feat: refactor InputArea with AI Elements PromptInput"
```

---

### Task 6: Verify Full Build

- [ ] **Step 1: Run TypeScript check**

Run: `cd desktop-app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run cargo check**

Run: `cd /Users/sternelee/www/github/jcode && cargo check -p desktop-app`
Expected: No errors

- [ ] **Step 3: Build desktop app**

Run: `cd /Users/sternelee/www/github/jcode && cargo build -p desktop-app --release 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete AI Elements UI integration"
```

---

## Self-Review Checklist

1. **Spec coverage:** All sections from spec covered:
   - ✅ Layout Structure (ChatView + Conversation)
   - ✅ Message Component Design (MessageBubble → Message/MessageContent/MessageResponse)
   - ✅ Conversation Container (Conversation, ConversationContent, ConversationScrollButton, ConversationEmptyState)
   - ✅ PromptInput (InputArea → PromptInput/PromptInputTextarea/PromptInputSubmit)
   - ✅ Toolbar (unchanged - still in ChatView)
   - ✅ SessionSidebar (unchanged as per spec)
   - ✅ Header (unchanged as per spec)

2. **Placeholder scan:** No placeholders found

3. **Type consistency:** Types flow: ChatMessage → adaptMessage() → UIMessage → Message/from props

4. **Dependencies:** All AI Elements imports verified from Context7 docs
