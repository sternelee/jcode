import type {
	ChatMessage,
	SessionInfo,
	SwarmMemberStatusSnapshot,
	SwarmPlanSummary,
	SwarmPlanProposalSummary,
	ToolExecution,
	QueuedDraft,
} from "@/types";

export type Action =
	| { type: "SET_CONNECTING"; sessionId?: string }
	| { type: "SET_CONNECTED"; sessionId?: string }
	| { type: "SET_DISCONNECTED"; sessionId?: string }
	| {
			type: "SET_ERROR";
			message: string;
			sessionId?: string;
			roleSessionId?: string;
			roleName?: string;
	  }
	| { type: "CLEAR_ERROR"; sessionId?: string }
	| { type: "SET_PHASE"; phase: string; sessionId?: string }
	| { type: "SET_SESSION_ID"; sessionId: string }
	| { type: "SET_SESSIONS"; sessions: SessionInfo[] }
	| {
			type: "ADD_USER_MESSAGE";
			content: string;
			images?: import("@/types").AttachedImage[];
			sessionId?: string;
	  }
	| {
			type: "ADD_ASSISTANT_MESSAGE";
			content: string;
			images?: import("@/types").AttachedImage[];
			sessionId?: string;
			roleSessionId?: string;
			roleName?: string;
	  }
	| { type: "START_ASSISTANT_MESSAGE"; sessionId?: string }
	| {
			type: "APPEND_TEXT";
			text: string;
			sessionId?: string;
			roleSessionId?: string;
			roleName?: string;
	  }
	| {
			type: "REPLACE_TEXT";
			text: string;
			sessionId?: string;
			roleSessionId?: string;
			roleName?: string;
	  }
	| {
			type: "TOOL_START";
			id: string;
			name: string;
			sessionId?: string;
			roleSessionId?: string;
	  }
	| {
			type: "TOOL_INPUT";
			id: string;
			delta: string;
			sessionId?: string;
			roleSessionId?: string;
	  }
	| {
			type: "TOOL_EXEC";
			id: string;
			name: string;
			sessionId?: string;
			roleSessionId?: string;
	  }
	| {
			type: "TOOL_DONE";
			id: string;
			output: string;
			error?: string;
			sessionId?: string;
			roleSessionId?: string;
	  }
	| {
			type: "SET_TOKEN_USAGE";
			input: number;
			output: number;
			cacheReadInput?: number;
			cacheCreationInput?: number;
			sessionId?: string;
			roleSessionId?: string;
	  }
	| { type: "DONE"; sessionId?: string; roleSessionId?: string }
	| { type: "INTERRUPTED"; sessionId?: string; roleSessionId?: string }
	| {
			type: "MODEL_CHANGED";
			model: string;
			providerName?: string;
			sessionId?: string;
	  }
	| { type: "MODELS_UPDATED"; models: string[]; sessionId?: string }
	| { type: "STDIN_REQUEST"; prompt: StdinPrompt; sessionId?: string }
	| { type: "STDIN_DONE"; sessionId?: string }
	| { type: "SET_WORKING_DIR"; dir: string | null }
	| { type: "QUEUE_DRAFT"; draft: QueuedDraft; sessionId?: string }
	| { type: "DEQUEUE_DRAFT"; draftId: string; sessionId?: string }
	| { type: "SET_PROCESSING"; value: boolean; sessionId?: string }
	| { type: "SET_ACTIVE_WORKSPACE"; workspaceId: string | null }
	| { type: "TOGGLE_WORKSPACE"; workspaceId: string }
	| { type: "ADD_SYSTEM_MESSAGE"; content: string; sessionId?: string }
	| { type: "CLEAR_CHAT"; sessionId?: string }
	| { type: "REWIND_CHAT"; messageIndex: number; sessionId?: string }
	| { type: "SET_REASONING_EFFORT"; effort: string | null; sessionId?: string }
	| { type: "SET_MEMORY_ENABLED"; enabled: boolean; sessionId?: string }
	| { type: "SET_CONNECTION_TYPE"; connection: string; sessionId?: string }
	| { type: "SET_STATUS_DETAIL"; detail: string; sessionId?: string }
	| { type: "LOAD_HISTORY"; messages: ChatMessage[]; sessionId?: string }
	| {
			type: "SET_AVAILABLE_MODELS";
			models: string[];
			routes?: import("@/types").ModelRoute[];
			providerName?: string;
			providerModel?: string;
			sessionId?: string;
	  }
	| {
			type: "SET_TOTAL_TOKENS";
			tokens: [number, number] | null;
			sessionId?: string;
	  }
	| { type: "APPLY_SWARM_STATUS"; members: SwarmMemberStatusSnapshot[] }
	| { type: "APPLY_SWARM_PLAN"; plan: SwarmPlanSummary }
	| { type: "APPLY_SWARM_PROPOSAL"; proposal: SwarmPlanProposalSummary }
	| {
			type: "SET_WORKSPACE_MODE";
			workspaceId: string;
			mode: "normal" | "swarm";
			initialMessages?: ChatMessage[];
	  }
	| { type: "CLEAR_WORKSPACE_MESSAGES"; workspaceId: string };

