import type { ChatMessage } from "@/types";
import { MessageBubble } from "./MessageBubble";
import { InputArea } from "./InputArea";
import { Trash2, Undo2, ArrowDownWideNarrow, MessageSquare, FolderOpen } from "lucide-react";
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
} from "@/components/ai-elements/conversation";

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
  onSelectWorkspace?: () => void;
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
  onSelectWorkspace,
}: ChatViewProps) {
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;

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
          {!connected && !connectionPhase ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-4 text-muted-foreground">
              <Button
                variant="outline"
                size="lg"
                className="gap-2"
                onClick={onSelectWorkspace}
              >
                <FolderOpen className="w-5 h-5" />
                Select Workspace
              </Button>
              <p className="text-xs">
                Choose a folder to start a new workspace
              </p>
            </div>
          ) : !connected ? (
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
                isStreaming={msg.id === lastMessageId && isProcessing}
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