import type { ChatMessage } from "@/types";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import { CopyIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ToolCard } from "./ToolCard";

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

  const isUser = message.role === "user";

  return (
    <Message from={message.role}>
      <MessageContent>
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
            <MessageResponse>
              {message.content}
            </MessageResponse>
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
              <>
                <MessageResponse>
                  {message.content}
                </MessageResponse>
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
  );
}