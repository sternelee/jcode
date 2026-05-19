import type {
	AttachedImage,
	ChatMessage,
	HistoryMessage,
	RenderedImage,
	ServerEvent,
	StdinPrompt,
	SwarmPlanProposalSummary,
	SwarmPlanSummary,
} from "@/types";

export type DesktopSemanticEvent =
	| { type: "append-text"; text: string }
	| { type: "replace-text"; text: string }
	| { type: "tool-start"; id: string; name: string }
	| { type: "tool-input"; delta: string }
	| { type: "tool-exec"; id: string; name: string }
	| { type: "tool-done"; id: string; output: string; error?: string }
	| { type: "assistant-message"; content: string; images?: AttachedImage[] }
	| {
			type: "token-usage";
			input: number;
			output: number;
			cacheReadInput?: number;
			cacheCreationInput?: number;
	  }
	| { type: "done" }
	| { type: "error"; message: string }
	| { type: "session-id"; sessionId: string }
	| { type: "interrupted" }
	| { type: "connection-phase"; phase: string }
	| { type: "model-changed"; model: string; providerName?: string }
	| {
			type: "available-models";
			models: string[];
			routes?: import("@/types").ModelRoute[];
			providerName?: string;
			providerModel?: string;
	  }
	| { type: "stdin-request"; prompt: StdinPrompt }
	| { type: "system-message"; content: string }
	| { type: "clear-chat" }
	| { type: "rewind-chat"; messageIndex: number; notice?: string }
	| { type: "reasoning-effort"; effort: string | null; notice?: string }
	| { type: "memory-feature"; enabled: boolean; notice?: string }
	| { type: "connection-type"; connection: string; notice?: string }
	| { type: "status-detail"; detail: string; notice?: string }
	| { type: "total-tokens"; tokens: [number, number] }
	| { type: "history-loaded"; messages: ChatMessage[] }
	| {
			type: "swarm-status";
			members: import("@/types").SwarmMemberStatusSnapshot[];
	  }
	| { type: "swarm-plan"; plan: SwarmPlanSummary }
	| { type: "swarm-plan-proposal"; proposal: SwarmPlanProposalSummary };

function normalizeMessageRole(role: string): "user" | "assistant" | "system" {
	if (role === "user") return "user";
	if (role === "assistant") return "assistant";
	return "system";
}

function toAttachedImage(image: RenderedImage, index: number): AttachedImage {
	return {
		id: `img-${Date.now()}-${index}`,
		mediaType: image.media_type,
		base64Data: image.base64_data || image.data,
		filePath: image.path,
		label: image.label,
	};
}

function historyMessageToChatMessage(
	message: HistoryMessage,
	index: number,
): ChatMessage {
	const toolExecutions = message.tool_data
		? [
				{
					id: message.tool_data.id,
					name: message.tool_data.name,
					status: "done" as const,
					input: JSON.stringify(message.tool_data.input),
					output: "",
				},
			]
		: [];

	return {
		id: `history-${index}`,
		role: normalizeMessageRole(message.role),
		content: message.content,
		toolExecutions,
		isStreaming: false,
		images: message.images?.map(toAttachedImage),
		timestamp: message.timestamp_ms ?? Date.now(),
	};
}

function toPreviewItems(
	items:
		| Extract<ServerEvent, { type: "swarm_plan" }>["items"]
		| Extract<ServerEvent, { type: "swarm_plan_proposal" }>["items"],
) {
	return [...items]
		.sort((a, b) => {
			const statusRank = (status: string, blockedBy?: string[]) => {
				const normalized = status.toLowerCase();
				if (normalized === "running" || normalized === "running_stale")
					return 0;
				if (normalized === "blocked" || (blockedBy?.length || 0) > 0) return 2;
				if (["queued", "ready", "pending", "todo"].includes(normalized))
					return 1;
				if (["completed", "done"].includes(normalized)) return 4;
				return 3;
			};
			const priorityRank = (priority: string) => {
				const normalized = priority.toLowerCase();
				if (normalized === "critical") return 0;
				if (normalized === "high") return 1;
				if (normalized === "medium") return 2;
				if (normalized === "low") return 3;
				return 4;
			};
			return (
				statusRank(a.status, a.blocked_by) -
					statusRank(b.status, b.blocked_by) ||
				priorityRank(a.priority) - priorityRank(b.priority)
			);
		})
		.slice(0, 8)
		.map((item) => ({
			id: item.id,
			content: item.content,
			status: item.status,
			priority: item.priority,
			assignedTo: item.assigned_to,
			subsystem: item.subsystem,
			blockedBy: item.blocked_by,
			fileScope: item.file_scope,
		}));
}

