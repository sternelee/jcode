import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToolCard } from "./ToolCard";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center py-2">
        <span className="text-xs text-muted-foreground">{message.content}</span>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={cn("flex mb-4", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%]",
          isUser
            ? "bg-secondary rounded-2xl rounded-br-sm px-4 py-3"
            : "w-full",
        )}
      >
        {isUser ? (
          <>
            {message.images && message.images.length > 0 && (
              <div className="flex gap-2 mb-2">
                {message.images.map((img) => (
                  <img
                    key={img.id}
                    src={`data:${img.mediaType};base64,${img.base64Data}`}
                    alt="Attached"
                    className="w-16 h-16 rounded-lg object-cover border"
                  />
                ))}
              </div>
            )}
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
              {message.content}
            </p>
          </>
        ) : (
          <Card className="border-muted/50">
            <CardHeader className="pb-2 pt-3 px-4 flex flex-row items-center justify-between space-y-0">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                JCode
              </span>
              {message.tokenUsage && (
                <Badge variant="outline" className="text-[10px] font-mono">
                  ↑{message.tokenUsage.input} ↓{message.tokenUsage.output}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="pb-3 px-4 pt-0">
              {message.images && message.images.length > 0 && (
                <div className="flex gap-2 mb-3">
                  {message.images.map((img) => (
                    <img
                      key={img.id}
                      src={`data:${img.mediaType};base64,${img.base64Data}`}
                      alt="Attached"
                      className="w-16 h-16 rounded-lg object-cover border"
                    />
                  ))}
                </div>
              )}
              {message.content && (
                <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                  {renderContent(message.content)}
                  {message.isStreaming && (
                    <span className="text-primary animate-blink ml-0.5">▌</span>
                  )}
                </div>
              )}
              {message.toolExecutions.length > 0 && (
                <div className="mt-3 space-y-2">
                  {message.toolExecutions.map((tool) => (
                    <ToolCard key={tool.id} tool={tool} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function renderContent(content: string): React.ReactNode {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++}>
          {renderInline(content.slice(lastIndex, match.index))}
        </span>,
      );
    }
    parts.push(
      <pre
        key={key++}
        className="bg-black/30 border rounded-lg p-3 my-2 overflow-x-auto relative"
      >
        {match[1] && (
          <span className="absolute top-1 right-2 text-[10px] text-muted-foreground uppercase">
            {match[1]}
          </span>
        )}
        <code className="text-xs font-mono leading-relaxed">{match[2]}</code>
      </pre>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push(
      <span key={key++}>{renderInline(content.slice(lastIndex))}</span>,
    );
  }
  return <>{parts}</>;
}

function renderInline(text: string): React.ReactNode {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code
        key={i}
        className="bg-black/30 px-1 py-0.5 rounded text-xs font-mono"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
