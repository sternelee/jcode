import type { ChatMessage } from "@/types";

export interface UIMessage {
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