function buildSwarmPlanSummary(
	event: Extract<ServerEvent, { type: "swarm_plan" }>,
): SwarmPlanSummary {
	const summary = event.summary;
	const itemsPreview = toPreviewItems(event.items);

	return {
		swarmId: event.swarm_id,
		version: event.version,
		itemCount: summary?.item_count ?? event.items.length,
		participantIds: event.participants || [],
		participantCount: event.participants?.length || 0,
		reason: event.reason,
		readyCount:
			summary?.ready_ids.length ??
			event.items.filter((item) =>
				["queued", "ready", "pending", "todo"].includes(
					item.status.toLowerCase(),
				),
			).length,
		activeCount:
			summary?.active_ids.length ??
			event.items.filter((item) =>
				["running", "running_stale"].includes(item.status.toLowerCase()),
			).length,
		blockedCount:
			summary?.blocked_ids.length ??
			event.items.filter((item) => item.status.toLowerCase() === "blocked")
				.length,
		completedCount:
			summary?.completed_ids.length ??
			event.items.filter((item) =>
				["completed", "done"].includes(item.status.toLowerCase()),
			).length,
		nextReadyIds: summary?.next_ready_ids || [],
		itemsPreview,
	};
}

function buildSwarmPlanProposalSummary(
	event: Extract<ServerEvent, { type: "swarm_plan_proposal" }>,
): SwarmPlanProposalSummary {
	return {
		swarmId: event.swarm_id,
		proposerSession: event.proposer_session,
		proposerName: event.proposer_name,
		summary: event.summary,
		proposalKey: event.proposal_key,
		itemCount: event.items.length,
		itemsPreview: toPreviewItems(event.items),
	};
}