let messageCounter = 0;
function nextMsgId(): string {
	messageCounter += 1;
	return `msg-${messageCounter}`;
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

import type { SessionState, StdinPrompt } from "@/types";

export function initialSessionState(): SessionState {
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
		sessionData: {},
		workspaceModes: {},
	};
}

function swarmRoleLabel(role?: string): SessionInfo["swarmRole"] {
	return role === "coordinator"
		? "coordinator"
		: role === "agent"
			? "agent"
			: undefined;
}

function applySwarmStatusToSessions(
	sessions: SessionInfo[],
	members: SwarmMemberStatusSnapshot[],
): SessionInfo[] {
	if (members.length === 0) return sessions;
	const memberMap = new Map(
		members.map((member) => [member.session_id, member]),
	);
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
				: [
						"ready",
						"completed",
						"done",
						"failed",
						"stopped",
						"blocked",
					].includes(lowerStatus)
					? false
					: session.liveProcessing,
			livePhase:
				lowerStatus === "running" || lowerStatus === "running_stale"
					? session.liveToolName
						? "tool"
						: "thinking"
					: lowerStatus === "blocked"
						? "waiting"
						: ["ready", "completed", "done", "failed", "stopped"].includes(
								lowerStatus,
							)
							? "idle"
							: session.livePhase,
			subtitle: session.model
				? `${member.status} \u00b7 ${session.model}`
				: session.subtitle,
			detail: member.detail
				? session.detail?.includes(member.detail)
					? session.detail
					: session.detail
						? `${session.detail} \u00b7 ${member.detail}`
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
	const fallbackParticipants =
		!plan.participantIds.length && currentSessionId ? [currentSessionId] : [];
	const effectiveParticipantIds =
		plan.participantIds.length > 0 ? plan.participantIds : fallbackParticipants;
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
					swarmPeerCount: Math.max(
						plan.participantCount,
						session.swarmPeerCount || 0,
					),
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
	const targetIds = currentSessionId
		? new Set([currentSessionId])
		: new Set<string>();
	return sessions.map((session) =>
		targetIds.has(session.sessionId) ||
		session.swarmId === proposal.swarmId ||
		session.swarmRole === "coordinator"
			? {
					...session,
					swarmId: proposal.swarmId,
					swarmProposal: proposal,
				}
			: session,
	);
}

