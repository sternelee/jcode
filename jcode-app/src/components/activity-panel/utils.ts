import { convertFileSrc } from "@tauri-apps/api/core";
import type {
	ChatMessage,
	AttachedImage,
	StdinPrompt,
} from "@/types";
import { History, Archive, RotateCcw, Clock3 } from "lucide-react";
import type {
	SegmentKind,
	MessageSegment,
	ToolActivityItem,
	TurnActivity,
	TimelineEntry,
	RuntimeEventItem,
} from "./types";

export function providerLabel(provider: string | null): string {
	if (!provider) return "unknown";
	const labels: Record<string, string> = {
		anthropic: "Anthropic",
		openai: "OpenAI",
		gemini: "Google Gemini",
		copilot: "GitHub Copilot",
		openrouter: "OpenRouter",
		bedrock: "AWS Bedrock",
	};
	return labels[provider] || provider;
}

export function compactText(text: string | undefined, max = 120): string {
	if (!text) return "";
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= max) return normalized;
	return `${normalized.slice(0, max - 1)}…`;
}

export function imageSrc(image: AttachedImage) {
	if (!image) return "";
	if (image.filePath) return convertFileSrc(image.filePath);
	if (image.base64Data)
		return `data:${image.mediaType};base64,${image.base64Data}`;
	return "";
}

export function systemFields(
	message: ChatMessage,
): Array<{ label: string; value: string }> {
	if (message.role !== "system") return [];
	const content = message.content;
	const fields: Array<{ label: string; value: string }> = [];
	const restored = content.match(/\((\d+) messages\)/)?.[1];
	const model = content.match(/Model:\s*(.+)$/m)?.[1];
	const tokens = content.match(/Tokens:\s*([^\n]+)/)?.[1];
	const saved = content.match(/saved\s+(\d+)/)?.[1];
	const rewind = content.match(/message\s+(\d+)/)?.[1];
	const requestId = content.match(/\(([a-zA-Z0-9_-]+)\):/)?.[1];
	if (restored)
		fields.push({ label: "restored", value: `${restored} messages` });
	if (model) fields.push({ label: "model", value: model });
	if (tokens) fields.push({ label: "tokens", value: tokens });
	if (saved) fields.push({ label: "saved", value: saved });
	if (rewind) fields.push({ label: "rewind", value: `message ${rewind}` });
	if (requestId) fields.push({ label: "request", value: requestId });
	return fields;
}

export function selectedMessageFacts(message: ChatMessage): string[] {
	if (message.role !== "system") return [];
	return systemFields(message).map((field) => `${field.label} ${field.value}`);
}

export function formatJsonBlock(text: string, pretty: boolean): string {
	if (!text.trim()) return text;
	try {
		const parsed = JSON.parse(text);
		return pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
	} catch {
		return text;
	}
}

export function systemKind(message: ChatMessage): SegmentKind | null {
	if (message.role !== "system") return null;
	if (message.content.includes("Restored session history")) return "history";
	if (
		message.content.includes("Context compaction") ||
		message.content.includes("compact")
	) {
		return "compaction";
	}
	if (message.content.includes("Rewound to message")) return "rewind";
	return "runtime";
}

export function buildSegments(messages: ChatMessage[]): MessageSegment[] {
	const segments: MessageSegment[] = [];
	let current: ChatMessage[] = [];
	let index = 0;

	const pushCurrent = () => {
		if (current.length === 0) return;
		segments.push({
			id: `segment-${index++}`,
			messages: current,
			kind: "conversation",
		});
		current = [];
	};

	for (const message of messages) {
		const kind = systemKind(message);
		if (!kind) {
			current.push(message);
			continue;
		}
		pushCurrent();
		segments.push({ id: `segment-${index++}`, messages: [message], kind });
	}

	pushCurrent();
	return segments;
}

export function flattenTools(messages: ChatMessage[]): ToolActivityItem[] {
	let assistantTurn = 0;
	return messages.flatMap((message) => {
		if (message.role !== "assistant") return [];
		assistantTurn += 1;
		return message.toolExecutions.map((tool, index) => ({
			...tool,
			key: `${message.id}-${tool.id}-${index}`,
			timestamp: (message.timestamp || 0) + index,
			messageId: message.id,
			messagePreview: compactText(message.content || "tool activity", 90),
			turnLabel: `turn ${assistantTurn}`,
		}));
	});
}

export function boundaryTitle(kind: Exclude<SegmentKind, "conversation">): string {
	switch (kind) {
		case "history":
			return "Restored history boundary";
		case "compaction":
			return "Compaction boundary";
		case "rewind":
			return "Rewind boundary";
		case "runtime":
			return "Runtime boundary";
	}
}

export function boundarySummary(
	kind: Exclude<SegmentKind, "conversation">,
	content: string,
): string {
	if (kind === "history") {
		const count = content.match(/\((\d+) messages\)/)?.[1];
		return count
			? `${count} restored messages below this marker`
			: "older restored turns sit below this marker";
	}
	if (kind === "compaction") {
		const tokenSummary = content.match(/Tokens:\s*([^\n]+)/)?.[1];
		return tokenSummary
			? `newer turns above · compacted context below · ${tokenSummary}`
			: "newer turns above · compacted context below";
	}
	if (kind === "rewind") {
		const target = content.match(/message\s+(\d+)/)?.[1];
		return target
			? `newer transcript resumes above · rewound to message ${target}`
			: "rewind boundary between older and newer transcript";
	}
	return compactText(content, 120) || "runtime event boundary";
}

