import { useReducer, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type {
  ServerEvent,
  SessionState,
  ChatMessage,
  ToolExecution,
  SessionInfo,
  AttachedImage,
  StdinPrompt,
} from "@/types";

type Action =
  | { type: "SET_CONNECTING" }
  | { type: "SET_CONNECTED" }
  | { type: "SET_DISCONNECTED" }
  | { type: "SET_ERROR"; message: string }
  | { type: "CLEAR_ERROR" }
  | { type: "SET_PHASE"; phase: string }
  | { type: "SET_SESSION_ID"; sessionId: string }
  | { type: "SET_SESSIONS"; sessions: SessionInfo[] }
  | { type: "ADD_USER_MESSAGE"; content: string; images?: AttachedImage[] }
  | { type: "START_ASSISTANT_MESSAGE" }
  | { type: "APPEND_TEXT"; text: string }
  | { type: "REPLACE_TEXT"; text: string }
  | { type: "TOOL_START"; id: string; name: string }
  | { type: "TOOL_INPUT"; id: string; delta: string }
  | { type: "TOOL_EXEC"; id: string; name: string }
  | { type: "TOOL_DONE"; id: string; output: string; error?: string }
  | { type: "SET_TOKEN_USAGE"; input: number; output: number }
  | { type: "DONE" }
  | { type: "INTERRUPTED" }
  | { type: "MODEL_CHANGED"; model: string; providerName?: string }
  | { type: "MODELS_UPDATED"; models: string[] }
  | { type: "STDIN_REQUEST"; prompt: StdinPrompt }
  | { type: "STDIN_DONE" }
  | { type: "SET_WORKING_DIR"; dir: string | null }
  | { type: "SET_PROCESSING"; value: boolean }
  | { type: "SET_ACTIVE_WORKSPACE"; workspaceId: string | null }
  | { type: "TOGGLE_WORKSPACE"; workspaceId: string }
  | { type: "ADD_SYSTEM_MESSAGE"; content: string }
  | { type: "CLEAR_CHAT" }
  | { type: "REWIND_CHAT"; messageIndex: number }
  | { type: "SET_REASONING_EFFORT"; effort: string | null }
  | { type: "SET_CONNECTION_TYPE"; connection: string }
  | { type: "SET_STATUS_DETAIL"; detail: string };

let messageCounter = 0;
function nextMsgId(): string {
  messageCounter += 1;
  return `msg-${messageCounter}`;
}
function makeTitle(sid: string): string {
  const s = sid.split("_").pop() || sid;
  return s.length > 6 ? s.slice(s.length - 6) : s;
}

function initialSessionState(): SessionState {
  return {
    connected: false,
    connecting: false,
    sessionId: null,
    messages: [],
    sessions: [],
    providerName: null,
    providerModel: null,
    availableModels: [],
    availableModelRoutes: [],
    totalTokens: null,
    isProcessing: false,
    connectionPhase: null,
    error: null,
    serverName: null,
    serverIcon: null,
    stdinPrompt: null,
    workingDir: null,
    reasoningEffort: null,
    connectionType: null,
    statusDetail: null,
    activeWorkspaceId: null,
    expandedWorkspaces: new Set<string>(),
  };
}

function sessionReducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case "SET_CONNECTING":
      return {
        ...state,
        connecting: true,
        connectionPhase: "initializing",
        error: null,
      };
    case "SET_CONNECTED":
      return {
        ...state,
        connected: true,
        connecting: false,
        connectionPhase: "connected",
        error: null,
      };
    case "SET_DISCONNECTED":
      return {
        ...state,
        connected: false,
        connecting: false,
        connectionPhase: "disconnected",
        error: "Session ended",
      };
    case "SET_ERROR":
      return { ...state, error: action.message, isProcessing: false };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    case "SET_PHASE":
      return { ...state, connectionPhase: action.phase };
    case "SET_SESSION_ID":
      return { ...state, sessionId: action.sessionId };
    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions };
    case "SET_WORKING_DIR":
      return { ...state, workingDir: action.dir };
    case "ADD_USER_MESSAGE": {
      const um: ChatMessage = {
        id: nextMsgId(),
        role: "user",
        content: action.content,
        toolExecutions: [],
        isStreaming: false,
        images: action.images,
        timestamp: Date.now(),
      };
      return {
        ...state,
        messages: [...state.messages, um],
        isProcessing: true,
      };
    }
    case "APPEND_TEXT": {
      const ms = [...state.messages];
      const l = ms[ms.length - 1];
      if (l && l.role === "assistant" && l.isStreaming)
        ms[ms.length - 1] = { ...l, content: l.content + action.text };
      else
        ms.push({
          id: nextMsgId(),
          role: "assistant",
          content: action.text,
          toolExecutions: [],
          isStreaming: true,
          timestamp: Date.now(),
        });
      return { ...state, messages: ms };
    }
    case "REPLACE_TEXT": {
      const ms = [...state.messages];
      const l = ms[ms.length - 1];
      if (l && l.role === "assistant")
        ms[ms.length - 1] = { ...l, content: action.text };
      return { ...state, messages: ms };
    }
    case "TOOL_START": {
      const ms = [...state.messages];
      const l = ms[ms.length - 1];
      if (l && l.role === "assistant") {
        const t: ToolExecution = {
          id: action.id,
          name: action.name,
          status: "starting",
          input: "",
        };
        ms[ms.length - 1] = { ...l, toolExecutions: [...l.toolExecutions, t] };
      }
      return { ...state, messages: ms };
    }
    case "TOOL_INPUT": {
      const ms = [...state.messages];
      const l = ms[ms.length - 1];
      if (l && l.role === "assistant") {
        const tls = [...l.toolExecutions];
        const c = tls[tls.length - 1];
        if (c && c.status !== "done" && c.status !== "error")
          tls[tls.length - 1] = {
            ...c,
            input: c.input + action.delta,
            status: "collecting_input",
          };
        ms[ms.length - 1] = { ...l, toolExecutions: tls };
      }
      return { ...state, messages: ms };
    }
    case "TOOL_EXEC": {
      const ms = [...state.messages];
      const l = ms[ms.length - 1];
      if (l && l.role === "assistant") {
        const tls = [...l.toolExecutions];
        const i = tls.findIndex((t) => t.id === action.id);
        if (i !== -1)
          tls[i] = { ...tls[i], status: "executing", name: action.name };
        ms[ms.length - 1] = { ...l, toolExecutions: tls };
      }
      return { ...state, messages: ms };
    }
    case "TOOL_DONE": {
      const ms = [...state.messages];
      const l = ms[ms.length - 1];
      if (l && l.role === "assistant") {
        const tls = [...l.toolExecutions];
        const i = tls.findIndex((t) => t.id === action.id);
        if (i !== -1)
          tls[i] = {
            ...tls[i],
            status: action.error ? "error" : "done",
            output: action.output,
            error: action.error,
          };
        ms[ms.length - 1] = { ...l, toolExecutions: tls };
      }
      return { ...state, messages: ms };
    }
    case "SET_TOKEN_USAGE": {
      const ms = [...state.messages];
      const l = ms[ms.length - 1];
      if (l && l.role === "assistant")
        ms[ms.length - 1] = {
          ...l,
          tokenUsage: { input: action.input, output: action.output },
        };
      return {
        ...state,
        totalTokens: [action.input, action.output],
        messages: ms,
      };
    }
    case "DONE": {
      const ms = [...state.messages];
      const l = ms[ms.length - 1];
      if (l && l.role === "assistant")
        ms[ms.length - 1] = { ...l, isStreaming: false };
      return { ...state, isProcessing: false, messages: ms };
    }
    case "INTERRUPTED": {
      const ms = [...state.messages];
      const l = ms[ms.length - 1];
      if (l && l.role === "assistant" && l.isStreaming)
        ms[ms.length - 1] = { ...l, isStreaming: false };
      return { ...state, isProcessing: false, messages: ms };
    }
    case "MODEL_CHANGED":
      return { ...state, providerModel: action.model };
    case "MODELS_UPDATED":
      return { ...state, availableModels: action.models };
    case "STDIN_REQUEST":
      return { ...state, stdinPrompt: action.prompt };
    case "STDIN_DONE":
      return { ...state, stdinPrompt: null };
    case "SET_PROCESSING":
      return { ...state, isProcessing: action.value };
    case "ADD_SYSTEM_MESSAGE": {
      const sm: ChatMessage = {
        id: nextMsgId(),
        role: "system",
        content: action.content,
        toolExecutions: [],
        isStreaming: false,
        timestamp: Date.now(),
      };
      return { ...state, messages: [...state.messages, sm] };
    }
    case "CLEAR_CHAT":
      return { ...state, messages: [] };
    case "REWIND_CHAT": {
      const keepCount = action.messageIndex;
      return {
        ...state,
        messages: state.messages.slice(0, keepCount),
      };
    }
    case "SET_REASONING_EFFORT":
      return { ...state, reasoningEffort: action.effort };
    case "SET_CONNECTION_TYPE":
      return { ...state, connectionType: action.connection };
    case "SET_STATUS_DETAIL":
      return { ...state, statusDetail: action.detail };
    case "SET_ACTIVE_WORKSPACE":
      return { ...state, activeWorkspaceId: action.workspaceId };
    case "TOGGLE_WORKSPACE": {
      const next = new Set(state.expandedWorkspaces);
      if (next.has(action.workspaceId)) {
        next.delete(action.workspaceId);
      } else {
        next.add(action.workspaceId);
      }
      return { ...state, expandedWorkspaces: next };
    }
    default:
      return state;
  }
}

