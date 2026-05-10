import type { ComponentType } from "react";
import type { AttachedImage, ChatMessage } from "@/types";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  CopyIcon,
  Archive,
  Brain,
  Clock3,
  History,
  Keyboard,
  Layers3,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ToolCard } from "./ToolCard";

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  isHighlighted?: boolean;
}

type SystemMessageKind =
  | "history"
  | "compaction"
  | "rewind"
  | "stdin"
  | "queue"
  | "memory"
  | "reasoning"
  | "generic";

function imageSrc(image: AttachedImage): string {
  if (image.filePath) return convertFileSrc(image.filePath);
  if (image.base64Data) {
    return `data:${image.mediaType};base64,${image.base64Data}`;
  }
  return "";
}

function classifySystemMessage(content: string): {
  kind: SystemMessageKind;
  title: string;
  icon: ComponentType<{ className?: string }>;
} {
  if (content.includes("Restored session history")) {
    return { kind: "history", title: "Restored history", icon: History };
  }
  if (content.includes("Context compaction") || content.includes("compact")) {
    return { kind: "compaction", title: "Context compaction", icon: Archive };
  }
  if (content.includes("Rewound to message")) {
    return { kind: "rewind", title: "Conversation rewind", icon: RotateCcw };
  }
  if (content.includes("Interactive") || content.includes("interactive input")) {
    return { kind: "stdin", title: "Interactive input", icon: Keyboard };
  }
  if (
    content.includes("Queued prompt") ||
    content.includes("queued prompt") ||
    content.includes("Sending queued prompt")
  ) {
    return { kind: "queue", title: "Queued draft", icon: Layers3 };
  }
  if (content.includes("memory") || content.includes("Memory")) {
    return { kind: "memory", title: "Memory injected", icon: Brain };
  }
  if (content.includes("Reasoning effort")) {
    return { kind: "reasoning", title: "Reasoning updated", icon: Clock3 };
  }
  return { kind: "generic", title: "Runtime notice", icon: Clock3 };
}

function systemMetaBadges(content: string, kind: SystemMessageKind): string[] {
  if (kind === "history") {
    const messageCount = content.match(/\((\d+) messages\)/)?.[1];
    const model = content.match(/Model:\s*(.+)$/m)?.[1];
    return [messageCount ? `${messageCount} messages` : "", model || ""].filter(Boolean);
  }
  if (kind === "compaction") {
    const tokenSummary = content.match(/Tokens:\s*([^\n]+)/)?.[1];
    const saved = content.match(/saved\s+(\d+)/)?.[1];
    return [tokenSummary || "", saved ? `${saved} saved` : ""].filter(Boolean);
  }
  if (kind === "rewind") {
    const target = content.match(/message\s+(\d+)/)?.[1];
    return [target ? `message ${target}` : ""].filter(Boolean);
  }
  if (kind === "stdin") {
    const tool = content.match(/requested by\s+(.+?)\s+\(/)?.[1];
    return [tool || ""].filter(Boolean);
  }
  if (kind === "queue") {
    const pending = content.match(/\((\d+)\s+pending\)/)?.[1];
    const remaining = content.match(/\((\d+)\s+remaining\)/)?.[1];
    return [pending ? `${pending} pending` : "", remaining ? `${remaining} remaining` : ""].filter(Boolean);
  }
  return [];
}

function systemBody(content: string, kind: SystemMessageKind): string {
  if (kind === "history") {
    return content.replace(/\nModel:\s*.+$/m, "");
  }
  return content;
}

export function MessageBubble({
  message,
  isStreaming,
  isHighlighted,
}: MessageBubbleProps) {
  if (message.role === "system") {
    const systemMeta = classifySystemMessage(message.content);
    const Icon = systemMeta.icon;
    const badges = systemMetaBadges(message.content, systemMeta.kind);
    return (
      <div
        data-message-id={message.id}
        className={cn(
          "flex justify-center py-2 rounded-lg transition-colors",
          isHighlighted && "bg-primary/10 ring-1 ring-primary/30",
        )}
      >
        <div
          className={cn(
            "max-w-[720px] w-full rounded-xl border px-4 py-3 text-xs",
            systemMeta.kind === "history" && "bg-sky-500/5 border-sky-500/20",
            systemMeta.kind === "compaction" && "bg-primary/5 border-primary/20",
            systemMeta.kind === "rewind" && "bg-amber-500/5 border-amber-500/20",
            systemMeta.kind === "stdin" && "bg-blue-500/5 border-blue-500/20",
            systemMeta.kind === "queue" && "bg-muted/50 border-border",
            systemMeta.kind === "memory" && "bg-emerald-500/5 border-emerald-500/20",
            systemMeta.kind === "reasoning" && "bg-violet-500/5 border-violet-500/20",
            systemMeta.kind === "generic" && "bg-card/60 border-border",
          )}
        >
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <Icon className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-medium text-foreground">{systemMeta.title}</span>
            <Badge variant="outline" className="ml-auto text-[10px] uppercase">
              {systemMeta.kind}
            </Badge>
            {badges.map((badge) => (
              <Badge key={badge} variant="secondary" className="text-[10px]">
                {badge}
              </Badge>
            ))}
          </div>
          <div className="text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
            {systemBody(message.content, systemMeta.kind)}
          </div>
        </div>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div
      data-message-id={message.id}
      className={cn(
        "rounded-xl transition-all",
        isHighlighted && "bg-primary/5 ring-1 ring-primary/30 px-2 py-1",
      )}
    >
      <Message from={message.role}>
        <MessageContent>
          {isUser ? (
            <>
              {message.images && message.images.length > 0 && (
                <div className="flex gap-2 mb-2 flex-wrap">
                  {message.images.map((img) => (
                    <div key={img.id} className="space-y-1">
                      <img
                        src={imageSrc(img)}
                        alt={img.label || "Attached"}
                        className="w-16 h-16 rounded-lg object-cover border"
                      />
                      {img.label && (
                        <div className="max-w-24 text-[10px] text-muted-foreground truncate">
                          {img.label}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <MessageResponse>{message.content}</MessageResponse>
            </>
          ) : (
            <>
              <div className="flex flex-row items-center justify-between mb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  JCode
                </span>
                {message.tokenUsage && (
                  <Badge variant="outline" className="text-[10px] font-mono">
                    ↑{message.tokenUsage.input} ↓{message.tokenUsage.output}
                  </Badge>
                )}
              </div>
              {message.images && message.images.length > 0 && (
                <div className="flex gap-2 mb-3 flex-wrap">
                  {message.images.map((img) => (
                    <div key={img.id} className="space-y-1">
                      <img
                        src={imageSrc(img)}
                        alt={img.label || "Attached"}
                        className="w-16 h-16 rounded-lg object-cover border"
                      />
                      {img.label && (
                        <div className="max-w-28 text-[10px] text-muted-foreground truncate">
                          {img.label}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {message.content && (
                <>
                  <MessageResponse>{message.content}</MessageResponse>
                  {isStreaming && (
                    <span className="text-primary animate-blink ml-0.5">▌</span>
                  )}
                </>
              )}
              {message.toolExecutions.length > 0 && (
                <div className="mt-3 space-y-2">
                  {message.toolExecutions.map((tool) => (
                    <ToolCard key={tool.id} tool={tool} />
                  ))}
                </div>
              )}
              <MessageActions>
                <MessageAction
                  onClick={() => navigator.clipboard.writeText(message.content)}
                  label="Copy"
                >
                  <CopyIcon className="size-3" />
                </MessageAction>
              </MessageActions>
            </>
          )}
        </MessageContent>
      </Message>
    </div>
  );
}