export function buildTimeline(segments: MessageSegment[]): TurnActivity[] {
	let assistantTurn = 0;
	let lastUserPrompt = "";
	const turns: TurnActivity[] = [];

	for (const segment of segments) {
		if (segment.kind !== "conversation") continue;
		for (const message of segment.messages) {
			if (message.role === "user") {
				lastUserPrompt = message.content;
				continue;
			}
			if (message.role !== "assistant") continue;
			assistantTurn += 1;
			const runningToolCount = message.toolExecutions.filter(
				(tool) =>
					tool.status === "starting" ||
					tool.status === "collecting_input" ||
					tool.status === "executing",
			).length;
			turns.push({
				messageId: message.id,
				turnNumber: assistantTurn,
				userPrompt: compactText(lastUserPrompt, 140),
				assistantPreview: compactText(
					message.content || "(tool-only turn)",
					180,
				),
				tools: message.toolExecutions,
				runningToolCount,
				totalToolCount: message.toolExecutions.length,
				tokenUsage: message.tokenUsage,
				timestamp: message.timestamp || 0,
				segmentId: segment.id,
			});
		}
	}

	return turns;
}

export function buildTimelineEntries(
	segments: MessageSegment[],
	turns: TurnActivity[],
): TimelineEntry[] {
	const turnsBySegment = new Map<string, TurnActivity[]>();
	for (const turn of turns) {
		const bucket = turnsBySegment.get(turn.segmentId) || [];
		bucket.push(turn);
		turnsBySegment.set(turn.segmentId, bucket);
	}

	const entries: TimelineEntry[] = [];
	for (const segment of segments) {
		if (segment.kind !== "conversation") {
			const first = segment.messages[0];
			if (first) {
				entries.push({
					type: "boundary",
					id: `boundary-${segment.id}`,
					segmentKind: segment.kind,
					messageId: first.id,
					title: boundaryTitle(segment.kind),
					summary: boundarySummary(segment.kind, first.content),
				});
			}
			continue;
		}
		for (const turn of turnsBySegment.get(segment.id) || []) {
			entries.push({ type: "turn", id: `turn-${turn.messageId}`, turn });
		}
	}
	return entries;
}

export function classifyRuntimeEvent(content: string): RuntimeEventItem["kind"] {
	if (content.includes("Queued prompt") || content.includes("queued prompt"))
		return "queue";
	if (content.includes("Sending queued prompt")) return "queue";
	if (content.includes("Interactive") || content.includes("interactive input"))
		return "stdin";
	if (content.includes("Context compaction") || content.includes("compact"))
		return "compaction";
	if (content.includes("memory") || content.includes("Memory")) return "memory";
	if (content.includes("Connection type")) return "connection";
	if (content.includes("Reasoning effort")) return "reasoning";
	if (content.includes("Rewound to message")) return "rewind";
	return "other";
}

export function runtimeEventTitle(kind: RuntimeEventItem["kind"]): string {
	switch (kind) {
		case "queue":
			return "Queued drafts";
		case "stdin":
			return "Interactive input";
		case "compaction":
			return "Compaction";
		case "memory":
			return "Memory";
		case "connection":
			return "Connection";
		case "reasoning":
			return "Reasoning";
		case "rewind":
			return "Rewind";
		default:
			return "Runtime notice";
	}
}

export function runtimeEventVariant(
	kind: RuntimeEventItem["kind"],
): "default" | "secondary" | "outline" {
	switch (kind) {
		case "stdin":
		case "compaction":
			return "default";
		case "queue":
		case "memory":
			return "secondary";
		default:
			return "outline";
	}
}

export function buildRuntimeEvents(messages: ChatMessage[]): RuntimeEventItem[] {
	return messages
		.filter((message) => message.role === "system")
		.slice(-10)
		.reverse()
		.map((message) => {
			const kind = classifyRuntimeEvent(message.content);
			return {
				messageId: message.id,
				kind,
				title: runtimeEventTitle(kind),
				detail: compactText(message.content, 180),
			};
		});
}

export function turnStatusLabel(
	turn: TurnActivity,
	isLatest: boolean,
	isProcessing: boolean,
	stdinPrompt: StdinPrompt | null,
): { label: string; variant: "default" | "secondary" | "outline" } {
	if (isLatest && stdinPrompt)
		return { label: "waiting input", variant: "default" };
	if (turn.runningToolCount > 0)
		return { label: "running tools", variant: "default" };
	if (isLatest && isProcessing)
		return { label: "streaming", variant: "default" };
	if (turn.tools.some((tool) => tool.status === "error")) {
		return { label: "tool error", variant: "outline" };
	}
	if (turn.totalToolCount > 0)
		return { label: "complete", variant: "secondary" };
	return { label: "reply", variant: "outline" };
}

export function boundaryIcon(kind: Exclude<SegmentKind, "conversation">) {
	switch (kind) {
		case "history":
			return History;
		case "compaction":
			return Archive;
		case "rewind":
			return RotateCcw;
		case "runtime":
			return Clock3;
	}
}

export function boundaryBadgeVariant(
	kind: Exclude<SegmentKind, "conversation">,
): "default" | "secondary" | "outline" {
	switch (kind) {
		case "compaction":
			return "default";
		case "history":
			return "secondary";
		default:
			return "outline";
	}
}
