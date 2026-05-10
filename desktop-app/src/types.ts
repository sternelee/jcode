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
  metadata_path?: string;
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
  memory_enabled?: boolean;
}

export interface AvailableModelsUpdatedEvent {
  type: "available_models_updated";
  provider_name?: string;
  provider_model?: string;
  available_models: string[];
  available_model_routes?: ModelRoute[];
}

export interface PlanItemSnapshot {
  id: string;
  content: string;
  status: string;
  priority: string;
  subsystem?: string;
  file_scope?: string[];
  blocked_by?: string[];
  assigned_to?: string;
}

export interface PlanGraphStatusSnapshot {
  swarm_id?: string;
  version: number;
  item_count: number;
  ready_ids: string[];
  blocked_ids: string[];
  active_ids: string[];
  completed_ids: string[];
  cycle_ids: string[];
  unresolved_dependency_ids: string[];
  next_ready_ids: string[];
  newly_ready_ids: string[];
}

export interface SwarmMemberStatusSnapshot {
  session_id: string;
  friendly_name?: string;
  status: string;
  detail?: string;
  role?: string;
  is_headless?: boolean;
  live_attachments?: number;
  status_age_secs?: number;
}

export interface SwarmStatusEvent {
  type: "swarm_status";
  members: SwarmMemberStatusSnapshot[];
}

export interface SwarmPlanEvent {
  type: "swarm_plan";
  swarm_id: string;
  version: number;
  items: PlanItemSnapshot[];
  participants?: string[];
  reason?: string;
  summary?: PlanGraphStatusSnapshot;
}

export interface SwarmPlanProposalEvent {
  type: "swarm_plan_proposal";
  swarm_id: string;
  proposer_session: string;
  proposer_name?: string;
  items: PlanItemSnapshot[];
  summary: string;
  proposal_key: string;
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

export interface MemoryFeatureChangedEvent {
  type: "memory_feature_changed";
  enabled: boolean;
}

export interface HistoryMessage {
  role: string;
  content: string;
  tool_calls?: string[];
  tool_data?: ToolCallData;
  images?: RenderedImage[];
}

export interface ToolCallData {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface RenderedImage {
  path?: string;
  media_type: string;
  base64_data?: string;
  data?: string;
  label?: string;
  source?: {
    kind: "user_input" | "tool_result" | "other";
    tool_name?: string;
    role?: string;
  };
}

export interface RouteCheapnessEstimate {
  billing_kind?: "metered" | "subscription" | "included_quota" | "unknown";
  relative_label?: string;
  estimated_reference_cost_micros?: number;
}

export interface ModelRoute {
  provider: string;
  model: string;
  api_method?: string;
  available?: boolean;
  detail?: string;
  display_name?: string;
  context_window?: number;
  cheapness?: RouteCheapnessEstimate;
}

export interface ProviderConfigExtraField {
  key: string;
  label: string;
  placeholder?: string;
  default_value?: string;
}

export interface ProviderConfigOption {
  provider_id: string;
  kind: "api_key" | "oauth" | "device_code";
  label: string;
  detail?: string;
  setup_url?: string;
  input_label?: string;
  input_placeholder?: string;
  extra_fields?: ProviderConfigExtraField[];
}

export interface ProviderCatalogEntry {
  provider_key: string;
  auth_provider_id?: string;
  display_name: string;
  has_config_surface?: boolean;
  configured: boolean;
  status: "available" | "expired" | "not_configured" | "unknown";
  method_detail: string;
  route_count: number;
  is_current_provider?: boolean;
  options: ProviderConfigOption[];
}

export interface ProviderAuthPrompt {
  status: "pending";
  provider: string;
  auth_url: string;
  input_kind: "callback_url" | "auth_code" | "auth_code_or_callback_url" | "complete";
  pending_path: string;
  user_code?: string | null;
  expires_at_ms: number;
  resume_command: string;
}

export interface ProviderAuthSuccess {
  status: "authenticated";
  provider: string;
  account_label?: string | null;
  credentials_path?: string | null;
  email?: string | null;
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
  | SwarmStatusEvent
  | SwarmPlanEvent
  | SwarmPlanProposalEvent
  | ClearChatEvent
  | RewindChatEvent
  | ReasoningEffortChangedEvent
  | CompactResultEvent
  | MemoryFeatureChangedEvent;

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
  base64Data?: string;
  filePath?: string;
  thumbnailData?: string;
  label?: string;
}

export interface SwarmPlanPreviewItem {
  id: string;
  content: string;
  status: string;
  priority: string;
  assignedTo?: string;
  subsystem?: string;
  blockedBy?: string[];
  fileScope?: string[];
}

export interface SwarmPlanSummary {
  swarmId: string;
  version: number;
  itemCount: number;
  participantIds: string[];
  participantCount: number;
  reason?: string;
  readyCount: number;
  activeCount: number;
  blockedCount: number;
  completedCount: number;
  nextReadyIds: string[];
  itemsPreview: SwarmPlanPreviewItem[];
}

export interface SwarmPlanProposalSummary {
  swarmId: string;
  proposerSession: string;
  proposerName?: string;
  summary: string;
  proposalKey: string;
  itemCount: number;
  itemsPreview: SwarmPlanPreviewItem[];
}

export interface SessionInfo {
  sessionId: string;
  title: string;
  subtitle?: string;
  detail?: string;
  previewLines?: string[];
  detailLines?: string[];
  isActive: boolean;
  providerName?: string;
  providerModel?: string;
  model?: string;
  provider?: string;
  status?: string;
  workingDir?: string;
  swarmId?: string;
  swarmEnabled?: boolean;
  swarmPeerCount?: number;
  swarmRole?: "coordinator" | "agent";
  swarmPlan?: SwarmPlanSummary;
  swarmProposal?: SwarmPlanProposalSummary;
  liveProcessing?: boolean;
  liveToolName?: string;
  liveStatusDetail?: string;
  livePhase?: "thinking" | "tool" | "chunking" | "waiting" | "idle";
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

export interface QueuedDraft {
  id: string;
  content: string;
  images?: [string, string][];
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
  memoryEnabled: boolean;
  connectionType: string | null;
  statusDetail: string | null;
  queuedDrafts: QueuedDraft[];
  activeWorkspaceId: string | null;
  expandedWorkspaces: Set<string>;
}
