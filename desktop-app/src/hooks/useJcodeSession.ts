import { useReducer, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { rawServerEventToDesktopEvents } from "@/lib/serverEventAdapter";
import type {
  ServerEvent,
  SessionState,
  ChatMessage,
  ToolExecution,
  SessionInfo,
  AttachedImage,
  StdinPrompt,
  QueuedDraft,
  SwarmMemberStatusSnapshot,
  SwarmPlanProposalSummary,
  SwarmPlanSummary,
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
  | { type: "ADD_ASSISTANT_MESSAGE"; content: string; images?: AttachedImage[] }
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
  | { type: "QUEUE_DRAFT"; draft: QueuedDraft }
  | { type: "DEQUEUE_DRAFT"; draftId: string }
  | { type: "SET_PROCESSING"; value: boolean }
  | { type: "SET_ACTIVE_WORKSPACE"; workspaceId: string | null }
  | { type: "TOGGLE_WORKSPACE"; workspaceId: string }
  | { type: "ADD_SYSTEM_MESSAGE"; content: string }
  | { type: "CLEAR_CHAT" }
  | { type: "REWIND_CHAT"; messageIndex: number }
  | { type: "SET_REASONING_EFFORT"; effort: string | null }
  | { type: "SET_MEMORY_ENABLED"; enabled: boolean }
  | { type: "SET_CONNECTION_TYPE"; connection: string }
  | { type: "SET_STATUS_DETAIL"; detail: string }
  | { type: "LOAD_HISTORY"; messages: ChatMessage[] }
  | { type: "SET_AVAILABLE_MODELS"; models: string[]; routes?: import("@/types").ModelRoute[]; providerName?: string; providerModel?: string }
  | { type: "SET_TOTAL_TOKENS"; tokens: [number, number] | null }
  | { type: "APPLY_SWARM_STATUS"; members: SwarmMemberStatusSnapshot[] }
  | { type: "APPLY_SWARM_PLAN"; plan: SwarmPlanSummary }
  | { type: "APPLY_SWARM_PROPOSAL"; proposal: SwarmPlanProposalSummary };

let messageCounter = 0;
function nextMsgId(): string {
  messageCounter += 1;
  return `msg-${messageCounter}`;
}
function makeTitle(sid: string): string {
  const s = sid.split("_").pop() || sid;
  return s.length > 6 ? s.slice(s.length - 6) : s;
}

function truncateMessagesToVisibleConversationCount(
  messages: ChatMessage[],
  visibleConversationCount: number,
): ChatMessage[] {
  if (visibleConversationCount <= 0) return [];

  let seen = 0;
  let lastVisibleIndex = -1;
  for (let i = 0; i < messages.length; i += 1) {
    const role = messages[i]?.role;
    if (role === "user" || role === "assistant") {
      seen += 1;
      lastVisibleIndex = i;
      if (seen >= visibleConversationCount) break;
    }
  }

  if (lastVisibleIndex === -1) return [];
  return messages.slice(0, lastVisibleIndex + 1);
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
    memoryEnabled: true,
    connectionType: null,
    statusDetail: null,
    queuedDrafts: [],
    activeWorkspaceId: "default",
    expandedWorkspaces: new Set<string>(["default"]),
  };
}

function swarmRoleLabel(role?: string): SessionInfo["swarmRole"] {
  return role === "coordinator" ? "coordinator" : role === "agent" ? "agent" : undefined;
}

function applySwarmStatusToSessions(
  sessions: SessionInfo[],
  members: SwarmMemberStatusSnapshot[],
): SessionInfo[] {
  if (members.length === 0) return sessions;
  const memberMap = new Map(members.map((member) => [member.session_id, member]));
  return sessions.map((session) => {
    const member = memberMap.get(session.sessionId);
    if (!member) return session;
    const lowerStatus = member.status.toLowerCase();
    return {
      ...session,
      status: member.status,
      swarmEnabled: members.length >= 2,
      swarmPeerCount: members.length,
      swarmRole: swarmRoleLabel(member.role),
      liveStatusDetail: member.detail || session.liveStatusDetail,
      liveProcessing: ["running", "running_stale"].includes(lowerStatus)
        ? true
        : ["ready", "completed", "done", "failed", "stopped", "blocked"].includes(lowerStatus)
          ? false
          : session.liveProcessing,
      livePhase:
        lowerStatus === "running" || lowerStatus === "running_stale"
          ? session.liveToolName
            ? "tool"
            : "thinking"
          : lowerStatus === "blocked"
            ? "waiting"
            : ["ready", "completed", "done", "failed", "stopped"].includes(lowerStatus)
              ? "idle"
              : session.livePhase,
      subtitle: session.model ? `${member.status} · ${session.model}` : session.subtitle,
      detail: member.detail
        ? session.detail?.includes(member.detail)
          ? session.detail
          : session.detail
            ? `${session.detail} · ${member.detail}`
            : member.detail
        : session.detail,
    };
  });
}

function applySwarmPlanToSessions(
  sessions: SessionInfo[],
  plan: SwarmPlanSummary,
  currentSessionId?: string | null,
): SessionInfo[] {
  const fallbackParticipants = !plan.participantIds.length && currentSessionId
    ? [currentSessionId]
    : [];
  const effectiveParticipantIds = plan.participantIds.length > 0 ? plan.participantIds : fallbackParticipants;
  if (!effectiveParticipantIds.length) {
    return sessions.map((session) =>
      session.swarmId === plan.swarmId
        ? { ...session, swarmPlan: plan, swarmEnabled: true }
        : session,
    );
  }
  const participants = new Set(effectiveParticipantIds);
  return sessions.map((session) =>
    participants.has(session.sessionId)
      ? {
          ...session,
          swarmId: plan.swarmId,
          swarmEnabled: plan.participantCount >= 2 || session.swarmEnabled,
          swarmPeerCount: Math.max(plan.participantCount, session.swarmPeerCount || 0),
          swarmPlan: plan,
        }
      : session,
  );
}

function applySwarmProposalToSessions(
  sessions: SessionInfo[],
  proposal: SwarmPlanProposalSummary,
  currentSessionId?: string | null,
): SessionInfo[] {
  const targetIds = currentSessionId ? new Set([currentSessionId]) : new Set<string>();
  return sessions.map((session) =>
    targetIds.has(session.sessionId) || session.swarmId === proposal.swarmId || session.swarmRole === "coordinator"
      ? {
          ...session,
          swarmId: proposal.swarmId,
          swarmProposal: proposal,
        }
      : session,
  );
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
      return {
        ...state,
        workingDir: action.dir,
        activeWorkspaceId: action.dir ?? "default",
      };
    case "QUEUE_DRAFT":
      return {
        ...state,
        queuedDrafts: [...state.queuedDrafts, action.draft],
      };
    case "DEQUEUE_DRAFT":
      return {
        ...state,
        queuedDrafts: state.queuedDrafts.filter(
          (draft) => draft.id !== action.draftId,
        ),
      };
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
    case "ADD_ASSISTANT_MESSAGE": {
      const am: ChatMessage = {
        id: nextMsgId(),
        role: "assistant",
        content: action.content,
        toolExecutions: [],
        isStreaming: false,
        images: action.images,
        timestamp: Date.now(),
      };
      return {
        ...state,
        messages: [...state.messages, am],
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
      return {
        ...state,
        messages: truncateMessagesToVisibleConversationCount(
          state.messages,
          action.messageIndex,
        ),
      };
    }
    case "SET_REASONING_EFFORT":
      return { ...state, reasoningEffort: action.effort };
    case "SET_MEMORY_ENABLED":
      return { ...state, memoryEnabled: action.enabled };
    case "SET_CONNECTION_TYPE":
      return { ...state, connectionType: action.connection };
    case "SET_STATUS_DETAIL":
      return { ...state, statusDetail: action.detail };
    case "SET_ACTIVE_WORKSPACE":
      return { ...state, activeWorkspaceId: action.workspaceId ?? "default" };
    case "TOGGLE_WORKSPACE": {
      const next = new Set(state.expandedWorkspaces);
      if (next.has(action.workspaceId)) {
        next.delete(action.workspaceId);
      } else {
        next.add(action.workspaceId);
      }
      return { ...state, expandedWorkspaces: next };
    }
    case "LOAD_HISTORY":
      return { ...state, messages: action.messages, isProcessing: false };
    case "SET_AVAILABLE_MODELS":
      return {
        ...state,
        availableModels: action.models,
        availableModelRoutes: action.routes ?? state.availableModelRoutes,
        providerName: action.providerName ?? state.providerName,
        providerModel: action.providerModel ?? state.providerModel,
      };
    case "SET_TOTAL_TOKENS":
      return { ...state, totalTokens: action.tokens };
    case "APPLY_SWARM_STATUS": {
      const sessions = applySwarmStatusToSessions(state.sessions, action.members);
      const currentMember = state.sessionId
        ? action.members.find((member) => member.session_id === state.sessionId)
        : undefined;
      return {
        ...state,
        sessions,
        statusDetail: currentMember?.detail || state.statusDetail,
      };
    }
    case "APPLY_SWARM_PLAN":
      return {
        ...state,
        sessions: applySwarmPlanToSessions(state.sessions, action.plan, state.sessionId).map((session) =>
          session.swarmId === action.plan.swarmId ? { ...session, swarmProposal: undefined } : session,
        ),
      };
    case "APPLY_SWARM_PROPOSAL":
      return {
        ...state,
        sessions: applySwarmProposalToSessions(state.sessions, action.proposal, state.sessionId),
      };
    default:
      return state;
  }
}

function createQueuedDraft(
  content: string,
  images?: [string, string][],
): QueuedDraft {
  return {
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content,
    images,
  };
}

export function useJcodeSession() {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState());

  useEffect(() => {
    listSessions();
  }, []);

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

  const performSend = useCallback(
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

  const connect = useCallback(
    async (workingDir: string | null, model?: string, memoryEnabled?: boolean) => {
      dispatch({ type: "SET_CONNECTING" });
      try {
        await invoke("begin_session", {
          workingDir,
          model: model || null,
          memoryEnabled: memoryEnabled ?? true,
        });
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
      await performSend(content, images);
    },
    [performSend],
  );

  const queueMessage = useCallback((content: string, images?: [string, string][]) => {
    if (!content.trim() && (!images || images.length === 0)) return;
    const draft = createQueuedDraft(content, images);
    dispatch({ type: "QUEUE_DRAFT", draft });
    dispatch({
      type: "ADD_SYSTEM_MESSAGE",
      content: `📝 Queued prompt (${state.queuedDrafts.length + 1} pending)`,
    });
  }, [state.queuedDrafts.length]);

  const cancel = useCallback(async () => {
    try {
      await invoke("cancel");
      dispatch({ type: "INTERRUPTED" });
    } catch (e) {
      dispatch({ type: "SET_ERROR", message: String(e) });
    }
  }, []);

  const setModel = useCallback(async (model: string, profileId?: string) => {
    try {
      await invoke("set_model", { model, profileId: profileId || null });
    } catch (e) {
      dispatch({ type: "SET_ERROR", message: String(e) });
    }
  }, []);

  const setMemoryEnabled = useCallback(async (enabled: boolean) => {
    try {
      await invoke("set_memory_enabled", { enabled });
      dispatch({ type: "SET_MEMORY_ENABLED", enabled });
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
            subtitle?: string;
            detail?: string;
            preview_lines?: string[];
            detail_lines?: string[];
            model?: string;
            provider?: string;
            status: string;
            working_dir?: string;
            swarm_id?: string;
            swarm_enabled?: boolean;
            swarm_peer_count?: number;
            swarm_role?: "coordinator" | "agent";
            swarm_plan?: {
              swarm_id: string;
              version: number;
              item_count: number;
              participant_ids?: string[];
              participant_count?: number;
              reason?: string;
              ready_count: number;
              active_count: number;
              blocked_count: number;
              completed_count: number;
              next_ready_ids?: string[];
              items_preview?: Array<{
                id: string;
                content: string;
                status: string;
                priority: string;
                assigned_to?: string;
                subsystem?: string;
                blocked_by?: string[];
                file_scope?: string[];
              }>;
            };
            swarm_proposal?: {
              swarm_id: string;
              proposer_session: string;
              proposer_name?: string;
              summary: string;
              proposal_key: string;
              item_count: number;
              items_preview?: Array<{
                id: string;
                content: string;
                status: string;
                priority: string;
                assigned_to?: string;
                subsystem?: string;
                blocked_by?: string[];
                file_scope?: string[];
              }>;
            };
            live_processing?: boolean;
            live_tool_name?: string;
            live_status_detail?: string;
            live_phase?: "thinking" | "tool" | "chunking" | "waiting" | "idle";
          }>
        >("list_sessions");
      const sessions = data.map((d) => ({
        sessionId: d.id,
        title: d.title || makeTitle(d.id),
        isActive: d.id === state.sessionId,
        subtitle: d.subtitle,
        detail: d.detail,
        previewLines: d.preview_lines,
        detailLines: d.detail_lines,
        model: d.model,
        provider: d.provider,
        status: d.status,
        workingDir: d.working_dir,
        swarmId: d.swarm_id,
        swarmEnabled: d.swarm_enabled,
        swarmPeerCount: d.swarm_peer_count,
        swarmRole: d.swarm_role,
        swarmPlan: d.swarm_plan
          ? {
              swarmId: d.swarm_plan.swarm_id,
              version: d.swarm_plan.version,
              itemCount: d.swarm_plan.item_count,
              participantIds: d.swarm_plan.participant_ids || [],
              participantCount: d.swarm_plan.participant_count || d.swarm_plan.participant_ids?.length || 0,
              reason: d.swarm_plan.reason,
              readyCount: d.swarm_plan.ready_count,
              activeCount: d.swarm_plan.active_count,
              blockedCount: d.swarm_plan.blocked_count,
              completedCount: d.swarm_plan.completed_count,
              nextReadyIds: d.swarm_plan.next_ready_ids || [],
              itemsPreview: (d.swarm_plan.items_preview || []).map((item) => ({
                id: item.id,
                content: item.content,
                status: item.status,
                priority: item.priority,
                assignedTo: item.assigned_to,
                subsystem: item.subsystem,
                blockedBy: item.blocked_by,
                fileScope: item.file_scope,
              })),
            }
          : undefined,
        swarmProposal: d.swarm_proposal
          ? {
              swarmId: d.swarm_proposal.swarm_id,
              proposerSession: d.swarm_proposal.proposer_session,
              proposerName: d.swarm_proposal.proposer_name,
              summary: d.swarm_proposal.summary,
              proposalKey: d.swarm_proposal.proposal_key,
              itemCount: d.swarm_proposal.item_count,
              itemsPreview: (d.swarm_proposal.items_preview || []).map((item) => ({
                id: item.id,
                content: item.content,
                status: item.status,
                priority: item.priority,
                assignedTo: item.assigned_to,
                subsystem: item.subsystem,
                blockedBy: item.blocked_by,
                fileScope: item.file_scope,
              })),
            }
          : undefined,
        liveProcessing: d.live_processing,
        liveToolName: d.live_tool_name,
        liveStatusDetail: d.live_status_detail,
        livePhase: d.live_phase,
      }));
      dispatch({
        type: "SET_SESSIONS",
        sessions,
      });
      // Auto-expand workspaces that have the active session
      const activeSession = sessions.find((s) => s.isActive);
      dispatch({
        type: "SET_ACTIVE_WORKSPACE",
        workspaceId: activeSession?.workingDir || "default",
      });
    } catch (e) {
      dispatch({ type: "SET_ERROR", message: String(e) });
    }
  }, [state.sessionId]);

  const sendStdinResponse = useCallback(
    async (requestId: string, input: string) => {
      dispatch({
        type: "ADD_SYSTEM_MESSAGE",
        content: "⌨️ Sending interactive input",
      });
      try {
        await invoke("send_stdin_response", { requestId, input });
        dispatch({ type: "STDIN_DONE" });
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          content: "⌨️ Interactive input sent",
        });
      } catch (e) {
        dispatch({ type: "SET_ERROR", message: String(e) });
      }
    },
    [],
  );

  const setWorkingDir = useCallback((dir: string | null) => {
    dispatch({ type: "SET_WORKING_DIR", dir });
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await invoke("delete_session", { sessionId });
      await listSessions();
    } catch (e) {
      dispatch({ type: "SET_ERROR", message: String(e) });
      throw e;
    }
  }, [listSessions]);

  const deleteWorkspaceSessions = useCallback(async (workingDir: string | null) => {
    try {
      await invoke("delete_workspace_sessions", { workingDir });
      await listSessions();
    } catch (e) {
      dispatch({ type: "SET_ERROR", message: String(e) });
      throw e;
    }
  }, [listSessions]);

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

  useEffect(() => {
    if (
      state.isProcessing ||
      !state.connected ||
      state.stdinPrompt ||
      state.queuedDrafts.length === 0
    ) {
      return;
    }

    const nextDraft = state.queuedDrafts[0];
    if (!nextDraft) return;

    dispatch({ type: "DEQUEUE_DRAFT", draftId: nextDraft.id });
    dispatch({
      type: "ADD_SYSTEM_MESSAGE",
      content: `▶ Sending queued prompt (${state.queuedDrafts.length - 1} remaining)`,
    });
    void performSend(nextDraft.content, nextDraft.images);
  }, [
    state.isProcessing,
    state.connected,
    state.stdinPrompt,
    state.queuedDrafts,
    performSend,
  ]);

  return {
    state,
    connect,
    resumeSession,
    sendMessage,
    queueMessage,
    cancel,
    setModel,
    listSessions,
    sendStdinResponse,
    setWorkingDir,
    clearChat,
    rewindChat,
    setReasoningEffort,
    setMemoryEnabled,
    compactContext,
    deleteSession,
    deleteWorkspaceSessions,
    setActiveWorkspace,
    toggleWorkspace,
  };
}