function getOrCreateSessionData(
	state: SessionState,
	sessionId: string,
): import("@/types").PerSessionData {
	if (state.sessionData[sessionId]) {
		return state.sessionData[sessionId];
	}
	return {
		sessionId,
		messages: [],
		isProcessing: false,
		stdinPrompt: null,
		error: null,
		providerName: null,
		providerModel: null,
		availableModels: [],
		availableModelRoutes: [],
		totalTokens: null,
		connectionPhase: null,
		reasoningEffort: null,
		memoryEnabled: true,
		statusDetail: null,
		queuedDrafts: [],
		streamingIndexByRole: {},
	};
}

function updateSessionData(
	state: SessionState,
	sessionId: string | undefined,
	updater: (
		data: import("@/types").PerSessionData,
	) => import("@/types").PerSessionData,
): SessionState {
	const sid = sessionId || state.sessionId;
	if (!sid) {
		return state;
	}
	const data = getOrCreateSessionData(state, sid);
	const updated = updater(data);
	return {
		...state,
		sessionData: { ...state.sessionData, [sid]: updated },
		...(state.sessionId === sid
			? {
					messages: updated.messages,
					isProcessing: updated.isProcessing,
					stdinPrompt: updated.stdinPrompt,
					error: updated.error,
					providerName: updated.providerName,
					providerModel: updated.providerModel,
					availableModels: updated.availableModels,
					availableModelRoutes: updated.availableModelRoutes,
					totalTokens: updated.totalTokens,
					connectionPhase: updated.connectionPhase,
					reasoningEffort: updated.reasoningEffort,
					memoryEnabled: updated.memoryEnabled,
					statusDetail: updated.statusDetail,
					queuedDrafts: updated.queuedDrafts,
				}
			: {}),
	};
}

function findStreamingMessageIndex(
	data: import("@/types").PerSessionData,
	roleSessionId?: string,
): number {
	const key = roleSessionId ?? "";
	const idx = data.streamingIndexByRole[key];
	if (idx !== undefined && idx >= 0 && idx < data.messages.length) {
		const m = data.messages[idx];
		if (
			m?.role === "assistant" &&
			m?.isStreaming &&
			m?.roleSessionId === roleSessionId
		) {
			return idx;
		}
	}
	for (let i = data.messages.length - 1; i >= Math.max(0, data.messages.length - 5); i--) {
		const m = data.messages[i];
		if (m?.role === "assistant" && m?.isStreaming) {
			if (!roleSessionId || m.roleSessionId === roleSessionId) {
				return i;
			}
		}
	}
	return -1;
}

