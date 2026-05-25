import type { ServerEvent } from "@/types";
import { rawServerEventToDesktopEvents } from "@/lib/serverEventAdapter";
import type { Action } from "./sessionReducer";

export function processEvent(
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
