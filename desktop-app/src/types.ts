// --- Server event types (received from backend via "server-event" Tauri event) ---
export interface TextDeltaEvent {
  type: "text_delta";
  text: string;
}

export interface TextReplaceEvent {
  type: "text_replace";
  text: string;
}

export interface ToolStartEvent {
  type: "tool_start";
  id: string;
  name: string;
}

export interface ToolInputEvent {
  type: "tool_input";
  delta: string;
}

export interface ToolExecEvent {
  type: "tool_exec";
  id: string;
  name: string;
}

export interface ToolDoneEvent {
  type: "tool_done";
  id: string;
  name: string;
  output: string;
  error?: string;
}

export interface TokenUsageEvent {
  type: "tokens";
  input: number;
  output: number;
  cache_read_input?: number;
  cache_creation_input?: number;
}

export interface DoneEvent {
  type: "done";
  id: number;
}

export interface ErrorEvent {
  type: "error";
  id: number;
  message: string;
  retry_after_secs?: number;
}

export interface SessionIdEvent {
  type: "session";
  session_id: string;
}

export interface AckEvent {
  type: "ack";
  id: number;
}

export interface InterruptedEvent {
  type: "interrupted";
}

export interface ConnectionPhaseEvent {
  type: "connection_phase";
  phase: string;
}

export interface ConnectionTypeEvent {
  type: "connection_type";
  connection: string;
}

export interface StatusDetailEvent {
  type: "status_detail";
  detail: string;
}

export interface CompactionEvent {
  type: "compaction";
  trigger: string;
  pre_tokens?: number;
  post_tokens?: number;
  tokens_saved?: number;
}

export interface MemoryInjectedEvent {
  type: "memory_injected";
  count: number;
  prompt?: string;
  display_prompt?: string;
  prompt_chars: number;
  computed_age_ms: number;
}

export interface ModelChangedEvent {
  type: "model_changed";
  id: number;
  model: string;
  provider_name?: string;
}

export interface GeneratedImageEvent {
  type: "generated_image";
  id: string;
  path: string;
  output_format: string;
  revised_prompt?: string;
}

export interface StdinRequestEvent {
  type: "stdin_request";
  request_id: string;
  prompt: string;
  is_password: boolean;
  tool_call_id: string;
}

export interface HistoryEvent {
  type: "history";
  id: number;
  session_id: string;
  messages: HistoryMessage[];
  images?: RenderedImage[];
  provider_name?: string;
  provider_model?: string;
  available_models: string[];
  available_model_routes?: ModelRoute[];
  mcp_servers?: string[];
  skills?: string[];
  total_tokens?: [number, number];
  all_sessions: string[];
  client_count?: number;
  server_name?: string;
  server_icon?: string;
  server_version?: string;
  is_canary?: boolean;
  was_interrupted?: boolean;
  connection_type?: string;
  compaction_mode?: string;
  reasoning_effort?: string;
}

export interface AvailableModelsUpdatedEvent {
  type: "available_models_updated";
  provider_name?: string;
  provider_model?: string;
  available_models: string[];
  available_model_routes?: ModelRoute[];
}

export interface ClearChatEvent {
  type: "clear_chat";
}

export interface RewindChatEvent {
  type: "rewind_chat";
  message_index: number;
}

export interface ReasoningEffortChangedEvent {
  type: "reasoning_effort_changed";
  id: number;
  effort?: string;
  error?: string;
}

export interface CompactResultEvent {
  type: "compact_result";
  id: number;
  message: string;
  success: boolean;
}

export interface HistoryMessage {
  role: string;
  content: string;
  tool_calls?: string[];
  tool_data?: ToolCallData;
}

export interface ToolCallData {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface RenderedImage {
  path: string;
  media_type: string;
  base64_data?: string;
}

export interface ModelRoute {
  provider: string;
  model: string;
  display_name?: string;
  context_window?: number;
}

// --- Server event union ---
export type ServerEvent =
  | TextDeltaEvent
  | TextReplaceEvent
  | ToolStartEvent
  | ToolInputEvent
  | ToolExecEvent
  | ToolDoneEvent
  | TokenUsageEvent
  | DoneEvent
  | ErrorEvent
  | SessionIdEvent
  | AckEvent
  | InterruptedEvent
  | ConnectionPhaseEvent
  | ConnectionTypeEvent
  | StatusDetailEvent
  | CompactionEvent
  | MemoryInjectedEvent
  | ModelChangedEvent
  | GeneratedImageEvent
  | StdinRequestEvent
  | HistoryEvent
  | AvailableModelsUpdatedEvent
  | ClearChatEvent
  | RewindChatEvent
  | ReasoningEffortChangedEvent
  | CompactResultEvent;

// --- UI-internal types ---

export type ToolStatus =
  | "starting"
  | "collecting_input"
  | "executing"
  | "done"
  | "error";

export interface ToolExecution {
  id: string;
  name: string;
  status: ToolStatus;
  input: string;
  output?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolExecutions: ToolExecution[];
  isStreaming: boolean;
  tokenUsage?: { input: number; output: number };
  images?: AttachedImage[];
  timestamp?: number;
}

export interface AttachedImage {
  id: string;
  mediaType: string;
  base64Data: string;
  thumbnailData?: string;
}

export interface SessionInfo {
  sessionId: string;
  title: string;
  isActive: boolean;
  providerName?: string;
  providerModel?: string;
  model?: string;
  provider?: string;
  status?: string;
  workingDir?: string;
}

export interface Workspace {
  id: string;
  name: string;
  sessions: SessionInfo[];
}

export interface StdinPrompt {
  requestId: string;
  prompt: string;
  isPassword: boolean;
  toolCallId: string;
}

export interface SessionState {
  connected: boolean;
  connecting: boolean;
  sessionId: string | null;
  messages: ChatMessage[];
  sessions: SessionInfo[];
  providerName: string | null;
  providerModel: string | null;
  availableModels: string[];
  availableModelRoutes: ModelRoute[];
  totalTokens: [number, number] | null;
  isProcessing: boolean;
  connectionPhase: string | null;
  error: string | null;
  serverName: string | null;
  serverIcon: string | null;
  stdinPrompt: StdinPrompt | null;
  workingDir: string | null;
  reasoningEffort: string | null;
  connectionType: string | null;
  statusDetail: string | null;
  activeWorkspaceId: string | null;
  expandedWorkspaces: Set<string>;
}
