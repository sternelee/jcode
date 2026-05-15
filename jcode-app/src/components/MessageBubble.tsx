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

// --- 角色颜色系统 ---
const ROLE_PALETTE = [
  { dot: "bg-blue-500",    name: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-950/20" },
  { dot: "bg-emerald-500", name: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/20" },
  { dot: "bg-violet-500",  name: "text-violet-600 dark:text-violet-400",  bg: "bg-violet-50 dark:bg-violet-950/20" },
  { dot: "bg-amber-500",   name: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-950/20" },
  { dot: "bg-rose-500",    name: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-50 dark:bg-rose-950/20" },
  { dot: "bg-cyan-500",    name: "text-cyan-600 dark:text-cyan-400",    bg: "bg-cyan-50 dark:bg-cyan-950/20" },
  { dot: "bg-orange-500",  name: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/20" },
  { dot: "bg-pink-500",    name: "text-pink-600 dark:text-pink-400",    bg: "bg-pink-50 dark:bg-pink-950/20" },
] as const;

function roleColorIndex(roleName: string): number {
  let h = 0;
  for (let i = 0; i < roleName.length; i++) {
    h = roleName.charCodeAt(i) + ((h << 5) - h);
  }
  return Math.abs(h) % ROLE_PALETTE.length;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// --- SkeletonMessage: AI 回复加载中占位 ---
export function SkeletonMessage({ roleName }: { roleName?: string }) {
  const palette = roleName ? ROLE_PALETTE[roleColorIndex(roleName)] : null;
  const initial = roleName ? roleName.charAt(0).toUpperCase() : null;
  return (
    <div className="flex gap-3 px-3 py-2 rounded-xl">
      {/* 头像 */}
      <div
        className={cn(
          "mt-0.5 h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-sm font-bold text-white",
          palette ? palette.dot : "bg-muted animate-pulse",
        )}
      >
        {initial}
      </div>
      <div className="flex-1 min-w-0 py-0.5">
        {/* 角色名 + 时间戳占位 */}
        {roleName && (
          <div className={cn("text-sm font-bold mb-2", palette?.name)}>{roleName}</div>
        )}
        {/* 文字骨架屏 */}
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <div className="h-2.5 rounded-full bg-muted animate-pulse w-1/2" />
            <div className="h-2.5 rounded-full bg-muted animate-pulse w-1/4" />
          </div>
          <div className="h-2.5 rounded-full bg-muted animate-pulse w-3/4" />
          <div className="h-2.5 rounded-full bg-muted animate-pulse w-2/5" />
        </div>
      </div>
    </div>
  );
}

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

  // --- Slack 风格的角色消息 ---
  if (!isUser && message.roleName) {
    const palette = ROLE_PALETTE[roleColorIndex(message.roleName)];
    const initial = message.roleName.charAt(0).toUpperCase();
    return (
      <div
        data-message-id={message.id}
        className={cn(
          "group flex gap-3 px-3 py-2 rounded-xl transition-colors hover:bg-secondary/30",
          isHighlighted && "bg-primary/5 ring-1 ring-primary/30",
        )}
      >
        {/* 角色头像 */}
        <div
          className={cn(
            "mt-0.5 h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-sm font-bold text-white shadow-sm",
            palette.dot,
          )}
        >
          {initial}
        </div>

        <div className="flex-1 min-w-0">
          {/* 头部：角色名 + 时间戳 + token */}
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className={cn("text-sm font-bold leading-none", palette.name)}>
              {message.roleName}
            </span>
            {message.timestamp && (
              <span className="text-[11px] text-muted-foreground leading-none">
                {formatTime(message.timestamp)}
              </span>
            )}
            {message.tokenUsage && (
              <Badge variant="outline" className="text-[10px] font-mono ml-auto">
                ↑{message.tokenUsage.input} ↓{message.tokenUsage.output}
              </Badge>
            )}
          </div>

          {/* 图片 */}
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

          {/* 消息内容 */}
          {message.content && (
            <div className="relative">
              <MessageResponse>{message.content}</MessageResponse>
              {isStreaming && (
                <span className="text-primary animate-blink ml-0.5">▌</span>
              )}
            </div>
          )}

          {/* 工具调用 */}
          {message.toolExecutions.length > 0 && (
            <div className="mt-3 space-y-2">
              {message.toolExecutions.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>
          )}

          {/* 操作按钒（hover 时显示） */}
          <MessageActions>
            <MessageAction
              onClick={() => navigator.clipboard.writeText(message.content)}
              label="Copy"
            >
              <CopyIcon className="size-3" />
            </MessageAction>
          </MessageActions>
        </div>
      </div>
    );
  }

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
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {message.roleName || "JCode"}
                  </span>
                  {message.roleName && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                      {message.roleName}
                    </Badge>
                  )}
                </div>
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
