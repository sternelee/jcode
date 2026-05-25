import { useReducer, useEffect, useCallback, useRef } from "react";
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
			images?: AttachedImage[];
			sessionId?: string;
	  }
	| {
			type: "ADD_ASSISTANT_MESSAGE";
			content: string;
			images?: AttachedImage[];
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
				? `${member.status} · ${session.model}`
				: session.subtitle,
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
		// Fallback to global state if no session ID
		return state;
	}
	const data = getOrCreateSessionData(state, sid);
	const updated = updater(data);
	return {
		...state,
		sessionData: { ...state.sessionData, [sid]: updated },
		// Sync active session data to global state for backward compatibility
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
	if (roleSessionId !== undefined && roleSessionId in data.streamingIndexByRole) {
		const idx = data.streamingIndexByRole[roleSessionId];
		if (idx >= 0 && idx < data.messages.length) {
			const m = data.messages[idx];
			if (
				m?.role === "assistant" &&
				m?.isStreaming &&
				m?.roleSessionId === roleSessionId
			) {
				return idx;
			}
		}
	}
	// Fallback: scan only the last 5 messages (always fast)
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

function sessionReducer(state: SessionState, action: Action): SessionState {
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
				// Mark any streaming assistant message as done to prevent future
				// append-text from continuing the aborted message
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
				// Add error as a visible system message in the chat stream
				ms.push({
					id: nextMsgId(),
					role: "system",
					content: action.roleName
						? `⚠️ ${action.roleName} error: ${action.message}`
						: `⚠️ Error: ${action.message}`,
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
				// 退出 swarm 模式：清除虚拟 session
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
				// 进入 swarm 模式：合并已存在的线程消息与持久化历史，避免重新进入线程时丢失实时镜像内容
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

	const stateRef = useRef(state);
	stateRef.current = state;

	/**
	 * When a session is part of a swarm workspace, mirror stream events
	 * (and user messages) into the virtual workspace thread so the group
	 * chat view stays consistent with individual agent DM sessions.
	 *
	 * This is the *single* source-of-truth for workspace mirroring.
	 * performSend and queueMessage also route through this helper.
	 */
	const mirrorToWorkspaceIfSwarm = useCallback(
		(
			sessionId: string,
			mirror: (virtualSessionId: string) => void,
		) => {
			const currentState = stateRef.current;
			const session = currentState.sessions.find(
				(s) => s.sessionId === sessionId,
			);
			const workspaceId = session?.workingDir || "default";
			if (currentState.workspaceModes[workspaceId] === "swarm") {
				const virtualSessionId = `workspace:${workspaceId}`;
				mirror(virtualSessionId);
			}
		},
		[],
	);

	useEffect(() => {
		const unlisten = listen<Record<string, unknown>>(
			"server-event",
			(event) => {
				const payload = event.payload as unknown as ServerEvent & {
					session_id?: string;
				};
				const sessionId = payload.session_id;
				processEvent(payload, dispatch, sessionId);

				// Mirror stream events into the workspace virtual thread
				if (sessionId) {
					mirrorToWorkspaceIfSwarm(sessionId, (virtualSessionId) => {
						const session = stateRef.current.sessions.find(
							(s) => s.sessionId === sessionId,
						);
						processEvent(
							payload,
							dispatch,
							virtualSessionId,
							true,
							sessionId,
							session?.roleName,
						);
					});
				}
			},
		);
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [mirrorToWorkspaceIfSwarm]);

	const performSend = useCallback(
		async (
			content: string,
			images?: [string, string][],
			sessionId?: string,
		) => {
			if (!content.trim() && (!images || images.length === 0)) return;
			const imageAttachments = images?.map(([m, d], i) => ({
				id: `img-${Date.now()}-${i}`,
				mediaType: m,
				base64Data: d,
			}));
			dispatch({
				type: "ADD_USER_MESSAGE",
				content: content.trim() || "(image)",
				images: imageAttachments,
				sessionId,
			});
			// In swarm mode, also add the user message to the workspace thread
			if (sessionId) {
				mirrorToWorkspaceIfSwarm(sessionId, (virtualSessionId) => {
					dispatch({
						type: "ADD_USER_MESSAGE",
						content: content.trim() || "(image)",
						images: imageAttachments,
						sessionId: virtualSessionId,
					});
				});
			}
			try {
				// eslint-disable-next-line no-console
				console.log("[performSend] invoking send_message", {
					sessionId,
					content: content.slice(0, 60),
				});
				await invoke("send_message", {
					content,
					images: images || null,
					systemReminder: null,
					sessionId,
				});
			} catch (e) {
				// eslint-disable-next-line no-console
				console.error("[performSend] invoke error:", e);
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const connect = useCallback(
		async (
			workingDir: string | null,
			model?: string,
			memoryEnabled?: boolean,
			roleName?: string,
			profileId?: string,
		) => {
			dispatch({ type: "SET_CONNECTING" });
			try {
				return await invoke<string>("begin_session", {
					workingDir,
					model: model || null,
					memoryEnabled: memoryEnabled ?? true,
					roleName: roleName || null,
					profileId: profileId || null,
				});
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return null;
			}
		},
		[],
	);

	const createRoleSession = useCallback(
		async (
			workingDir: string | null,
			roleName: string,
			model?: string,
			memoryEnabled?: boolean,
			profileId?: string,
		) => {
			dispatch({ type: "SET_CONNECTING" });
			try {
				return await invoke<string>("begin_session", {
					workingDir,
					model: model || null,
					memoryEnabled: memoryEnabled ?? true,
					roleName,
					profileId: profileId || null,
				});
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return null;
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

	const switchSession = useCallback((sessionId: string) => {
		dispatch({ type: "SET_SESSION_ID", sessionId });
	}, []);

	const sendMessage = useCallback(
		async (
			content: string,
			images?: [string, string][],
			sessionId?: string,
		) => {
			await performSend(content, images, sessionId);
		},
		[performSend],
	);

	const queueMessage = useCallback(
		(content: string, images?: [string, string][], sessionId?: string) => {
			if (!content.trim() && (!images || images.length === 0)) return;
			const draft = createQueuedDraft(content, images);
			dispatch({ type: "QUEUE_DRAFT", draft, sessionId });
			dispatch({
				type: "ADD_SYSTEM_MESSAGE",
				content: `📝 Queued prompt (${state.queuedDrafts.length + 1} pending)`,
				sessionId,
			});
			// In swarm mode, also mirror queued draft to workspace thread
			if (sessionId) {
				mirrorToWorkspaceIfSwarm(sessionId, (virtualSessionId) => {
					dispatch({ type: "QUEUE_DRAFT", draft, sessionId: virtualSessionId });
					dispatch({
						type: "ADD_SYSTEM_MESSAGE",
						content: `📝 Queued prompt (${state.queuedDrafts.length + 1} pending)`,
						sessionId: virtualSessionId,
					});
				});
			}
		},
		[state.queuedDrafts.length],
	);

	const sendSoftInterrupt = useCallback(
		async (content: string, sessionId?: string) => {
			try {
				await invoke("send_soft_interrupt", {
					sessionId,
					content,
					urgent: false,
				});
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const exportMemories = useCallback(async (path: string) => {
		try {
			await invoke("export_memories", { path });
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
		}
	}, []);

	const importMemories = useCallback(async (path: string) => {
		try {
			return (await invoke("import_memories", { path })) as {
				project_count: number;
				global_count: number;
			};
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const cancel = useCallback(async (sessionId?: string) => {
		try {
			await invoke("cancel", { sessionId });
			dispatch({ type: "INTERRUPTED", sessionId });
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e), sessionId });
		}
	}, []);

	const setModel = useCallback(
		async (model: string, profileId?: string, sessionId?: string) => {
			try {
				await invoke("set_model", {
					model,
					profileId: profileId || null,
					sessionId,
				});
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const setMemoryEnabled = useCallback(
		async (enabled: boolean, sessionId?: string) => {
			try {
				await invoke("set_memory_enabled", { enabled, sessionId });
				dispatch({ type: "SET_MEMORY_ENABLED", enabled, sessionId });
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

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
						role_name?: string;
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
				roleName: d.role_name,
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
							participantCount:
								d.swarm_plan.participant_count ||
								d.swarm_plan.participant_ids?.length ||
								0,
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
							itemsPreview: (d.swarm_proposal.items_preview || []).map(
								(item) => ({
									id: item.id,
									content: item.content,
									status: item.status,
									priority: item.priority,
									assignedTo: item.assigned_to,
									subsystem: item.subsystem,
									blockedBy: item.blocked_by,
									fileScope: item.file_scope,
								}),
							),
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

	const loadWorkspaceThreadHistory = useCallback(
		async (workingDir: string | null) => {
			try {
				const data = await invoke<
					Array<{
						id: string;
						role: "user" | "assistant" | "system" | string;
						content: string;
						tool_executions?: ToolExecution[];
						is_streaming?: boolean;
						images?: Array<{
							media_type: string;
							data?: string;
							base64_data?: string;
							label?: string;
							path?: string;
						}>;
						timestamp?: number | null;
						role_name?: string | null;
						role_session_id?: string | null;
					}>
				>("get_workspace_thread_history", { workingDir });
				return data.map((message, index) => ({
					id: message.id || `workspace-history-${index}`,
					role:
						message.role === "user" ||
						message.role === "assistant" ||
						message.role === "system"
							? message.role
							: "system",
					content: message.content,
					toolExecutions: message.tool_executions || [],
					isStreaming: message.is_streaming ?? false,
					images: message.images?.map((image, imageIndex) => ({
						id: `${message.id}-img-${imageIndex}`,
						mediaType: image.media_type,
						base64Data: image.base64_data || image.data,
						filePath: image.path,
						label: image.label,
					})),
					timestamp: message.timestamp ?? undefined,
					roleName: message.role_name ?? undefined,
					roleSessionId: message.role_session_id ?? undefined,
				} satisfies ChatMessage));
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return [] as ChatMessage[];
			}
		},
		[],
	);

	const sendStdinResponse = useCallback(
		async (requestId: string, input: string, sessionId?: string) => {
			dispatch({
				type: "ADD_SYSTEM_MESSAGE",
				content: "⌨️ Sending interactive input",
				sessionId,
			});
			try {
				await invoke("send_stdin_response", { requestId, input, sessionId });
				dispatch({ type: "STDIN_DONE", sessionId });
				dispatch({
					type: "ADD_SYSTEM_MESSAGE",
					content: "⌨️ Interactive input sent",
					sessionId,
				});
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const setWorkingDir = useCallback((dir: string | null) => {
		dispatch({ type: "SET_WORKING_DIR", dir });
	}, []);

	const deleteSession = useCallback(
		async (sessionId: string) => {
			try {
				await invoke("delete_session", { sessionId });
				await listSessions();
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				throw e;
			}
		},
		[listSessions],
	);

	const renameSession = useCallback(
		async (sessionId: string, title: string) => {
			try {
				await invoke("rename_session", { sessionId, title });
				await listSessions();
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				throw e;
			}
		},
		[listSessions],
	);

	const deleteWorkspaceSessions = useCallback(
		async (workingDir: string | null) => {
			try {
				await invoke("delete_workspace_sessions", { workingDir });
				await listSessions();
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				throw e;
			}
		},
		[listSessions],
	);

	const clearChat = useCallback(async (sessionId?: string) => {
		try {
			await invoke("clear_chat", { sessionId });
			dispatch({ type: "CLEAR_CHAT", sessionId });
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e), sessionId });
		}
	}, []);

	const rewindChat = useCallback(
		async (messageIndex: number, sessionId?: string) => {
			try {
				await invoke("rewind_chat", { messageIndex, sessionId });
				dispatch({ type: "REWIND_CHAT", messageIndex, sessionId });
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const setReasoningEffort = useCallback(
		async (effort: string, sessionId?: string) => {
			try {
				await invoke("set_reasoning_effort", { effort, sessionId });
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const compactContext = useCallback(async (sessionId?: string) => {
		try {
			await invoke("compact_context", { sessionId });
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e), sessionId });
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

		dispatch({
			type: "DEQUEUE_DRAFT",
			draftId: nextDraft.id,
			sessionId: state.sessionId || undefined,
		});
		dispatch({
			type: "ADD_SYSTEM_MESSAGE",
			content: `▶ Sending queued prompt (${state.queuedDrafts.length - 1} remaining)`,
			sessionId: state.sessionId || undefined,
		});
		void performSend(
			nextDraft.content,
			nextDraft.images,
			state.sessionId || undefined,
		);
	}, [
		state.isProcessing,
		state.connected,
		state.stdinPrompt,
		state.queuedDrafts,
		performSend,
		state.sessionId,
	]);

	const setWorkspaceMode = useCallback(
		(
			workspaceId: string,
			mode: "normal" | "swarm",
			initialMessages?: ChatMessage[],
		) => {
			dispatch({
				type: "SET_WORKSPACE_MODE",
				workspaceId,
				mode,
				initialMessages,
			});
		},
		[],
	);

	const addWorkspaceMessage = useCallback(
		(_workspaceId: string, _message: ChatMessage) => {
			// 已废弃：消息通过 processEvent 镜像到虚拟 session
		},
		[],
	);

	const clearWorkspaceMessages = useCallback((workspaceId: string) => {
		dispatch({ type: "CLEAR_WORKSPACE_MESSAGES", workspaceId });
	}, []);

	const setError = useCallback((message: string, sessionId?: string) => {
		dispatch({ type: "SET_ERROR", message, sessionId });
	}, []);

	const listBackgroundTasks = useCallback(async () => {
		try {
			return (
				(await invoke<import("@/types").BackgroundTask[]>(
					"list_background_tasks",
				)) || []
			);
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return [];
		}
	}, []);

	const cancelBackgroundTask = useCallback(async (taskId: string) => {
		try {
			return await invoke<boolean>("cancel_background_task", { taskId });
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return false;
		}
	}, []);

	const runAuthDoctor = useCallback(async () => {
		try {
			return await invoke<import("@/types").AuthDoctorReport>(
				"run_auth_doctor",
			);
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const runAuthTest = useCallback(async (providerId?: string) => {
		try {
			return await invoke<import("@/types").AuthTestResult>("run_auth_test", {
				providerId: providerId || null,
			});
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const getPermissionRequests = useCallback(async () => {
		try {
			const result = await invoke<{
				requests: import("@/types").PermissionRequest[];
			}>("get_permission_requests");
			return result.requests || [];
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return [];
		}
	}, []);

	const respondToPermission = useCallback(
		async (requestId: string, approved: boolean, message?: string) => {
			try {
				await invoke("respond_to_permission", {
					requestId,
					approved,
					message: message || null,
				});
				return true;
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return false;
			}
		},
		[],
	);

	const triggerAmbient = useCallback(async () => {
		try {
			await invoke("trigger_ambient");
			return true;
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return false;
		}
	}, []);

	const stopAmbient = useCallback(async () => {
		try {
			await invoke("stop_ambient");
			return true;
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return false;
		}
	}, []);

	const addProviderProfile = useCallback(
		async (params: {
			name: string;
			base_url: string;
			model: string;
			api_key?: string;
			auth?: string;
		}) => {
			try {
				return await invoke<import("@/types").ProviderSetupReport>(
					"add_provider_profile",
					params,
				);
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return null;
			}
		},
		[],
	);

	const sendTranscript = useCallback(
		async (text: string, mode: import("@/types").TranscriptMode = "send") => {
			try {
				await invoke("send_transcript", { text, mode });
				return true;
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return false;
			}
		},
		[],
	);

	const getBrowserStatus = useCallback(async () => {
		try {
			return await invoke<import("@/types").BrowserStatus>(
				"get_browser_status",
			);
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const setupBrowser = useCallback(async () => {
		try {
			return await invoke<string>("setup_browser");
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const runDictation = useCallback(async () => {
		try {
			return await invoke<{
				text: string;
				mode: import("@/types").TranscriptMode;
			}>("run_dictation");
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);
	const saveSessionState = useCallback(
		async (sessionId: string, workingDir: string | null) => {
			try {
				await invoke("save_session_state", { sessionId, workingDir });
			} catch {
				// ignore
			}
		},
		[],
	);

	const getLastSessionState = useCallback(async () => {
		try {
			return await invoke<{
				session_id: string;
				working_dir: string | null;
			} | null>("get_last_session_state");
		} catch {
			return null;
		}
	}, []);

	const clearSessionState = useCallback(async () => {
		try {
			await invoke("clear_session_state");
		} catch {
			// ignore
		}
	}, []);

	const gitStatus = useCallback(
		async (workingDir?: string | null) => {
			try {
				return await invoke<string>("git_status", { workingDir: workingDir ?? null });
			} catch (e) {
				return String(e);
			}
		},
		[],
	);

	return {
		state,
		connect,
		createRoleSession,
		resumeSession,
		switchSession,
		sendMessage,
		queueMessage,
		cancel,
		sendSoftInterrupt,
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
		renameSession,
		setActiveWorkspace,
		toggleWorkspace,
		setWorkspaceMode,
		loadWorkspaceThreadHistory,
		addWorkspaceMessage,
		clearWorkspaceMessages,
		exportMemories,
		importMemories,
		listBackgroundTasks,
		cancelBackgroundTask,
		runAuthDoctor,
		runAuthTest,
		getPermissionRequests,
		respondToPermission,
		triggerAmbient,
		stopAmbient,
		addProviderProfile,
		sendTranscript,
		getBrowserStatus,
		setupBrowser,
		runDictation,
		saveSessionState,
		getLastSessionState,
		clearSessionState,
		gitStatus,
		setError,
	};
}

function processEvent(
	event: ServerEvent,
	dispatch: React.Dispatch<Action>,
	sessionId?: string,
	skipSessionControl?: boolean,
	roleSessionId?: string,
	roleName?: string,
) {
	for (const desktopEvent of rawServerEventToDesktopEvents(event)) {
		const sid = sessionId;
		switch (desktopEvent.type) {
			case "append-text":
				dispatch({
					type: "APPEND_TEXT",
					text: desktopEvent.text,
					sessionId: sid,
					roleSessionId,
					roleName,
				});
				break;
			case "replace-text":
				dispatch({
					type: "REPLACE_TEXT",
					text: desktopEvent.text,
					sessionId: sid,
					roleSessionId,
					roleName,
				});
				break;
			case "tool-start":
				dispatch({
					type: "TOOL_START",
					id: desktopEvent.id,
					name: desktopEvent.name,
					sessionId: sid,
					roleSessionId,
				});
				break;
			case "tool-input":
				dispatch({
					type: "TOOL_INPUT",
					id: "",
					delta: desktopEvent.delta,
					sessionId: sid,
					roleSessionId,
				});
				break;
			case "tool-exec":
				dispatch({
					type: "TOOL_EXEC",
					id: desktopEvent.id,
					name: desktopEvent.name,
					sessionId: sid,
					roleSessionId,
				});
				break;
			case "tool-done":
				dispatch({
					type: "TOOL_DONE",
					id: desktopEvent.id,
					output: desktopEvent.output,
					error: desktopEvent.error,
					sessionId: sid,
					roleSessionId,
				});
				break;
			case "assistant-message":
				dispatch({
					type: "ADD_ASSISTANT_MESSAGE",
					content: desktopEvent.content,
					images: desktopEvent.images,
					sessionId: sid,
					roleSessionId,
					roleName,
				});
				break;
			case "token-usage":
				dispatch({
					type: "SET_TOKEN_USAGE",
					input: desktopEvent.input,
					output: desktopEvent.output,
					cacheReadInput: desktopEvent.cacheReadInput,
					cacheCreationInput: desktopEvent.cacheCreationInput,
					sessionId: sid,
					roleSessionId,
				});
				break;
			case "done":
				dispatch({ type: "DONE", sessionId: sid, roleSessionId });
				break;
			case "error":
				dispatch({
					type: "SET_ERROR",
					message: desktopEvent.message,
					sessionId: sid,
					roleSessionId,
					roleName,
				});
				break;
			case "session-id":
				if (!skipSessionControl) {
					dispatch({
						type: "SET_SESSION_ID",
						sessionId: desktopEvent.sessionId,
					});
				}
				break;
			case "interrupted":
				dispatch({ type: "INTERRUPTED", sessionId: sid, roleSessionId });
				break;
			case "connection-phase":
				if (!skipSessionControl) {
					dispatch({
						type: "SET_PHASE",
						phase: desktopEvent.phase,
						sessionId: sid,
					});
					if (desktopEvent.phase === "connected") {
						dispatch({ type: "SET_CONNECTED", sessionId: sid });
					}
				}
				break;
			case "model-changed":
				dispatch({
					type: "MODEL_CHANGED",
					model: desktopEvent.model,
					providerName: desktopEvent.providerName,
					sessionId: sid,
				});
				break;
			case "available-models":
				dispatch({
					type: "SET_AVAILABLE_MODELS",
					models: desktopEvent.models,
					routes: desktopEvent.routes,
					providerName: desktopEvent.providerName,
					providerModel: desktopEvent.providerModel,
					sessionId: sid,
				});
				break;
			case "stdin-request":
				dispatch({
					type: "STDIN_REQUEST",
					prompt: desktopEvent.prompt,
					sessionId: sid,
				});
				break;
			case "system-message":
				dispatch({
					type: "ADD_SYSTEM_MESSAGE",
					content: desktopEvent.content,
					sessionId: sid,
				});
				break;
			case "clear-chat":
				dispatch({ type: "CLEAR_CHAT", sessionId: sid });
				break;
			case "rewind-chat":
				dispatch({
					type: "REWIND_CHAT",
					messageIndex: desktopEvent.messageIndex,
					sessionId: sid,
				});
				if (desktopEvent.notice) {
					dispatch({
						type: "ADD_SYSTEM_MESSAGE",
						content: desktopEvent.notice,
						sessionId: sid,
					});
				}
				break;
			case "reasoning-effort":
				dispatch({
					type: "SET_REASONING_EFFORT",
					effort: desktopEvent.effort,
					sessionId: sid,
				});
				if (desktopEvent.notice) {
					dispatch({
						type: "ADD_SYSTEM_MESSAGE",
						content: desktopEvent.notice,
						sessionId: sid,
					});
				}
				break;
			case "memory-feature":
				dispatch({
					type: "SET_MEMORY_ENABLED",
					enabled: desktopEvent.enabled,
					sessionId: sid,
				});
				if (desktopEvent.notice) {
					dispatch({
						type: "ADD_SYSTEM_MESSAGE",
						content: desktopEvent.notice,
						sessionId: sid,
					});
				}
				break;
			case "connection-type":
				dispatch({
					type: "SET_CONNECTION_TYPE",
					connection: desktopEvent.connection,
					sessionId: sid,
				});
				if (desktopEvent.notice) {
					dispatch({
						type: "ADD_SYSTEM_MESSAGE",
						content: desktopEvent.notice,
						sessionId: sid,
					});
				}
				break;
			case "status-detail":
				dispatch({
					type: "SET_STATUS_DETAIL",
					detail: desktopEvent.detail,
					sessionId: sid,
				});
				if (desktopEvent.notice) {
					dispatch({
						type: "ADD_SYSTEM_MESSAGE",
						content: desktopEvent.notice,
						sessionId: sid,
					});
				}
				break;
			case "total-tokens":
				dispatch({
					type: "SET_TOTAL_TOKENS",
					tokens: desktopEvent.tokens,
					sessionId: sid,
				});
				break;
			case "history-loaded":
				dispatch({
					type: "LOAD_HISTORY",
					messages: desktopEvent.messages,
					sessionId: sid,
				});
				break;
			case "swarm-status":
				dispatch({ type: "APPLY_SWARM_STATUS", members: desktopEvent.members });
				break;
			case "swarm-plan":
				dispatch({ type: "APPLY_SWARM_PLAN", plan: desktopEvent.plan });
				break;
			case "swarm-plan-proposal":
				dispatch({
					type: "APPLY_SWARM_PROPOSAL",
					proposal: desktopEvent.proposal,
				});
				break;
			default:
				break;
		}
	}
}