function processEvent(event: ServerEvent, dispatch: React.Dispatch<Action>) {
  for (const desktopEvent of rawServerEventToDesktopEvents(event)) {
    switch (desktopEvent.type) {
      case "append-text":
        dispatch({ type: "APPEND_TEXT", text: desktopEvent.text });
        break;
      case "replace-text":
        dispatch({ type: "REPLACE_TEXT", text: desktopEvent.text });
        break;
      case "tool-start":
        dispatch({
          type: "TOOL_START",
          id: desktopEvent.id,
          name: desktopEvent.name,
        });
        break;
      case "tool-input":
        dispatch({ type: "TOOL_INPUT", id: "", delta: desktopEvent.delta });
        break;
      case "tool-exec":
        dispatch({
          type: "TOOL_EXEC",
          id: desktopEvent.id,
          name: desktopEvent.name,
        });
        break;
      case "tool-done":
        dispatch({
          type: "TOOL_DONE",
          id: desktopEvent.id,
          output: desktopEvent.output,
          error: desktopEvent.error,
        });
        break;
      case "assistant-message":
        dispatch({
          type: "ADD_ASSISTANT_MESSAGE",
          content: desktopEvent.content,
          images: desktopEvent.images,
        });
        break;
      case "token-usage":
        dispatch({
          type: "SET_TOKEN_USAGE",
          input: desktopEvent.input,
          output: desktopEvent.output,
        });
        break;
      case "done":
        dispatch({ type: "DONE" });
        break;
      case "error":
        dispatch({ type: "SET_ERROR", message: desktopEvent.message });
        break;
      case "session-id":
        dispatch({ type: "SET_SESSION_ID", sessionId: desktopEvent.sessionId });
        break;
      case "interrupted":
        dispatch({ type: "INTERRUPTED" });
        break;
      case "connection-phase":
        dispatch({ type: "SET_PHASE", phase: desktopEvent.phase });
        if (desktopEvent.phase === "connected") {
          dispatch({ type: "SET_CONNECTED" });
        }
        break;
      case "model-changed":
        dispatch({ type: "MODEL_CHANGED", model: desktopEvent.model });
        break;
      case "available-models":
        dispatch({
          type: "SET_AVAILABLE_MODELS",
          models: desktopEvent.models,
          routes: desktopEvent.routes,
          providerName: desktopEvent.providerName,
          providerModel: desktopEvent.providerModel,
        });
        break;
      case "stdin-request":
        dispatch({ type: "STDIN_REQUEST", prompt: desktopEvent.prompt });
        break;
      case "system-message":
        dispatch({ type: "ADD_SYSTEM_MESSAGE", content: desktopEvent.content });
        break;
      case "clear-chat":
        dispatch({ type: "CLEAR_CHAT" });
        break;
      case "rewind-chat":
        dispatch({ type: "REWIND_CHAT", messageIndex: desktopEvent.messageIndex });
        if (desktopEvent.notice) {
          dispatch({ type: "ADD_SYSTEM_MESSAGE", content: desktopEvent.notice });
        }
        break;
      case "reasoning-effort":
        dispatch({ type: "SET_REASONING_EFFORT", effort: desktopEvent.effort });
        if (desktopEvent.notice) {
          dispatch({ type: "ADD_SYSTEM_MESSAGE", content: desktopEvent.notice });
        }
        break;
      case "memory-feature":
        dispatch({ type: "SET_MEMORY_ENABLED", enabled: desktopEvent.enabled });
        if (desktopEvent.notice) {
          dispatch({ type: "ADD_SYSTEM_MESSAGE", content: desktopEvent.notice });
        }
        break;
      case "connection-type":
        dispatch({
          type: "SET_CONNECTION_TYPE",
          connection: desktopEvent.connection,
        });
        if (desktopEvent.notice) {
          dispatch({ type: "ADD_SYSTEM_MESSAGE", content: desktopEvent.notice });
        }
        break;
      case "status-detail":
        dispatch({ type: "SET_STATUS_DETAIL", detail: desktopEvent.detail });
        if (desktopEvent.notice) {
          dispatch({ type: "ADD_SYSTEM_MESSAGE", content: desktopEvent.notice });
        }
        break;
      case "total-tokens":
        dispatch({ type: "SET_TOTAL_TOKENS", tokens: desktopEvent.tokens });
        break;
      case "history-loaded":
        dispatch({ type: "LOAD_HISTORY", messages: desktopEvent.messages });
        break;
      case "swarm-status":
        dispatch({ type: "APPLY_SWARM_STATUS", members: desktopEvent.members });
        break;
      case "swarm-plan":
        dispatch({ type: "APPLY_SWARM_PLAN", plan: desktopEvent.plan });
        break;
      case "swarm-plan-proposal":
        dispatch({ type: "APPLY_SWARM_PROPOSAL", proposal: desktopEvent.proposal });
        break;
      default:
        break;
    }
  }
}