export function rawServerEventToDesktopEvents(
	event: ServerEvent,
): DesktopSemanticEvent[] {
	switch (event.type) {
		case "text_delta":
			return [{ type: "append-text", text: event.text }];
		case "text_replace":
			return [{ type: "replace-text", text: event.text }];
		case "tool_start":
			return [{ type: "tool-start", id: event.id, name: event.name }];
		case "tool_input":
			return [{ type: "tool-input", delta: event.delta }];
		case "tool_exec":
			return [{ type: "tool-exec", id: event.id, name: event.name }];
		case "tool_done":
			return [
				{
					type: "tool-done",
					id: event.id,
					output: event.output || "",
					error: event.error,
				},
			];
		case "generated_image": {
			const outputFormat = event.output_format || "image";
			const summary = event.revised_prompt
				? `Generated ${outputFormat} image\n${event.revised_prompt}`
				: `Generated ${outputFormat} image`;
			return [
				{
					type: "assistant-message",
					content: summary,
					images: [
						{
							id: event.id,
							mediaType: `image/${outputFormat}`,
							filePath: event.path,
							label: event.revised_prompt || `Generated ${outputFormat}`,
						},
					],
				},
			];
		}
		case "tokens":
			return [
				{
					type: "token-usage",
					input: event.input,
					output: event.output,
					cacheReadInput: event.cache_read_input,
					cacheCreationInput: event.cache_creation_input,
				},
			];
		case "done":
			return [{ type: "done" }];
		case "error":
			return [{ type: "error", message: event.message }];
		case "session":
			return [{ type: "session-id", sessionId: event.session_id }];
		case "interrupted":
			return [{ type: "interrupted" }];
		case "connection_phase":
			return [{ type: "connection-phase", phase: event.phase }];
		case "model_changed":
			return [
				{
					type: "model-changed",
					model: event.model,
					providerName: event.provider_name,
				},
			];
		case "available_models_updated":
			return [
				{
					type: "available-models",
					models: event.available_models,
					routes: event.available_model_routes,
					providerName: event.provider_name,
					providerModel: event.provider_model,
				},
			];
		case "swarm_status":
			return [
				{
					type: "swarm-status",
					members: event.members,
				},
			];
		case "swarm_plan":
			return [
				{
					type: "swarm-plan",
					plan: buildSwarmPlanSummary(event),
				},
			];
		case "swarm_plan_proposal":
			return [
				{
					type: "swarm-plan-proposal",
					proposal: buildSwarmPlanProposalSummary(event),
				},
			];
		case "stdin_request": {
			const promptText = event.prompt?.trim() || "interactive input requested";
			const sensitive = event.is_password ? " password" : "";
			return [
				{
					type: "system-message",
					content: `⌨️ Interactive${sensitive} input requested by ${event.tool_call_id || "tool"} (${event.request_id}): ${promptText}`,
				},
				{
					type: "stdin-request",
					prompt: {
						requestId: event.request_id,
						prompt: event.prompt,
						isPassword: event.is_password,
						toolCallId: event.tool_call_id,
					},
				},
			];
		}
		case "compaction": {
			let content = `📦 Context compaction triggered (${event.trigger})`;
			if (event.pre_tokens !== undefined && event.post_tokens !== undefined) {
				content += `\nTokens: ${event.pre_tokens} → ${event.post_tokens}`;
			}
			if (event.tokens_saved !== undefined) {
				content += ` (saved ${event.tokens_saved})`;
			}
			return [{ type: "system-message", content }];
		}
		case "memory_injected":
			return [
				{
					type: "system-message",
					content: `🧠 ${event.count} memory(s) injected (${event.prompt_chars} chars)`,
				},
			];
		case "connection_type":
			return [
				{
					type: "connection-type",
					connection: event.connection,
					notice: `🔌 Connection type: ${event.connection}`,
				},
			];
		case "status_detail":
			return [
				{
					type: "status-detail",
					detail: event.detail,
					notice: `ℹ️ ${event.detail}`,
				},
			];
		case "clear_chat":
			return [{ type: "clear-chat" }];
		case "rewind_chat":
			return [
				{
					type: "rewind-chat",
					messageIndex: event.message_index,
					notice: `⏪ Rewound to message ${event.message_index}`,
				},
			];
		case "reasoning_effort_changed": {
			const effort = event.effort || null;
			return [
				{
					type: "reasoning-effort",
					effort,
					notice: effort ? `🧠 Reasoning effort set to: ${effort}` : undefined,
				},
			];
		}
		case "memory_feature_changed":
			return [
				{
					type: "memory-feature",
					enabled: event.enabled,
					notice: `🧠 Agent memory ${event.enabled ? "enabled" : "disabled"}`,
				},
			];
		case "compact_result":
			return [
				{
					type: "system-message",
					content: event.success ? event.message : `⚠️ ${event.message}`,
				},
			];
		case "history": {
			const desktopEvents: DesktopSemanticEvent[] = [];
			const historyMessages = event.messages.map(historyMessageToChatMessage);
			const restoredHistoryMarker: ChatMessage = {
				id: `history-marker-${event.session_id}`,
				role: "system",
				content:
					`📚 Restored session history (${historyMessages.length} messages)` +
					(event.provider_model ? `\nModel: ${event.provider_model}` : ""),
				toolExecutions: [],
				isStreaming: false,
				timestamp: Date.now(),
			};
			desktopEvents.push({ type: "session-id", sessionId: event.session_id });
			desktopEvents.push({
				type: "history-loaded",
				messages: [restoredHistoryMarker, ...historyMessages],
			});
			if (event.available_models) {
				desktopEvents.push({
					type: "available-models",
					models: event.available_models,
					routes: event.available_model_routes,
					providerName: event.provider_name,
					providerModel: event.provider_model,
				});
			}
			if (event.total_tokens) {
				desktopEvents.push({
					type: "total-tokens",
					tokens: event.total_tokens,
				});
			}
			if (event.connection_type) {
				desktopEvents.push({
					type: "connection-type",
					connection: event.connection_type,
				});
			}
			if (event.reasoning_effort) {
				desktopEvents.push({
					type: "reasoning-effort",
					effort: event.reasoning_effort,
				});
			}
			if (event.memory_enabled !== undefined) {
				desktopEvents.push({
					type: "memory-feature",
					enabled: event.memory_enabled,
				});
			}
			return desktopEvents;
		}
		default:
			return [];
	}
}