export function sessionReducer(state: SessionState, action: Action): SessionState {
	switch (action.type) {
		case "SET_CONNECTING":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				isProcessing: true,
				connectionPhase: "initializing",
				error: null,
			}));
		case "SET_CONNECTED":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				connectionPhase: "connected",
				isProcessing: false,
				error: null,
			}));
		case "SET_DISCONNECTED":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				connectionPhase: "disconnected",
				error: "Session ended",
				isProcessing: false,
			}));
		case "SET_ERROR":
			return updateSessionData(state, action.sessionId, (data) => {
				const ms = [...data.messages];
				if (action.roleSessionId) {
					for (let i = ms.length - 1; i >= 0; i--) {
						const m = ms[i];
						if (
							m?.role === "assistant" &&
							m?.isStreaming &&
							m?.roleSessionId === action.roleSessionId
						) {
							ms[i] = { ...m, isStreaming: false };
							break;
						}
					}
				} else {
					const last = ms[ms.length - 1];
					if (last?.role === "assistant" && last?.isStreaming) {
						ms[ms.length - 1] = { ...last, isStreaming: false };
					}
				}
				ms.push({
					id: nextMsgId(),
					role: "system",
					content: action.roleName
						? `\u26a0\ufe0f ${action.roleName} error: ${action.message}`
						: `\u26a0\ufe0f Error: ${action.message}`,
					toolExecutions: [],
					isStreaming: false,
					roleSessionId: action.roleSessionId,
					roleName: action.roleName,
					timestamp: Date.now(),
				});
				const stillStreaming = ms.some(
					(m) => m.role === "assistant" && m.isStreaming,
				);
				return {
					...data,
					error: action.message,
					isProcessing: stillStreaming,
					messages: ms,
				};
			});
		case "CLEAR_ERROR":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				error: null,
			}));
		case "SET_PHASE":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				connectionPhase: action.phase,
			}));
		case "SET_SESSION_ID": {
			const newSessionId = action.sessionId;
			const newSessionData = state.sessionData[newSessionId];
			if (newSessionData) {
				return {
					...state,
					sessionId: newSessionId,
					connected: newSessionData.connectionPhase === "connected",
					connecting: newSessionData.connectionPhase === "connecting",
					messages: newSessionData.messages,
					isProcessing: newSessionData.isProcessing,
					stdinPrompt: newSessionData.stdinPrompt,
					error: newSessionData.error,
					providerName: newSessionData.providerName,
					providerModel: newSessionData.providerModel,
					availableModels: newSessionData.availableModels,
					availableModelRoutes: newSessionData.availableModelRoutes,
					totalTokens: newSessionData.totalTokens,
					connectionPhase: newSessionData.connectionPhase,
					reasoningEffort: newSessionData.reasoningEffort,
					memoryEnabled: newSessionData.memoryEnabled,
					statusDetail: newSessionData.statusDetail,
					queuedDrafts: newSessionData.queuedDrafts,
				};
			}
			return { ...state, sessionId: newSessionId };
		}
		case "SET_SESSIONS":
			return { ...state, sessions: action.sessions };
		case "SET_WORKING_DIR":
			return {
				...state,
				workingDir: action.dir,
				activeWorkspaceId: action.dir ?? "default",
			};
		case "QUEUE_DRAFT":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				queuedDrafts: [...data.queuedDrafts, action.draft],
			}));
		case "DEQUEUE_DRAFT":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				queuedDrafts: data.queuedDrafts.filter(
					(draft) => draft.id !== action.draftId,
				),
			}));
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
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				messages: [...data.messages, um],
				isProcessing: true,
			}));
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
				roleSessionId: action.roleSessionId,
				roleName: action.roleName,
			};
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				messages: [...data.messages, am],
			}));
		}
		case "APPEND_TEXT": {
			return updateSessionData(state, action.sessionId, (data) => {
				const ms = [...data.messages];
				const targetIdx = findStreamingMessageIndex(data, action.roleSessionId);
				if (targetIdx !== -1) {
					ms[targetIdx] = { ...ms[targetIdx], content: ms[targetIdx].content + action.text };
				} else {
					const newMsg: ChatMessage = {
						id: nextMsgId(),
						role: "assistant",
						content: action.text,
						toolExecutions: [],
						isStreaming: true,
						roleSessionId: action.roleSessionId,
						roleName: action.roleName,
						timestamp: Date.now(),
					};
					ms.push(newMsg);
					data.streamingIndexByRole[action.roleSessionId ?? ""] = ms.length - 1;
				}
				return { ...data, messages: ms };
			});
		}
		case "REPLACE_TEXT": {
			return updateSessionData(state, action.sessionId, (data) => {
				const ms = [...data.messages];
				const targetIdx = findStreamingMessageIndex(data, action.roleSessionId);
				if (targetIdx !== -1) {
					ms[targetIdx] = { ...ms[targetIdx], content: action.text };
				}
				return { ...data, messages: ms };
			});
		}
		case "TOOL_START": {
			return updateSessionData(state, action.sessionId, (data) => {
				const ms = [...data.messages];
				const targetIdx = findStreamingMessageIndex(data, action.roleSessionId);
				if (targetIdx !== -1) {
					const l = ms[targetIdx];
					const t: ToolExecution = {
						id: action.id,
						name: action.name,
						status: "starting",
						input: "",
					};
					ms[targetIdx] = { ...l, toolExecutions: [...l.toolExecutions, t] };
				}
				return { ...data, messages: ms };
			});
		}
		case "TOOL_INPUT": {
			return updateSessionData(state, action.sessionId, (data) => {
				const ms = [...data.messages];
				const targetIdx = findStreamingMessageIndex(data, action.roleSessionId);
				if (targetIdx !== -1) {
					const l = ms[targetIdx];
					const tls = [...l.toolExecutions];
					const c = tls[tls.length - 1];
					if (c && c.status !== "done" && c.status !== "error")
						tls[tls.length - 1] = {
							...c,
							input: c.input + action.delta,
							status: "collecting_input",
						};
					ms[targetIdx] = { ...l, toolExecutions: tls };
				}
				return { ...data, messages: ms };
			});
		}
		case "TOOL_EXEC": {
			return updateSessionData(state, action.sessionId, (data) => {
				const ms = [...data.messages];
				const targetIdx = findStreamingMessageIndex(data, action.roleSessionId);
				if (targetIdx !== -1) {
					const l = ms[targetIdx];
					const tls = [...l.toolExecutions];
					const i = tls.findIndex((t) => t.id === action.id);
					if (i !== -1)
						tls[i] = { ...tls[i], status: "executing", name: action.name };
					ms[targetIdx] = { ...l, toolExecutions: tls };
				}
				return { ...data, messages: ms };
			});
		}
		case "TOOL_DONE": {
			return updateSessionData(state, action.sessionId, (data) => {
				const ms = [...data.messages];
				const targetIdx = findStreamingMessageIndex(data, action.roleSessionId);
				if (targetIdx !== -1) {
					const l = ms[targetIdx];
					const tls = [...l.toolExecutions];
					const i = tls.findIndex((t) => t.id === action.id);
					if (i !== -1)
						tls[i] = {
							...tls[i],
							status: action.error ? "error" : "done",
							output: action.output,
							error: action.error,
						};
					ms[targetIdx] = { ...l, toolExecutions: tls };
				}
				return { ...data, messages: ms };
			});
		}
		case "SET_TOKEN_USAGE": {
			return updateSessionData(state, action.sessionId, (data) => {
				const ms = [...data.messages];
				const targetIdx = findStreamingMessageIndex(data, action.roleSessionId);
				if (targetIdx !== -1) {
					ms[targetIdx] = {
						...ms[targetIdx],
						tokenUsage: {
							input: action.input,
							output: action.output,
							cacheReadInput: action.cacheReadInput,
							cacheCreationInput: action.cacheCreationInput,
						},
					};
				}
				return {
					...data,
					totalTokens: [action.input, action.output],
					messages: ms,
				};
			});
		}
		case "DONE": {
			return updateSessionData(state, action.sessionId, (data) => {
				const ms = [...data.messages];
				const targetIdx = findStreamingMessageIndex(data, action.roleSessionId);
				if (targetIdx !== -1) {
					ms[targetIdx] = { ...ms[targetIdx], isStreaming: false };
				}
				const stillStreaming = ms.some(
					(m) => m.role === "assistant" && m.isStreaming,
				);
				return { ...data, isProcessing: stillStreaming, messages: ms };
			});
		}
		case "INTERRUPTED": {
			return updateSessionData(state, action.sessionId, (data) => {
				const ms = [...data.messages];
				const targetIdx = findStreamingMessageIndex(data, action.roleSessionId);
				if (targetIdx !== -1) {
					ms[targetIdx] = { ...ms[targetIdx], isStreaming: false };
				}
				const stillStreaming = ms.some(
					(m) => m.role === "assistant" && m.isStreaming,
				);
				return { ...data, isProcessing: stillStreaming, messages: ms };
			});
		}
		case "MODEL_CHANGED":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				providerModel: action.model,
				providerName: action.providerName ?? data.providerName,
			}));
		case "MODELS_UPDATED":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				availableModels: action.models,
			}));
		case "STDIN_REQUEST":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				stdinPrompt: action.prompt,
			}));
		case "STDIN_DONE":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				stdinPrompt: null,
			}));
		case "SET_PROCESSING":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				isProcessing: action.value,
			}));
		case "ADD_SYSTEM_MESSAGE": {
			const sm: ChatMessage = {
				id: nextMsgId(),
				role: "system",
				content: action.content,
				toolExecutions: [],
				isStreaming: false,
				timestamp: Date.now(),
			};
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				messages: [...data.messages, sm],
			}));
		}
		case "CLEAR_CHAT":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				messages: [],
			}));
		case "REWIND_CHAT": {
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				messages: truncateMessagesToVisibleConversationCount(
					data.messages,
					action.messageIndex,
				),
			}));
		}
		case "SET_REASONING_EFFORT":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				reasoningEffort: action.effort,
			}));
		case "SET_MEMORY_ENABLED":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				memoryEnabled: action.enabled,
			}));
		case "SET_CONNECTION_TYPE":
			return { ...state, connectionType: action.connection };
		case "SET_STATUS_DETAIL":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				statusDetail: action.detail,
			}));
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
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				messages: action.messages,
				isProcessing: false,
			}));
		case "SET_AVAILABLE_MODELS":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				availableModels: action.models,
				availableModelRoutes: action.routes ?? data.availableModelRoutes,
				providerName: action.providerName ?? data.providerName,
				providerModel: action.providerModel ?? data.providerModel,
			}));
		case "SET_TOTAL_TOKENS":
			return updateSessionData(state, action.sessionId, (data) => ({
				...data,
				totalTokens: action.tokens,
			}));
		case "APPLY_SWARM_STATUS": {
			const sessions = applySwarmStatusToSessions(
				state.sessions,
				action.members,
			);
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
				sessions: applySwarmPlanToSessions(
					state.sessions,
					action.plan,
					state.sessionId,
				).map((session) =>
					session.swarmId === action.plan.swarmId
						? { ...session, swarmProposal: undefined }
						: session,
				),
			};
		case "APPLY_SWARM_PROPOSAL":
			return {
				...state,
				sessions: applySwarmProposalToSessions(
					state.sessions,
					action.proposal,
					state.sessionId,
				),
			};
		case "SET_WORKSPACE_MODE": {
			const virtualSessionId = `workspace:${action.workspaceId}`;
			const newModes = {
				...state.workspaceModes,
				[action.workspaceId]: action.mode,
			};

			if (action.mode === "normal") {
				const { [virtualSessionId]: _removed, ...restSessionData } =
					state.sessionData;
				return {
					...state,
					workspaceModes: newModes,
					sessionData: restSessionData,
				};
			}

			if (
				action.mode === "swarm" &&
				action.initialMessages &&
				action.initialMessages.length > 0
			) {
				const existing = getOrCreateSessionData(state, virtualSessionId);
				const merged = new Map<string, ChatMessage>();
				for (const message of [...existing.messages, ...action.initialMessages]) {
					const signature = [
						message.role,
						message.roleSessionId || "",
						message.roleName || "",
						String(message.timestamp ?? ""),
						message.content,
					].join("::");
					merged.set(signature, message);
				}
				const sorted = [...merged.values()].sort(
					(a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
				);
				return {
					...state,
					workspaceModes: newModes,
					sessionData: {
						...state.sessionData,
						[virtualSessionId]: { ...existing, messages: sorted },
					},
				};
			}

			return { ...state, workspaceModes: newModes };
		}
		case "CLEAR_WORKSPACE_MESSAGES": {
			const virtualSessionId = `workspace:${action.workspaceId}`;
			const { [virtualSessionId]: _removed, ...restSessionData } =
				state.sessionData;
			return { ...state, sessionData: restSessionData };
		}
		default:
			return state;
	}
}