export function useJcodeSession() {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState());

  useEffect(() => {
    const unlisten = listen<Record<string, unknown>>(
      "server-event",
      (event) => {
        processEvent(event.payload as unknown as ServerEvent, dispatch);
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const connect = useCallback(
    async (workingDir: string | null, model?: string) => {
      dispatch({ type: "SET_CONNECTING" });
      try {
        await invoke("begin_session", { workingDir, model: model || null });
      } catch (e) {
        dispatch({ type: "SET_ERROR", message: String(e) });
      }
    },
    [],
  );

  const resumeSession = useCallback(
    async (sessionId: string, workingDir: string | null) => {
      dispatch({ type: "SET_CONNECTING" });
      try {
        await invoke("resume_session", { sessionId, workingDir });
      } catch (e) {
        dispatch({ type: "SET_ERROR", message: String(e) });
      }
    },
    [],
  );

  const sendMessage = useCallback(
    async (content: string, images?: [string, string][]) => {
      if (!content.trim() && (!images || images.length === 0)) return;
      dispatch({
        type: "ADD_USER_MESSAGE",
        content: content.trim() || "(image)",
        images: images?.map(([m, d], i) => ({
          id: `img-${Date.now()}-${i}`,
          mediaType: m,
          base64Data: d,
        })),
      });
      try {
        await invoke("send_message", {
          content,
          images: images || null,
          systemReminder: null,
        });
      } catch (e) {
        dispatch({ type: "SET_ERROR", message: String(e) });
      }
    },
    [],
  );

  const cancel = useCallback(async () => {
    try {
      await invoke("cancel");
      dispatch({ type: "INTERRUPTED" });
    } catch (e) {
      dispatch({ type: "SET_ERROR", message: String(e) });
    }
  }, []);

  const setModel = useCallback(async (model: string) => {
    try {
      await invoke("set_model", { model });
    } catch (e) {
      dispatch({ type: "SET_ERROR", message: String(e) });
    }
  }, []);

  const listSessions = useCallback(async () => {
    try {
      const data =
        await invoke<
          Array<{
            id: string;
            title: string;
            model?: string;
            provider?: string;
            status: string;
            working_dir?: string;
          }>
        >("list_sessions");
      const sessions = data.map((d) => ({
        sessionId: d.id,
        title: d.title || makeTitle(d.id),
        isActive: d.id === state.sessionId,
        model: d.model,
        provider: d.provider,
        status: d.status,
        workingDir: d.working_dir,
      }));
      dispatch({
        type: "SET_SESSIONS",
        sessions,
      });
      // Auto-expand workspaces that have the active session
      const activeSession = sessions.find((s) => s.isActive);
      if (activeSession?.workingDir) {
        dispatch({
          type: "SET_ACTIVE_WORKSPACE",
          workspaceId: activeSession.workingDir,
        });
      }
    } catch (e) {
      dispatch({ type: "SET_ERROR", message: String(e) });
    }
  }, [state.sessionId]);

  const sendStdinResponse = useCallback(
    async (requestId: string, input: string) => {
      try {
        await invoke("send_stdin_response", { requestId, input });
        dispatch({ type: "STDIN_DONE" });
      } catch (e) {
        dispatch({ type: "SET_ERROR", message: String(e) });
      }
    },
    [],
  );

  const setWorkingDir = useCallback((dir: string | null) => {
    dispatch({ type: "SET_WORKING_DIR", dir });
  }, []);

  const clearChat = useCallback(async () => {
    try {
      await invoke("clear_chat");
      dispatch({ type: "CLEAR_CHAT" });
    } catch (e) {
      dispatch({ type: "SET_ERROR", message: String(e) });
    }
  }, []);

  const rewindChat = useCallback(async (messageIndex: number) => {
    try {
      await invoke("rewind_chat", { messageIndex });
      dispatch({ type: "REWIND_CHAT", messageIndex });
    } catch (e) {
      dispatch({ type: "SET_ERROR", message: String(e) });
    }
  }, []);

  const setReasoningEffort = useCallback(async (effort: string) => {
    try {
      await invoke("set_reasoning_effort", { effort });
    } catch (e) {
      dispatch({ type: "SET_ERROR", message: String(e) });
    }
  }, []);

  const compactContext = useCallback(async () => {
    try {
      await invoke("compact_context");
    } catch (e) {
      dispatch({ type: "SET_ERROR", message: String(e) });
    }
  }, []);

  const setActiveWorkspace = useCallback((workspaceId: string | null) => {
    dispatch({ type: "SET_ACTIVE_WORKSPACE", workspaceId });
  }, []);

  const toggleWorkspace = useCallback((workspaceId: string) => {
    dispatch({ type: "TOGGLE_WORKSPACE", workspaceId });
  }, []);

  return {
    state,
    connect,
    resumeSession,
    sendMessage,
    cancel,
    setModel,
    listSessions,
    sendStdinResponse,
    setWorkingDir,
    clearChat,
    rewindChat,
    setReasoningEffort,
    compactContext,
    setActiveWorkspace,
    toggleWorkspace,
  };
}

function processEvent(event: ServerEvent, dispatch: React.Dispatch<Action>) {
  const e = event as unknown as Record<string, unknown>;
  switch (event.type) {
    case "text_delta":
      dispatch({ type: "APPEND_TEXT", text: e.text as string });
      break;
    case "text_replace":
      dispatch({ type: "REPLACE_TEXT", text: e.text as string });
      break;
    case "tool_start":
      dispatch({
        type: "TOOL_START",
        id: e.id as string,
        name: e.name as string,
      });
      break;
    case "tool_input":
      dispatch({ type: "TOOL_INPUT", id: "", delta: e.delta as string });
      break;
    case "tool_exec":
      dispatch({
        type: "TOOL_EXEC",
        id: e.id as string,
        name: e.name as string,
      });
      break;
    case "tool_done":
      dispatch({
        type: "TOOL_DONE",
        id: e.id as string,
        output: (e.output as string) || "",
        error: e.error as string | undefined,
      });
      break;
    case "tokens":
      dispatch({
        type: "SET_TOKEN_USAGE",
        input: e.input as number,
        output: e.output as number,
      });
      break;
    case "done":
      dispatch({ type: "DONE" });
      break;
    case "error":
      dispatch({ type: "SET_ERROR", message: e.message as string });
      break;
    case "session":
      dispatch({ type: "SET_SESSION_ID", sessionId: e.session_id as string });
      break;
    case "interrupted":
      dispatch({ type: "INTERRUPTED" });
      break;
    case "connection_phase":
      dispatch({ type: "SET_PHASE", phase: e.phase as string });
      if (e.phase === "connected") dispatch({ type: "SET_CONNECTED" });
      break;
    case "model_changed":
      dispatch({ type: "MODEL_CHANGED", model: e.model as string });
      break;
    case "available_models_updated":
      dispatch({
        type: "MODELS_UPDATED",
        models: e.available_models as string[],
      });
      break;
    case "stdin_request":
      dispatch({
        type: "STDIN_REQUEST",
        prompt: {
          requestId: e.request_id as string,
          prompt: e.prompt as string,
          isPassword: e.is_password as boolean,
          toolCallId: e.tool_call_id as string,
        },
      });
      break;
    case "compaction": {
      const trigger = e.trigger as string;
      const pre = e.pre_tokens as number | undefined;
      const post = e.post_tokens as number | undefined;
      const saved = e.tokens_saved as number | undefined;
      let content = `📦 Context compaction triggered (${trigger})`;
      if (pre !== undefined && post !== undefined) {
        content += `\nTokens: ${pre} → ${post}`;
      }
      if (saved !== undefined) {
        content += ` (saved ${saved})`;
      }
      dispatch({ type: "ADD_SYSTEM_MESSAGE", content });
      break;
    }
    case "memory_injected": {
      const count = e.count as number;
      const promptChars = e.prompt_chars as number;
      dispatch({
        type: "ADD_SYSTEM_MESSAGE",
        content: `🧠 ${count} memory(s) injected (${promptChars} chars)`,
      });
      break;
    }
    case "connection_type": {
      dispatch({
        type: "SET_CONNECTION_TYPE",
        connection: e.connection as string,
      });
      dispatch({
        type: "ADD_SYSTEM_MESSAGE",
        content: `🔌 Connection type: ${e.connection as string}`,
      });
      break;
    }
    case "status_detail": {
      dispatch({
        type: "SET_STATUS_DETAIL",
        detail: e.detail as string,
      });
      dispatch({
        type: "ADD_SYSTEM_MESSAGE",
        content: `ℹ️ ${e.detail as string}`,
      });
      break;
    }
    case "clear_chat":
      dispatch({ type: "CLEAR_CHAT" });
      break;
    case "rewind_chat": {
      const msgIdx = e.message_index as number;
      dispatch({ type: "REWIND_CHAT", messageIndex: msgIdx });
      dispatch({
        type: "ADD_SYSTEM_MESSAGE",
        content: `⏪ Rewound to message ${msgIdx}`,
      });
      break;
    }
    case "reasoning_effort_changed": {
      const effort = e.effort as string | null | undefined;
      dispatch({ type: "SET_REASONING_EFFORT", effort: effort || null });
      if (effort) {
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          content: `🧠 Reasoning effort set to: ${effort}`,
        });
      }
      break;
    }
    case "compact_result": {
      const msg = e.message as string;
      const success = e.success as boolean;
      dispatch({
        type: "ADD_SYSTEM_MESSAGE",
        content: success ? msg : `⚠️ ${msg}`,
      });
      break;
    }
    default:
      break;
  }
}
