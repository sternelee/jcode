import { useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import type {
	AmbientStatusInfo,
	AmbientTranscript,
	AttachedImage,
	AuthDoctorReport,
	AuthStatus,
	ChatMessage,
	MemoryEntry,
	MemoryStats,
	ModelRoute,
	PairedDeviceInfo,
	SessionInfo,
	StdinPrompt,
	ToolExecution,
	UsageInfo,
	VersionInfo,
} from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { ToolCard } from "./ToolCard";
import {
	Activity,
	Archive,
	ArrowUpRight,
	BookOpen,
	Brain,
	Cable,
	ChevronDown,
	ChevronRight,
	Clock3,
	Copy,
	ExternalLink,
	History,
	Keyboard,
	ListTodo,
	MessageSquareText,
	Moon,
	RotateCcw,
	Search,
	Shield,
	ShieldCheck,
	Smartphone,
	Sparkles,
	Timer,
	TriangleAlert,
	Users,
	Wrench,
} from "lucide-react";

interface ActivityPanelProps {
	messages: ChatMessage[];
	isProcessing: boolean;
	queuedDraftCount: number;
	stdinPrompt: StdinPrompt | null;
	providerName: string | null;
	providerModel: string | null;
	availableModels: string[];
	availableModelRoutes: ModelRoute[];
	sessionId: string | null;
	reasoningEffort: string | null;
	connectionType: string | null;
	statusDetail: string | null;
	totalTokens: [number, number] | null;
	sessions: SessionInfo[];
	activeWorkspaceId: string | null;
	activeSessionId: string | null;
	onSelectSession?: (sessionId: string) => void;
	selectedMessageId?: string | null;
	onSelectMessage?: (messageId: string) => void;
	exportMemories?: (path: string) => Promise<void>;
	importMemories?: (
		path: string,
	) => Promise<{ project_count: number; global_count: number } | null>;
	listBackgroundTasks?: () => Promise<import("@/types").BackgroundTask[]>;
	cancelBackgroundTask?: (taskId: string) => Promise<boolean>;
	runAuthDoctor?: () => Promise<import("@/types").AuthDoctorReport | null>;
}

type SegmentKind =
	| "history"
	| "compaction"
	| "rewind"
	| "runtime"
	| "conversation";

interface MessageSegment {
	id: string;
	messages: ChatMessage[];
	kind: SegmentKind;
}

interface ToolActivityItem extends ToolExecution {
	key: string;
	timestamp: number;
	messageId: string;
	messagePreview: string;
	turnLabel: string;
}

interface TurnActivity {
	messageId: string;
	turnNumber: number;
	userPrompt: string;
	assistantPreview: string;
	tools: ToolExecution[];
	runningToolCount: number;
	totalToolCount: number;
	tokenUsage?: {
		input: number;
		output: number;
		cacheReadInput?: number;
		cacheCreationInput?: number;
	};
	timestamp: number;
	segmentId: string;
}

interface BoundaryEntry {
	type: "boundary";
	id: string;
	segmentKind: Exclude<SegmentKind, "conversation">;
	messageId: string;
	title: string;
	summary: string;
}

interface TurnEntry {
	type: "turn";
	id: string;
	turn: TurnActivity;
}

type TimelineEntry = BoundaryEntry | TurnEntry;

interface RuntimeEventItem {
	messageId: string;
	title: string;
	detail: string;
	kind:
		| "queue"
		| "stdin"
		| "compaction"
		| "memory"
		| "connection"
		| "reasoning"
		| "rewind"
		| "other";
}

function providerLabel(provider: string | null): string {
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

function compactText(text: string | undefined, max = 120): string {
	if (!text) return "";
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= max) return normalized;
	return `${normalized.slice(0, max - 1)}…`;
}

function imageSrc(image: AttachedImage) {
	if (!image) return "";
	if (image.filePath) return convertFileSrc(image.filePath);
	if (image.base64Data)
		return `data:${image.mediaType};base64,${image.base64Data}`;
	return "";
}

function selectedMessageFacts(message: ChatMessage): string[] {
	if (message.role !== "system") return [];
	return systemFields(message).map((field) => `${field.label} ${field.value}`);
}

function systemFields(
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

function formatJsonBlock(text: string, pretty: boolean): string {
	if (!text.trim()) return text;
	try {
		const parsed = JSON.parse(text);
		return pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
	} catch {
		return text;
	}
}

function systemKind(message: ChatMessage): SegmentKind | null {
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

function buildSegments(messages: ChatMessage[]): MessageSegment[] {
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

function flattenTools(messages: ChatMessage[]): ToolActivityItem[] {
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

function boundaryTitle(kind: Exclude<SegmentKind, "conversation">): string {
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

function boundarySummary(
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

function buildTimeline(segments: MessageSegment[]): TurnActivity[] {
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

function buildTimelineEntries(
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

function classifyRuntimeEvent(content: string): RuntimeEventItem["kind"] {
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

function runtimeEventTitle(kind: RuntimeEventItem["kind"]): string {
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

function runtimeEventVariant(
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

function buildRuntimeEvents(messages: ChatMessage[]): RuntimeEventItem[] {
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

function turnStatusLabel(
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

function boundaryIcon(kind: Exclude<SegmentKind, "conversation">) {
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

function boundaryBadgeVariant(
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

export function ActivityPanel({
	messages,
	isProcessing,
	queuedDraftCount,
	stdinPrompt,
	providerName,
	providerModel,
	availableModels,
	availableModelRoutes,
	sessionId,
	reasoningEffort,
	connectionType,
	statusDetail,
	totalTokens,
	sessions,
	activeWorkspaceId,
	activeSessionId,
	onSelectSession,
	selectedMessageId,
	onSelectMessage,
	exportMemories,
	importMemories,
	listBackgroundTasks,
	cancelBackgroundTask,
	runAuthDoctor,
}: ActivityPanelProps) {
	const [expandedTurnIds, setExpandedTurnIds] = useState<string[]>([]);
	const [selectedSwarmTaskId, setSelectedSwarmTaskId] = useState<string | null>(
		null,
	);
	const [selectedToolIndex, setSelectedToolIndex] = useState(0);
	const [selectedImageIndex, setSelectedImageIndex] = useState(0);
	const [jsonView, setJsonView] = useState<"pretty" | "raw">("pretty");
	const [inspectorView, setInspectorView] = useState<"parsed" | "raw">(
		"parsed",
	);
	const [turnSearch, setTurnSearch] = useState(
		() => localStorage.getItem("desktop-activity-turn-search") || "",
	);
	const [onlyErrorTurns, setOnlyErrorTurns] = useState(
		() => localStorage.getItem("desktop-activity-only-error-turns") === "true",
	);
	const [onlyToolTurns, setOnlyToolTurns] = useState(
		() => localStorage.getItem("desktop-activity-only-tool-turns") === "true",
	);
	const [swarmProblemFilter, setSwarmProblemFilter] = useState<
		"all" | "tasks" | "peers" | "proposal"
	>(() => {
		const saved = localStorage.getItem("desktop-activity-swarm-problem-filter");
		return saved === "tasks" || saved === "peers" || saved === "proposal"
			? saved
			: "all";
	});
	const [runtimeFilter, setRuntimeFilter] = useState<
		"all" | RuntimeEventItem["kind"]
	>(() => {
		const saved = localStorage.getItem("desktop-activity-runtime-filter");
		return (saved as "all" | RuntimeEventItem["kind"]) || "all";
	});
	const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
	const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
	const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null);
	const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
	const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[] | null>(
		null,
	);
	const [memoryScope, setMemoryScope] = useState<"all" | "project" | "global">(
		"all",
	);
	const [pairedDevices, setPairedDevices] = useState<PairedDeviceInfo[] | null>(
		null,
	);
	const [pairingCode, setPairingCode] = useState<string | null>(null);
	const [backgroundTasks, setBackgroundTasks] = useState<
		import("@/types").BackgroundTask[] | null
	>(null);
	const [authDoctor, setAuthDoctor] = useState<AuthDoctorReport | null>(null);
	const [ambientStatus, setAmbientStatus] = useState<AmbientStatusInfo | null>(null);
	const [ambientTranscripts, setAmbientTranscripts] = useState<AmbientTranscript[] | null>(null);

	const segments = useMemo(() => buildSegments(messages), [messages]);
	const turns = useMemo(() => buildTimeline(segments), [segments]);
	const timelineEntries = useMemo(
		() => [...buildTimelineEntries(segments, turns)].reverse(),
		[segments, turns],
	);
	const allTools = useMemo(() => flattenTools(messages), [messages]);
	const runningTools = useMemo(
		() =>
			allTools.filter(
				(tool) =>
					tool.status === "starting" ||
					tool.status === "collecting_input" ||
					tool.status === "executing",
			),
		[allTools],
	);
	const runtimeEvents = useMemo(() => buildRuntimeEvents(messages), [messages]);
	const latestTurn = turns[turns.length - 1] || null;
	const selectedMessage = useMemo(
		() => messages.find((message) => message.id === selectedMessageId) || null,
		[messages, selectedMessageId],
	);

	useEffect(() => {
		if (!latestTurn) return;
		setExpandedTurnIds((current) =>
			current.includes(latestTurn.messageId)
				? current
				: [latestTurn.messageId, ...current].slice(0, 8),
		);
	}, [latestTurn?.messageId]);

	useEffect(() => {
		localStorage.setItem("desktop-activity-turn-search", turnSearch);
	}, [turnSearch]);

	useEffect(() => {
		localStorage.setItem(
			"desktop-activity-only-error-turns",
			String(onlyErrorTurns),
		);
	}, [onlyErrorTurns]);

	useEffect(() => {
		localStorage.setItem(
			"desktop-activity-only-tool-turns",
			String(onlyToolTurns),
		);
	}, [onlyToolTurns]);

	useEffect(() => {
		localStorage.setItem("desktop-activity-runtime-filter", runtimeFilter);
	}, [runtimeFilter]);

	useEffect(() => {
		localStorage.setItem(
			"desktop-activity-swarm-problem-filter",
			swarmProblemFilter,
		);
	}, [swarmProblemFilter]);

	useEffect(() => {
		setSelectedSwarmTaskId(null);
		setSelectedToolIndex(0);
		setSelectedImageIndex(0);
		setInspectorView("parsed");
		setJsonView("pretty");
	}, [selectedMessageId]);

	const selectedTool =
		selectedMessage?.toolExecutions[selectedToolIndex] || null;
	const selectedImage = selectedMessage?.images?.[selectedImageIndex] || null;

	const currentTurnSummary = useMemo(() => {
		if (!latestTurn) {
			return {
				userPrompt: "",
				assistantPreview: "",
				activeToolCount: 0,
				totalToolCount: 0,
			};
		}
		return {
			userPrompt: latestTurn.userPrompt,
			assistantPreview: latestTurn.assistantPreview,
			activeToolCount: latestTurn.runningToolCount,
			totalToolCount: latestTurn.totalToolCount,
		};
	}, [latestTurn]);

	const currentRoute = useMemo(
		() =>
			availableModelRoutes.find(
				(route) =>
					route.model === providerModel &&
					(!providerName || route.provider === providerName),
			) ||
			availableModelRoutes.find((route) => route.model === providerModel) ||
			null,
		[availableModelRoutes, providerModel, providerName],
	);

	const filteredTimelineEntries = useMemo(() => {
		const query = turnSearch.trim().toLowerCase();
		return timelineEntries.filter((entry) => {
			if (entry.type === "boundary") return true;
			if (
				onlyErrorTurns &&
				!entry.turn.tools.some((tool) => tool.status === "error")
			)
				return false;
			if (onlyToolTurns && entry.turn.totalToolCount === 0) return false;
			if (!query) return true;
			const haystack = [
				entry.turn.userPrompt,
				entry.turn.assistantPreview,
				...entry.turn.tools.map((tool) => tool.name),
			]
				.join(" ")
				.toLowerCase();
			return haystack.includes(query);
		});
	}, [timelineEntries, turnSearch, onlyErrorTurns, onlyToolTurns]);

	const filteredRuntimeEvents = useMemo(
		() =>
			runtimeEvents.filter(
				(event) => runtimeFilter === "all" || event.kind === runtimeFilter,
			),
		[runtimeEvents, runtimeFilter],
	);

	const swarmPeers = useMemo(() => {
		const workspaceKey = activeWorkspaceId || "default";
		return sessions
			.filter((session) => (session.workingDir || "default") === workspaceKey)
			.filter(
				(session) =>
					session.swarmEnabled || session.liveProcessing || session.swarmRole,
			)
			.sort((a, b) => {
				if (a.sessionId === activeSessionId) return -1;
				if (b.sessionId === activeSessionId) return 1;
				if (a.swarmRole === "coordinator") return -1;
				if (b.swarmRole === "coordinator") return 1;
				return a.title.localeCompare(b.title);
			});
	}, [sessions, activeWorkspaceId, activeSessionId]);

	const activeSession = useMemo(
		() =>
			sessions.find((session) => session.sessionId === activeSessionId) || null,
		[sessions, activeSessionId],
	);

	const activeSwarmPlan = useMemo(
		() =>
			activeSession?.swarmPlan ||
			swarmPeers.find((peer) => peer.swarmPlan)?.swarmPlan ||
			null,
		[activeSession, swarmPeers],
	);

	const activeSwarmProposal = useMemo(
		() =>
			activeSession?.swarmProposal ||
			swarmPeers.find((peer) => peer.swarmProposal)?.swarmProposal ||
			null,
		[activeSession, swarmPeers],
	);

	const swarmPlanParticipants = useMemo(() => {
		if (!activeSwarmPlan) return swarmPeers;
		const ids =
			activeSwarmPlan.participantIds.length > 0
				? activeSwarmPlan.participantIds
				: swarmPeers.map((peer) => peer.sessionId);
		return ids
			.map((participantId) =>
				sessions.find((session) => session.sessionId === participantId),
			)
			.filter(Boolean) as SessionInfo[];
	}, [activeSwarmPlan, swarmPeers, sessions]);

	const selectedSwarmTask = useMemo(() => {
		if (!selectedSwarmTaskId || !activeSwarmPlan) return null;
		return (
			activeSwarmPlan.itemsPreview.find(
				(item) => item.id === selectedSwarmTaskId,
			) || null
		);
	}, [activeSwarmPlan, selectedSwarmTaskId]);

	const selectedTaskAssignee = selectedSwarmTask?.assignedTo
		? sessions.find(
				(session) => session.sessionId === selectedSwarmTask.assignedTo,
			) || null
		: null;

	const selectedTaskRelatedPeers = useMemo(() => {
		if (!selectedSwarmTask) return [] as SessionInfo[];
		return swarmPlanParticipants.filter((participant) => {
			if (
				selectedSwarmTask.assignedTo &&
				participant.sessionId === selectedSwarmTask.assignedTo
			) {
				return true;
			}
			return participant.swarmRole === "coordinator";
		});
	}, [selectedSwarmTask, swarmPlanParticipants]);

	const blockedTasks = useMemo(
		() =>
			activeSwarmPlan?.itemsPreview.filter(
				(item) =>
					item.status.toLowerCase().includes("block") ||
					(item.blockedBy?.length || 0) > 0,
			) || [],
		[activeSwarmPlan],
	);

	const problemPeers = useMemo(
		() =>
			swarmPeers.filter((peer) => {
				const status = peer.status?.toLowerCase() || "";
				return (
					status.includes("fail") ||
					status.includes("error") ||
					status.includes("block") ||
					status.includes("crash")
				);
			}),
		[swarmPeers],
	);

	const waitingPeers = useMemo(
		() =>
			swarmPeers.filter(
				(peer) =>
					peer.livePhase === "waiting" ||
					peer.status?.toLowerCase() === "ready",
			),
		[swarmPeers],
	);

	const filteredSwarmProblems = useMemo(() => {
		if (swarmProblemFilter === "tasks") {
			return {
				tasks: blockedTasks,
				peers: [] as SessionInfo[],
				showProposal: false,
			};
		}
		if (swarmProblemFilter === "peers") {
			return {
				tasks: [] as typeof blockedTasks,
				peers: [
					...problemPeers,
					...waitingPeers.filter(
						(peer) =>
							!problemPeers.some(
								(problemPeer) => problemPeer.sessionId === peer.sessionId,
							),
					),
				],
				showProposal: false,
			};
		}
		if (swarmProblemFilter === "proposal") {
			return {
				tasks: [] as typeof blockedTasks,
				peers: [] as SessionInfo[],
				showProposal: Boolean(activeSwarmProposal),
			};
		}
		return {
			tasks: blockedTasks,
			peers: [
				...problemPeers,
				...waitingPeers.filter(
					(peer) =>
						!problemPeers.some(
							(problemPeer) => problemPeer.sessionId === peer.sessionId,
						),
				),
			],
			showProposal: Boolean(activeSwarmProposal),
		};
	}, [
		swarmProblemFilter,
		blockedTasks,
		problemPeers,
		waitingPeers,
		activeSwarmProposal,
	]);

	useEffect(() => {
		if (
			selectedSwarmTaskId &&
			activeSwarmPlan &&
			!activeSwarmPlan.itemsPreview.some(
				(item) => item.id === selectedSwarmTaskId,
			)
		) {
			setSelectedSwarmTaskId(null);
		}
	}, [selectedSwarmTaskId, activeSwarmPlan]);

	useEffect(() => {
		void (async () => {
			try {
				const version = await invoke<VersionInfo>("get_version_info");
				setVersionInfo(version);
			} catch {
				// ignore
			}
		})();
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				const status = await invoke<AuthStatus>("get_auth_status");
				setAuthStatus(status);
			} catch {
				// ignore
			}
		})();
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				const usage = await invoke<UsageInfo>("get_usage_info");
				setUsageInfo(usage);
			} catch {
				// ignore
			}
		})();
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				const stats = await invoke<MemoryStats>("get_memory_stats");
				setMemoryStats(stats);
			} catch {
				// ignore
			}
		})();
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				const result = await invoke<{ memories: MemoryEntry[] }>(
					"get_memory_list",
					{ scope: memoryScope },
				);
				setMemoryEntries(result.memories.slice(0, 20));
			} catch {
				// ignore
			}
		})();
	}, [memoryScope]);

	const refreshDevices = async () => {
		try {
			const result = await invoke<{ devices: PairedDeviceInfo[] }>(
				"list_paired_devices",
			);
			setPairedDevices(result.devices);
		} catch {
			// ignore
		}
	};

	const refreshAuthDoctor = async () => {
		if (!runAuthDoctor) return;
		try {
			const report = await runAuthDoctor();
			setAuthDoctor(report);
		} catch {
			// ignore
		}
	};

	const refreshAmbient = async () => {
		try {
			const status = await invoke<AmbientStatusInfo>("get_ambient_status");
			setAmbientStatus(status);
		} catch {
			// ignore
		}
	};

	const refreshAmbientTranscripts = async () => {
		try {
			const result = await invoke<{ transcripts: AmbientTranscript[] }>("get_ambient_transcripts");
			setAmbientTranscripts(result.transcripts);
		} catch {
			// ignore
		}
	};

	useEffect(() => {
		void refreshDevices();
	}, []);

	useEffect(() => {
		void refreshAmbient();
		void refreshAmbientTranscripts();
	}, []);

	const toggleTurn = (messageId: string) => {
		setExpandedTurnIds((current) =>
			current.includes(messageId)
				? current.filter((id) => id !== messageId)
				: [messageId, ...current],
		);
	};

	return (
		<aside className="hidden xl:flex xl:w-[380px] xl:min-w-[380px] xl:flex-col bg-card border-l border-border">
			<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
				<div className="flex items-center gap-2 text-sm font-semibold text-foreground">
					<Activity className="w-4 h-4 text-muted-foreground" />
					Activity
				</div>
				<span
					className={cn(
						"text-[10px] font-medium px-2 py-0.5 rounded-full",
						isProcessing
							? "bg-primary text-primary-foreground"
							: stdinPrompt
								? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
								: "bg-secondary text-secondary-foreground",
					)}
				>
					{stdinPrompt ? "waiting input" : isProcessing ? "running" : "idle"}
				</span>
			</div>

			<ScrollArea className="flex-1 overflow-auto">
				<div className="p-4 space-y-4">
					<section className="space-y-2">
						<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Session status
						</div>
						<div className="grid grid-cols-1 gap-2">
							<div className="rounded-lg border bg-card p-3 space-y-2">
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<Sparkles className="w-3.5 h-3.5" />
									Model
								</div>
								<div className="text-sm font-medium break-all">
									{providerModel || "unknown"}
								</div>
								<div className="text-[11px] text-muted-foreground">
									{providerLabel(providerName)}
								</div>
								<div className="flex flex-wrap gap-1.5 pt-1">
									{sessionId && (
										<Badge variant="outline" className="text-[10px] font-mono">
											session {sessionId.slice(-8)}
										</Badge>
									)}
									{availableModels.length > 0 && (
										<Badge variant="secondary" className="text-[10px]">
											{availableModels.length} switchable models
										</Badge>
									)}
									{availableModelRoutes.length > 0 && (
										<Badge variant="secondary" className="text-[10px]">
											{
												availableModelRoutes.filter(
													(route) => route.context_window,
												).length
											}{" "}
											context-known
										</Badge>
									)}
								</div>
							</div>

							<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
								<div className="flex items-center justify-between gap-2">
									<span className="inline-flex items-center gap-1.5 text-muted-foreground">
										<Brain className="w-3.5 h-3.5" />
										Reasoning
									</span>
									<span className="font-mono">
										{reasoningEffort || "default"}
									</span>
								</div>
								<div className="flex items-center justify-between gap-2">
									<span className="inline-flex items-center gap-1.5 text-muted-foreground">
										<Cable className="w-3.5 h-3.5" />
										Connection
									</span>
									<span className="font-mono text-right">
										{connectionType || "unknown"}
									</span>
								</div>
								<div className="flex items-center justify-between gap-2">
									<span className="inline-flex items-center gap-1.5 text-muted-foreground">
										<ListTodo className="w-3.5 h-3.5" />
										Queued drafts
									</span>
									<span className="font-mono">{queuedDraftCount}</span>
								</div>
								<div className="flex items-center justify-between gap-2">
									<span className="inline-flex items-center gap-1.5 text-muted-foreground">
										<Keyboard className="w-3.5 h-3.5" />
										Interactive input
									</span>
									<span className="font-mono">
										{stdinPrompt ? "pending" : "none"}
									</span>
								</div>
								{totalTokens && (
									<div className="flex items-center justify-between gap-2">
										<span className="inline-flex items-center gap-1.5 text-muted-foreground">
											<Clock3 className="w-3.5 h-3.5" />
											Tokens
										</span>
										<span className="font-mono">
											↑{totalTokens[0]} ↓{totalTokens[1]}
										</span>
									</div>
								)}
								{statusDetail && (
									<div className="rounded border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground">
										{statusDetail}
									</div>
								)}
								{availableModelRoutes.length > 0 && (
									<div className="rounded border bg-secondary px-2 py-2 space-y-1.5">
										<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
											Runtime capabilities
										</div>
										<div className="flex flex-wrap gap-1.5">
											{availableModelRoutes.some(
												(route) =>
													route.context_window &&
													route.context_window >= 100000,
											) && (
												<Badge variant="outline" className="text-[10px]">
													long-context
												</Badge>
											)}
											{availableModelRoutes.some((route) =>
												Boolean(route.display_name),
											) && (
												<Badge variant="outline" className="text-[10px]">
													rich-catalog
												</Badge>
											)}
											{availableModelRoutes.length > 1 && (
												<Badge variant="outline" className="text-[10px]">
													multi-route
												</Badge>
											)}
											{availableModels.length > 1 && (
												<Badge variant="outline" className="text-[10px]">
													hot-switch
												</Badge>
											)}
										</div>
									</div>
								)}
								{currentRoute && (
									<div className="rounded border bg-secondary px-2 py-2 space-y-1.5">
										<div className="flex items-center justify-between gap-2">
											<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
												Current route metadata
											</div>
											<Button
												variant="ghost"
												size="sm"
												className="h-6 px-2 text-[10px]"
												onClick={() =>
													navigator.clipboard.writeText(
														JSON.stringify(currentRoute, null, 2),
													)
												}
											>
												<Copy className="w-3 h-3 mr-1" />
												copy
											</Button>
										</div>
										<pre className="rounded border bg-background/60 px-2 py-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground leading-relaxed">
											{JSON.stringify(currentRoute, null, 2)}
										</pre>
									</div>
								)}
							</div>
						</div>
					</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Swarm
							</div>
							<Badge variant="outline" className="text-[10px]">
								{swarmPeers.length}
							</Badge>
						</div>
						{swarmPeers.length === 0 ? (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								No swarm-active peers detected for this workspace.
							</div>
						) : (
							<div className="space-y-2">
								{swarmPeers.map((peer) => (
									<div
										key={peer.sessionId}
										className="rounded-lg border bg-card p-3 space-y-2 text-xs"
									>
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0">
												<div className="font-medium truncate">{peer.title}</div>
												<div className="text-[11px] text-muted-foreground truncate">
													{peer.subtitle || peer.detail || peer.sessionId}
												</div>
											</div>
											<div className="flex flex-wrap justify-end gap-1">
												{peer.sessionId === activeSessionId && (
													<Badge variant="secondary" className="text-[10px]">
														current
													</Badge>
												)}
												{peer.swarmRole && (
													<Badge
														variant="outline"
														className="text-[10px] uppercase"
													>
														{peer.swarmRole}
													</Badge>
												)}
												{peer.status && (
													<Badge
														variant={
															peer.status.includes("fail") ||
															peer.status.includes("error")
																? "destructive"
																: "outline"
														}
														className="text-[10px] uppercase"
													>
														{peer.status}
													</Badge>
												)}
											</div>
										</div>
										<div className="flex flex-wrap gap-1.5">
											{peer.swarmEnabled && (
												<Badge variant="outline" className="text-[10px]">
													<Users className="w-3 h-3 mr-1" />
													swarm {peer.swarmPeerCount || 0}
												</Badge>
											)}
											{peer.livePhase && peer.livePhase !== "idle" && (
												<Badge
													variant={
														peer.livePhase === "chunking"
															? "default"
															: "secondary"
													}
													className="text-[10px]"
												>
													<Sparkles className="w-3 h-3 mr-1" />
													{peer.livePhase === "tool"
														? peer.liveToolName || "tool"
														: peer.livePhase}
												</Badge>
											)}
										</div>
										{peer.liveStatusDetail && (
											<div className="rounded border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground">
												{peer.liveStatusDetail}
											</div>
										)}
										{onSelectSession && peer.sessionId !== activeSessionId && (
											<Button
												variant="ghost"
												size="sm"
												className="h-6 px-2 text-[10px]"
												onClick={() => onSelectSession(peer.sessionId)}
											>
												Open session
												<ArrowUpRight className="w-3 h-3 ml-1" />
											</Button>
										)}
									</div>
								))}
							</div>
						)}
					</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Swarm problems
							</div>
							<Badge variant="outline" className="text-[10px]">
								{blockedTasks.length +
									problemPeers.length +
									waitingPeers.length +
									(activeSwarmProposal ? 1 : 0)}
							</Badge>
						</div>
						<div className="flex flex-wrap gap-1">
							{(["all", "tasks", "peers", "proposal"] as const).map(
								(filter) => (
									<button
										key={filter}
										className={cn(
											"px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors",
											swarmProblemFilter === filter
												? "bg-primary text-primary-foreground"
												: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
										)}
										onClick={() => setSwarmProblemFilter(filter)}
									>
										{filter}
									</button>
								),
							)}
						</div>
						{filteredSwarmProblems.tasks.length === 0 &&
						filteredSwarmProblems.peers.length === 0 &&
						!filteredSwarmProblems.showProposal ? (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								No blocked tasks, problem peers, or pending proposals detected.
							</div>
						) : (
							<div className="space-y-2">
								{filteredSwarmProblems.showProposal && activeSwarmProposal && (
									<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
										<div className="flex items-center gap-2">
											<TriangleAlert className="w-3.5 h-3.5 text-amber-500" />
											<div className="font-medium">Pending proposal review</div>
											<Badge variant="outline" className="ml-auto text-[10px]">
												proposal
											</Badge>
										</div>
										<div className="text-muted-foreground whitespace-pre-wrap break-words">
											{activeSwarmProposal.summary}
										</div>
										<div className="flex flex-wrap gap-1.5">
											<Badge variant="outline" className="text-[10px]">
												{activeSwarmProposal.itemCount} items
											</Badge>
											<Badge
												variant="outline"
												className="text-[10px] font-mono"
											>
												{activeSwarmProposal.proposalKey}
											</Badge>
										</div>
										{onSelectSession &&
											activeSwarmProposal.proposerSession !==
												activeSessionId && (
												<Button
													variant="ghost"
													size="sm"
													className="h-6 px-2 text-[10px]"
													onClick={() =>
														onSelectSession(activeSwarmProposal.proposerSession)
													}
												>
													Open proposer
													<ArrowUpRight className="w-3 h-3 ml-1" />
												</Button>
											)}
									</div>
								)}
								{filteredSwarmProblems.tasks.map((item) => (
									<button
										key={`problem-task-${item.id}`}
										type="button"
										className={cn(
											"w-full rounded-lg border bg-card p-3 space-y-2 text-left text-xs transition-colors hover:bg-secondary",
											selectedSwarmTaskId === item.id &&
												"ring-1 ring-primary/40 bg-primary/5",
										)}
										onClick={() => {
											setSelectedSwarmTaskId(item.id);
											setInspectorView("parsed");
											setJsonView("pretty");
										}}
									>
										<div className="flex items-start gap-2">
											<TriangleAlert className="mt-0.5 w-3.5 h-3.5 text-amber-500" />
											<div className="min-w-0 flex-1">
												<div className="font-medium break-words">
													{compactText(item.content, 96)}
												</div>
												<div className="text-[11px] text-muted-foreground font-mono">
													{item.id}
												</div>
											</div>
											<div className="flex flex-wrap justify-end gap-1">
												<Badge
													variant="destructive"
													className="text-[10px] uppercase"
												>
													{item.status}
												</Badge>
												<Badge variant="outline" className="text-[10px]">
													deps {item.blockedBy?.length || 0}
												</Badge>
											</div>
										</div>
									</button>
								))}
								{filteredSwarmProblems.peers.map((peer) => (
									<div
										key={`problem-peer-${peer.sessionId}`}
										className="rounded-lg border bg-card p-3 space-y-2 text-xs"
									>
										<div className="flex items-start gap-2">
											<TriangleAlert
												className={cn(
													"mt-0.5 w-3.5 h-3.5",
													peer.status?.toLowerCase().includes("fail") ||
														peer.status?.toLowerCase().includes("error")
														? "text-red-500"
														: "text-amber-500",
												)}
											/>
											<div className="min-w-0 flex-1">
												<div className="font-medium truncate">{peer.title}</div>
												<div className="text-[11px] text-muted-foreground truncate">
													{peer.liveStatusDetail ||
														peer.subtitle ||
														peer.sessionId}
												</div>
											</div>
											<div className="flex flex-wrap justify-end gap-1">
												{peer.livePhase && peer.livePhase !== "idle" && (
													<Badge variant="outline" className="text-[10px]">
														{peer.livePhase}
													</Badge>
												)}
												{peer.status && (
													<Badge
														variant={
															peer.status.toLowerCase().includes("fail") ||
															peer.status.toLowerCase().includes("error")
																? "destructive"
																: "outline"
														}
														className="text-[10px] uppercase"
													>
														{peer.status}
													</Badge>
												)}
											</div>
										</div>
										{onSelectSession && peer.sessionId !== activeSessionId && (
											<Button
												variant="ghost"
												size="sm"
												className="h-6 px-2 text-[10px]"
												onClick={() => onSelectSession(peer.sessionId)}
											>
												Open session
												<ArrowUpRight className="w-3 h-3 ml-1" />
											</Button>
										)}
									</div>
								))}
							</div>
						)}
					</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Plan proposal
							</div>
							<Badge variant="outline" className="text-[10px]">
								{activeSwarmProposal
									? `items ${activeSwarmProposal.itemCount}`
									: "none"}
							</Badge>
						</div>
						{!activeSwarmProposal ? (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								No live swarm plan proposal is currently queued for this
								workspace.
							</div>
						) : (
							<div className="space-y-2">
								<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
									<div className="flex flex-wrap items-center gap-1.5">
										<Badge variant="secondary" className="text-[10px]">
											{activeSwarmProposal.itemCount} proposed tasks
										</Badge>
										<Badge variant="outline" className="text-[10px] font-mono">
											{activeSwarmProposal.swarmId}
										</Badge>
										<Badge variant="outline" className="text-[10px] font-mono">
											{activeSwarmProposal.proposalKey}
										</Badge>
									</div>
									<div className="rounded border bg-secondary px-2 py-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
										{activeSwarmProposal.summary}
									</div>
									<div className="flex items-center justify-between gap-2">
										<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
											Proposed by{" "}
											{activeSwarmProposal.proposerName ||
												activeSwarmProposal.proposerSession}
										</div>
										{onSelectSession &&
											activeSwarmProposal.proposerSession !==
												activeSessionId && (
												<Button
													variant="ghost"
													size="sm"
													className="h-6 px-2 text-[10px]"
													onClick={() =>
														onSelectSession(activeSwarmProposal.proposerSession)
													}
												>
													Open proposer
													<ArrowUpRight className="w-3 h-3 ml-1" />
												</Button>
											)}
									</div>
								</div>
								<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
									<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
										Proposal items
									</div>
									{activeSwarmProposal.itemsPreview.length === 0 ? (
										<div className="text-muted-foreground">
											No proposal items captured.
										</div>
									) : (
										<div className="space-y-2">
											{activeSwarmProposal.itemsPreview.map((item) => {
												const assignedSession = item.assignedTo
													? sessions.find(
															(session) =>
																session.sessionId === item.assignedTo,
														) || null
													: null;
												return (
													<div
														key={`proposal-${item.id}`}
														className="rounded border bg-secondary px-2 py-2 space-y-1.5"
													>
														<div className="flex items-start justify-between gap-2">
															<div className="min-w-0">
																<div className="font-medium break-words">
																	{compactText(item.content, 96)}
																</div>
																<div className="text-[11px] text-muted-foreground font-mono">
																	{item.id}
																</div>
															</div>
															<div className="flex flex-wrap justify-end gap-1">
																<Badge
																	variant={
																		item.status
																			.toLowerCase()
																			.includes("block") ||
																		item.status.toLowerCase().includes("fail")
																			? "destructive"
																			: "outline"
																	}
																	className="text-[10px] uppercase"
																>
																	{item.status}
																</Badge>
																<Badge
																	variant="secondary"
																	className="text-[10px] uppercase"
																>
																	{item.priority}
																</Badge>
															</div>
														</div>
														<div className="flex flex-wrap gap-1.5">
															{item.subsystem && (
																<Badge
																	variant="outline"
																	className="text-[10px]"
																>
																	{item.subsystem}
																</Badge>
															)}
															{(item.blockedBy?.length || 0) > 0 && (
																<Badge
																	variant="outline"
																	className="text-[10px]"
																>
																	blocked by {item.blockedBy?.length}
																</Badge>
															)}
															{(item.fileScope?.length || 0) > 0 && (
																<Badge
																	variant="outline"
																	className="text-[10px]"
																>
																	files {item.fileScope?.length}
																</Badge>
															)}
														</div>
														{assignedSession && (
															<div className="text-[11px] text-muted-foreground">
																suggested assignee {assignedSession.title}
															</div>
														)}
													</div>
												);
											})}
										</div>
									)}
								</div>
							</div>
						)}
					</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Swarm plan
							</div>
							<Badge variant="outline" className="text-[10px]">
								{activeSwarmPlan ? `v${activeSwarmPlan.version}` : "none"}
							</Badge>
						</div>
						{!activeSwarmPlan ? (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								No live or persisted swarm plan snapshot is available for this
								workspace yet.
							</div>
						) : (
							<div className="space-y-2">
								<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
									<div className="flex flex-wrap items-center gap-1.5">
										<Badge variant="secondary" className="text-[10px]">
											{activeSwarmPlan.itemCount} tasks
										</Badge>
										<Badge variant="secondary" className="text-[10px]">
											{activeSwarmPlan.participantCount} participants
										</Badge>
										{activeSwarmPlan.reason && (
											<Badge variant="outline" className="text-[10px]">
												{activeSwarmPlan.reason}
											</Badge>
										)}
										<Badge variant="outline" className="text-[10px] font-mono">
											{activeSwarmPlan.swarmId}
										</Badge>
									</div>
									<div className="grid grid-cols-2 gap-2">
										<div className="rounded border bg-secondary px-2 py-2">
											<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
												Ready
											</div>
											<div className="text-sm font-medium">
												{activeSwarmPlan.readyCount}
											</div>
										</div>
										<div className="rounded border bg-secondary px-2 py-2">
											<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
												Active
											</div>
											<div className="text-sm font-medium">
												{activeSwarmPlan.activeCount}
											</div>
										</div>
										<div className="rounded border bg-secondary px-2 py-2">
											<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
												Blocked
											</div>
											<div className="text-sm font-medium">
												{activeSwarmPlan.blockedCount}
											</div>
										</div>
										<div className="rounded border bg-secondary px-2 py-2">
											<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
												Completed
											</div>
											<div className="text-sm font-medium">
												{activeSwarmPlan.completedCount}
											</div>
										</div>
									</div>
									{activeSwarmPlan.nextReadyIds.length > 0 && (
										<div className="rounded border bg-secondary px-2 py-2 space-y-1.5">
											<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
												Next ready
											</div>
											<div className="flex flex-wrap gap-1.5">
												{activeSwarmPlan.nextReadyIds.map((taskId) => (
													<Badge
														key={taskId}
														variant="outline"
														className="text-[10px] font-mono"
													>
														{taskId}
													</Badge>
												))}
											</div>
										</div>
									)}
								</div>

								<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
									<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
										Participants
									</div>
									{swarmPlanParticipants.length === 0 ? (
										<div className="text-muted-foreground">
											No participant sessions available in this desktop runtime.
										</div>
									) : (
										<div className="space-y-2">
											{swarmPlanParticipants.map((participant) => (
												<div
													key={participant.sessionId}
													className="rounded border bg-secondary px-2 py-2 space-y-1.5"
												>
													<div className="flex items-start justify-between gap-2">
														<div className="min-w-0">
															<div className="font-medium truncate">
																{participant.title}
															</div>
															<div className="text-[11px] text-muted-foreground truncate">
																{participant.liveStatusDetail ||
																	participant.subtitle ||
																	participant.sessionId}
															</div>
														</div>
														<div className="flex flex-wrap gap-1">
															{participant.swarmRole && (
																<Badge
																	variant="outline"
																	className="text-[10px] uppercase"
																>
																	{participant.swarmRole}
																</Badge>
															)}
															{participant.status && (
																<Badge
																	variant={
																		participant.status
																			.toLowerCase()
																			.includes("fail") ||
																		participant.status
																			.toLowerCase()
																			.includes("error")
																			? "destructive"
																			: "outline"
																	}
																	className="text-[10px] uppercase"
																>
																	{participant.status}
																</Badge>
															)}
														</div>
													</div>
													<div className="flex flex-wrap gap-1.5">
														{participant.livePhase &&
															participant.livePhase !== "idle" && (
																<Badge
																	variant="secondary"
																	className="text-[10px]"
																>
																	{participant.livePhase === "tool"
																		? participant.liveToolName || "tool"
																		: participant.livePhase}
																</Badge>
															)}
														{participant.sessionId === activeSessionId && (
															<Badge
																variant="secondary"
																className="text-[10px]"
															>
																current
															</Badge>
														)}
													</div>
													{onSelectSession &&
														participant.sessionId !== activeSessionId && (
															<Button
																variant="ghost"
																size="sm"
																className="h-6 px-2 text-[10px]"
																onClick={() =>
																	onSelectSession(participant.sessionId)
																}
															>
																Open session
																<ArrowUpRight className="w-3 h-3 ml-1" />
															</Button>
														)}
												</div>
											))}
										</div>
									)}
								</div>

								<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
									<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
										Plan lane
									</div>
									{activeSwarmPlan.itemsPreview.length === 0 ? (
										<div className="text-muted-foreground">
											No plan tasks captured in the latest snapshot.
										</div>
									) : (
										<div className="space-y-2">
											{activeSwarmPlan.itemsPreview.map((item) => {
												const assignedSession = item.assignedTo
													? sessions.find(
															(session) =>
																session.sessionId === item.assignedTo,
														) || null
													: null;
												const isFocused = selectedSwarmTaskId === item.id;
												return (
													<button
														key={item.id}
														type="button"
														className={cn(
															"w-full rounded border bg-secondary px-2 py-2 space-y-1.5 text-left transition-colors hover:bg-secondary",
															isFocused &&
																"ring-1 ring-primary/40 bg-primary/5",
														)}
														onClick={() => {
															setSelectedSwarmTaskId(item.id);
															setInspectorView("parsed");
															setJsonView("pretty");
														}}
													>
														<div className="flex items-start justify-between gap-2">
															<div className="min-w-0">
																<div className="font-medium break-words">
																	{compactText(item.content, 96)}
																</div>
																<div className="text-[11px] text-muted-foreground font-mono">
																	{item.id}
																</div>
															</div>
															<div className="flex flex-wrap justify-end gap-1">
																{isFocused && (
																	<Badge
																		variant="secondary"
																		className="text-[10px]"
																	>
																		focus
																	</Badge>
																)}
																<Badge
																	variant={
																		item.status
																			.toLowerCase()
																			.includes("block") ||
																		item.status.toLowerCase().includes("fail")
																			? "destructive"
																			: "outline"
																	}
																	className="text-[10px] uppercase"
																>
																	{item.status}
																</Badge>
																<Badge
																	variant="secondary"
																	className="text-[10px] uppercase"
																>
																	{item.priority}
																</Badge>
															</div>
														</div>
														<div className="flex flex-wrap gap-1.5">
															{item.subsystem && (
																<Badge
																	variant="outline"
																	className="text-[10px]"
																>
																	{item.subsystem}
																</Badge>
															)}
															{(item.blockedBy?.length || 0) > 0 && (
																<Badge
																	variant="outline"
																	className="text-[10px]"
																>
																	blocked by {item.blockedBy?.length}
																</Badge>
															)}
															{(item.fileScope?.length || 0) > 0 && (
																<Badge
																	variant="outline"
																	className="text-[10px]"
																>
																	files {item.fileScope?.length}
																</Badge>
															)}
														</div>
														{assignedSession && (
															<div className="text-[11px] text-muted-foreground">
																assigned to {assignedSession.title}
															</div>
														)}
														{onSelectSession &&
															assignedSession &&
															assignedSession.sessionId !== activeSessionId && (
																<div className="pt-0.5">
																	<Button
																		type="button"
																		variant="ghost"
																		size="sm"
																		className="h-6 px-2 text-[10px]"
																		onClick={(e) => {
																			e.stopPropagation();
																			onSelectSession(
																				assignedSession.sessionId,
																			);
																		}}
																	>
																		Open assignee
																		<ArrowUpRight className="w-3 h-3 ml-1" />
																	</Button>
																</div>
															)}
													</button>
												);
											})}
										</div>
									)}
								</div>
							</div>
						)}
					</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Current turn
							</div>
							<Badge variant="outline" className="text-[10px]">
								{currentTurnSummary.activeToolCount > 0
									? `${currentTurnSummary.activeToolCount} active`
									: latestTurn
										? "quiet"
										: "none"}
							</Badge>
						</div>
						<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
							<div>
								<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
									Latest user prompt
								</div>
								<div className="text-foreground break-words">
									{currentTurnSummary.userPrompt || "No user prompt yet."}
								</div>
							</div>
							<div>
								<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
									Assistant state
								</div>
								<div className="text-muted-foreground break-words">
									{stdinPrompt
										? "Waiting for interactive tool input before the turn can continue."
										: currentTurnSummary.assistantPreview ||
											(isProcessing
												? "Assistant is preparing a response."
												: "No assistant response yet.")}
								</div>
							</div>
							<div className="flex items-center gap-2 pt-1 flex-wrap">
								<Badge variant="secondary" className="text-[10px]">
									turns:{turns.length}
								</Badge>
								<Badge variant="secondary" className="text-[10px]">
									tools:{currentTurnSummary.totalToolCount}
								</Badge>
								{latestTurn && (
									<Button
										variant="ghost"
										size="sm"
										className="h-6 px-2 text-[10px]"
										onClick={() => onSelectMessage?.(latestTurn.messageId)}
									>
										Jump to turn
										<ArrowUpRight className="w-3 h-3 ml-1" />
									</Button>
								)}
							</div>
						</div>
					</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Running tools
							</div>
							<Badge variant="outline" className="text-[10px]">
								{runningTools.length}
							</Badge>
						</div>
						{runningTools.length === 0 ? (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								No active tools right now.
							</div>
						) : (
							<div className="space-y-2">
								{runningTools.map((tool) => (
									<div
										key={tool.key}
										className="space-y-2 rounded-lg border bg-card p-2"
									>
										<div className="flex items-center justify-between gap-2 px-1">
											<div className="text-[10px] text-muted-foreground uppercase tracking-wide">
												{tool.turnLabel}
											</div>
											<Button
												variant="ghost"
												size="sm"
												className="h-6 px-2 text-[10px]"
												onClick={() => onSelectMessage?.(tool.messageId)}
											>
												Jump
												<ArrowUpRight className="w-3 h-3 ml-1" />
											</Button>
										</div>
										<ToolCard tool={tool} />
									</div>
								))}
							</div>
						)}
					</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Turn timeline
							</div>
							<Badge variant="outline" className="text-[10px]">
								{filteredTimelineEntries.length}
							</Badge>
						</div>
						<div className="rounded-lg border bg-card p-2 space-y-2">
							<div className="flex items-center gap-2 rounded border bg-secondary px-2 py-1.5">
								<Search className="w-3.5 h-3.5 text-muted-foreground" />
								<input
									value={turnSearch}
									onChange={(e) => setTurnSearch(e.target.value)}
									placeholder="Search turns, prompts, tools"
									className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
								/>
							</div>
							<div className="flex flex-wrap gap-1.5">
								<Button
									variant={onlyErrorTurns ? "secondary" : "outline"}
									size="sm"
									className="h-6 px-2 text-[10px]"
									onClick={() => setOnlyErrorTurns((value) => !value)}
								>
									error turns
								</Button>
								<Button
									variant={onlyToolTurns ? "secondary" : "outline"}
									size="sm"
									className="h-6 px-2 text-[10px]"
									onClick={() => setOnlyToolTurns((value) => !value)}
								>
									tool turns
								</Button>
							</div>
						</div>
						{filteredTimelineEntries.length === 0 ? (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								Assistant turns will appear here once the conversation starts.
							</div>
						) : (
							<div className="space-y-2">
								{filteredTimelineEntries.map((entry, index) => {
									if (entry.type === "boundary") {
										const Icon = boundaryIcon(entry.segmentKind);
										return (
											<button
												key={entry.id}
												type="button"
												className="w-full rounded-lg border border bg-background/50 p-3 text-left transition-colors hover:bg-secondary"
												onClick={() => onSelectMessage?.(entry.messageId)}
											>
												<div className="flex items-center gap-2 mb-1.5">
													<Icon className="w-3.5 h-3.5 text-muted-foreground" />
													<span className="text-xs font-semibold uppercase tracking-wide">
														{entry.title}
													</span>
													<Badge
														variant={boundaryBadgeVariant(entry.segmentKind)}
														className="ml-auto text-[10px]"
													>
														{entry.segmentKind}
													</Badge>
												</div>
												<div className="text-xs text-muted-foreground break-words">
													{entry.summary}
												</div>
											</button>
										);
									}

									const turn = entry.turn;
									const isExpanded = expandedTurnIds.includes(turn.messageId);
									const isLatest = !filteredTimelineEntries
										.slice(0, index)
										.some((item) => item.type === "turn");
									const status = turnStatusLabel(
										turn,
										isLatest,
										isProcessing,
										stdinPrompt,
									);

									return (
										<div key={entry.id} className="rounded-lg border bg-card">
											<div className="p-3 space-y-2">
												<div className="flex items-start gap-2">
													<button
														type="button"
														className="mt-0.5 text-muted-foreground"
														onClick={() => toggleTurn(turn.messageId)}
													>
														{isExpanded ? (
															<ChevronDown className="w-4 h-4" />
														) : (
															<ChevronRight className="w-4 h-4" />
														)}
													</button>
													<div className="min-w-0 flex-1 space-y-1">
														<div className="flex items-center gap-2 flex-wrap">
															<span className="text-xs font-semibold uppercase tracking-wide">
																Turn {turn.turnNumber}
															</span>
															<Badge
																variant={status.variant}
																className="text-[10px]"
															>
																{status.label}
															</Badge>
															{isLatest && (
																<Badge
																	variant="secondary"
																	className="text-[10px]"
																>
																	latest
																</Badge>
															)}
														</div>
														<div className="text-xs text-muted-foreground break-words">
															{turn.assistantPreview ||
																"(no assistant preview)"}
														</div>
													</div>
													<Button
														variant="ghost"
														size="sm"
														className="h-7 px-2 text-[10px]"
														onClick={() => onSelectMessage?.(turn.messageId)}
													>
														Jump
														<ArrowUpRight className="w-3 h-3 ml-1" />
													</Button>
												</div>

												<div className="flex items-center gap-2 flex-wrap pl-6">
													<Badge variant="outline" className="text-[10px]">
														tools:{turn.totalToolCount}
													</Badge>
													{turn.runningToolCount > 0 && (
														<Badge variant="default" className="text-[10px]">
															active:{turn.runningToolCount}
														</Badge>
													)}
													{turn.tokenUsage && (
														<Badge
															variant="outline"
															className="text-[10px] font-mono"
														>
															↑{turn.tokenUsage.input} ↓{turn.tokenUsage.output}
															{turn.tokenUsage.cacheReadInput !== undefined &&
																turn.tokenUsage.cacheReadInput > 0 && (
																	<span className="text-emerald-600 dark:text-emerald-400 ml-1">
																		cache↑{turn.tokenUsage.cacheReadInput}
																	</span>
																)}
															{turn.tokenUsage.cacheCreationInput !==
																undefined &&
																turn.tokenUsage.cacheCreationInput > 0 && (
																	<span className="text-amber-600 dark:text-amber-400 ml-1">
																		write↑{turn.tokenUsage.cacheCreationInput}
																	</span>
																)}
														</Badge>
													)}
												</div>
											</div>

											{isExpanded && (
												<div className="border-t px-3 py-3 space-y-3">
													<div className="pl-6 space-y-3">
														<div>
															<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
																User prompt
															</div>
															<div className="text-xs break-words">
																{turn.userPrompt ||
																	"No preceding user prompt captured."}
															</div>
														</div>

														<div>
															<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
																Assistant summary
															</div>
															<div className="text-xs text-muted-foreground break-words">
																{turn.assistantPreview ||
																	"No assistant preview available."}
															</div>
														</div>

														<div>
															<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
																Tools in this turn
															</div>
															{turn.tools.length === 0 ? (
																<div className="rounded-md border border p-2 text-xs text-muted-foreground">
																	No tools used in this turn.
																</div>
															) : (
																<div className="space-y-2">
																	{turn.tools.map((tool, toolIndex) => (
																		<div
																			key={`${turn.messageId}-${tool.id}-${toolIndex}`}
																			className="space-y-2"
																		>
																			<div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide">
																				<Wrench className="w-3 h-3" />
																				{tool.name}
																			</div>
																			<ToolCard tool={tool} />
																		</div>
																	))}
																</div>
															)}
														</div>
													</div>
												</div>
											)}
										</div>
									);
								})}
							</div>
						)}
					</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Inspector
							</div>
							<Badge variant="outline" className="text-[10px]">
								{selectedSwarmTask
									? "swarm task"
									: selectedMessage
										? selectedMessage.role
										: "idle"}
							</Badge>
						</div>
						{!selectedSwarmTask && !selectedMessage ? (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								Select a turn, boundary, runtime event, or swarm task to inspect
								details here.
							</div>
						) : selectedSwarmTask ? (
							<div className="rounded-lg border bg-card p-3 space-y-3 text-xs">
								<div className="flex items-center gap-2 flex-wrap">
									<Badge variant="secondary" className="text-[10px] uppercase">
										task
									</Badge>
									<Badge
										variant={
											selectedSwarmTask.status
												.toLowerCase()
												.includes("block") ||
											selectedSwarmTask.status.toLowerCase().includes("fail")
												? "destructive"
												: "outline"
										}
										className="text-[10px] uppercase"
									>
										{selectedSwarmTask.status}
									</Badge>
									<Badge variant="outline" className="text-[10px] uppercase">
										{selectedSwarmTask.priority}
									</Badge>
									<Badge variant="outline" className="text-[10px] font-mono">
										{selectedSwarmTask.id}
									</Badge>
									{selectedTaskAssignee && (
										<Badge variant="outline" className="text-[10px]">
											assignee {selectedTaskAssignee.title}
										</Badge>
									)}
								</div>

								<div className="flex items-center justify-between gap-2">
									<div className="flex flex-wrap gap-1.5">
										{selectedSwarmTask.subsystem && (
											<Badge variant="outline" className="text-[10px]">
												{selectedSwarmTask.subsystem}
											</Badge>
										)}
										{(selectedSwarmTask.blockedBy?.length || 0) > 0 && (
											<Badge variant="outline" className="text-[10px]">
												blocked by {selectedSwarmTask.blockedBy?.length}
											</Badge>
										)}
										{(selectedSwarmTask.fileScope?.length || 0) > 0 && (
											<Badge variant="outline" className="text-[10px]">
												files {selectedSwarmTask.fileScope?.length}
											</Badge>
										)}
									</div>
									<div className="flex items-center gap-1">
										<Button
											variant={
												inspectorView === "parsed" ? "secondary" : "ghost"
											}
											size="sm"
											className="h-6 px-2 text-[10px]"
											onClick={() => setInspectorView("parsed")}
										>
											parsed
										</Button>
										<Button
											variant={inspectorView === "raw" ? "secondary" : "ghost"}
											size="sm"
											className="h-6 px-2 text-[10px]"
											onClick={() => setInspectorView("raw")}
										>
											raw
										</Button>
									</div>
								</div>

								<div>
									<div className="flex items-center justify-between mb-1">
										<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
											Task content
										</div>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 px-2 text-[10px]"
											onClick={() =>
												navigator.clipboard.writeText(
													selectedSwarmTask.content || "",
												)
											}
										>
											<Copy className="w-3 h-3 mr-1" />
											copy
										</Button>
									</div>
									<pre className="rounded border bg-secondary px-2 py-2 text-muted-foreground whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed">
										{inspectorView === "parsed"
											? formatJsonBlock(
													selectedSwarmTask.content || "(empty task body)",
													jsonView === "pretty",
												)
											: selectedSwarmTask.content || "(empty task body)"}
									</pre>
								</div>

								<div className="grid grid-cols-1 gap-2">
									<div>
										<div className="flex items-center justify-between mb-1">
											<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
												Blocking dependencies
											</div>
											{(selectedSwarmTask.blockedBy?.length || 0) > 0 && (
												<Button
													variant="ghost"
													size="sm"
													className="h-6 px-2 text-[10px]"
													onClick={() =>
														navigator.clipboard.writeText(
															(selectedSwarmTask.blockedBy || []).join("\n"),
														)
													}
												>
													<Copy className="w-3 h-3 mr-1" />
													copy
												</Button>
											)}
										</div>
										{(selectedSwarmTask.blockedBy?.length || 0) === 0 ? (
											<div className="rounded border border p-2 text-muted-foreground">
												No recorded dependencies.
											</div>
										) : (
											<div className="rounded border bg-secondary divide-y">
												{(selectedSwarmTask.blockedBy || []).map(
													(blockedId) => (
														<div
															key={blockedId}
															className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground"
														>
															{blockedId}
														</div>
													),
												)}
											</div>
										)}
									</div>

									<div>
										<div className="flex items-center justify-between mb-1">
											<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
												File scope
											</div>
											{(selectedSwarmTask.fileScope?.length || 0) > 0 && (
												<Button
													variant="ghost"
													size="sm"
													className="h-6 px-2 text-[10px]"
													onClick={() =>
														navigator.clipboard.writeText(
															(selectedSwarmTask.fileScope || []).join("\n"),
														)
													}
												>
													<Copy className="w-3 h-3 mr-1" />
													copy
												</Button>
											)}
										</div>
										{(selectedSwarmTask.fileScope?.length || 0) === 0 ? (
											<div className="rounded border border p-2 text-muted-foreground">
												No file scope recorded.
											</div>
										) : (
											<div className="rounded border bg-secondary divide-y">
												{(selectedSwarmTask.fileScope || []).map((file) => (
													<div
														key={file}
														className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground break-all"
													>
														{file}
													</div>
												))}
											</div>
										)}
									</div>
								</div>

								<div className="space-y-2">
									<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
										Related peers
									</div>
									{selectedTaskRelatedPeers.length === 0 ? (
										<div className="rounded border border p-2 text-muted-foreground">
											No related peer snapshot available.
										</div>
									) : (
										<div className="space-y-2">
											{selectedTaskRelatedPeers.map((peer) => (
												<div
													key={peer.sessionId}
													className="rounded border bg-secondary px-2 py-2 space-y-1.5"
												>
													<div className="flex items-start justify-between gap-2">
														<div className="min-w-0">
															<div className="font-medium truncate">
																{peer.title}
															</div>
															<div className="text-[11px] text-muted-foreground truncate">
																{peer.liveStatusDetail ||
																	peer.subtitle ||
																	peer.sessionId}
															</div>
														</div>
														<div className="flex flex-wrap gap-1">
															{peer.swarmRole && (
																<Badge
																	variant="outline"
																	className="text-[10px] uppercase"
																>
																	{peer.swarmRole}
																</Badge>
															)}
															{peer.livePhase && peer.livePhase !== "idle" && (
																<Badge
																	variant="secondary"
																	className="text-[10px]"
																>
																	{peer.livePhase === "tool"
																		? peer.liveToolName || "tool"
																		: peer.livePhase}
																</Badge>
															)}
															{peer.status && (
																<Badge
																	variant={
																		peer.status
																			.toLowerCase()
																			.includes("fail") ||
																		peer.status.toLowerCase().includes("error")
																			? "destructive"
																			: "outline"
																	}
																	className="text-[10px] uppercase"
																>
																	{peer.status}
																</Badge>
															)}
														</div>
													</div>
													{onSelectSession &&
														peer.sessionId !== activeSessionId && (
															<Button
																variant="ghost"
																size="sm"
																className="h-6 px-2 text-[10px]"
																onClick={() => onSelectSession(peer.sessionId)}
															>
																Open session
																<ArrowUpRight className="w-3 h-3 ml-1" />
															</Button>
														)}
												</div>
											))}
										</div>
									)}
								</div>
							</div>
						) : selectedMessage ? (
							<div className="rounded-lg border bg-card p-3 space-y-3 text-xs">
								<div className="flex items-center gap-2 flex-wrap">
									<Badge variant="secondary" className="text-[10px] uppercase">
										{selectedMessage.role}
									</Badge>
									{selectedMessage.toolExecutions.length > 0 && (
										<Badge variant="outline" className="text-[10px]">
											{selectedMessage.toolExecutions.length} tools
										</Badge>
									)}
									{selectedMessage.images &&
										selectedMessage.images.length > 0 && (
											<Badge variant="outline" className="text-[10px]">
												{selectedMessage.images.length} images
											</Badge>
										)}
									{selectedMessage.tokenUsage && (
										<Badge variant="outline" className="text-[10px] font-mono">
											↑{selectedMessage.tokenUsage.input} ↓
											{selectedMessage.tokenUsage.output}
											{selectedMessage.tokenUsage.cacheReadInput !==
												undefined &&
												selectedMessage.tokenUsage.cacheReadInput > 0 && (
													<span className="text-emerald-600 dark:text-emerald-400 ml-1">
														cache↑{selectedMessage.tokenUsage.cacheReadInput}
													</span>
												)}
											{selectedMessage.tokenUsage.cacheCreationInput !==
												undefined &&
												selectedMessage.tokenUsage.cacheCreationInput > 0 && (
													<span className="text-amber-600 dark:text-amber-400 ml-1">
														write↑
														{selectedMessage.tokenUsage.cacheCreationInput}
													</span>
												)}
										</Badge>
									)}
								</div>
								<div className="flex items-center justify-between gap-2">
									{selectedMessageFacts(selectedMessage).length > 0 ? (
										<div className="flex flex-wrap gap-1.5">
											{selectedMessageFacts(selectedMessage).map((fact) => (
												<Badge
													key={fact}
													variant="outline"
													className="text-[10px]"
												>
													{fact}
												</Badge>
											))}
										</div>
									) : (
										<div />
									)}
									<div className="flex items-center gap-1">
										<Button
											variant={
												inspectorView === "parsed" ? "secondary" : "ghost"
											}
											size="sm"
											className="h-6 px-2 text-[10px]"
											onClick={() => setInspectorView("parsed")}
										>
											parsed
										</Button>
										<Button
											variant={inspectorView === "raw" ? "secondary" : "ghost"}
											size="sm"
											className="h-6 px-2 text-[10px]"
											onClick={() => setInspectorView("raw")}
										>
											raw
										</Button>
									</div>
								</div>
								{inspectorView === "parsed" &&
									selectedMessage.role === "system" &&
									systemFields(selectedMessage).length > 0 && (
										<div className="space-y-2">
											<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
												Structured fields
											</div>
											<div className="rounded border bg-secondary divide-y">
												{systemFields(selectedMessage).map((field) => (
													<div
														key={`${field.label}-${field.value}`}
														className="flex items-start justify-between gap-3 px-2 py-1.5"
													>
														<span className="text-[10px] uppercase tracking-wide text-muted-foreground">
															{field.label}
														</span>
														<span className="text-[11px] break-words text-right">
															{field.value}
														</span>
													</div>
												))}
											</div>
										</div>
									)}
								<div>
									<div className="flex items-center justify-between mb-1">
										<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
											Content view
										</div>
										<div className="flex items-center gap-1">
											<Button
												variant={jsonView === "pretty" ? "secondary" : "ghost"}
												size="sm"
												className="h-6 px-2 text-[10px]"
												onClick={() => setJsonView("pretty")}
											>
												pretty
											</Button>
											<Button
												variant={jsonView === "raw" ? "secondary" : "ghost"}
												size="sm"
												className="h-6 px-2 text-[10px]"
												onClick={() => setJsonView("raw")}
											>
												raw
											</Button>
											<Button
												variant="ghost"
												size="sm"
												className="h-6 px-2 text-[10px]"
												onClick={() =>
													navigator.clipboard.writeText(
														selectedMessage.content || "",
													)
												}
											>
												<Copy className="w-3 h-3 mr-1" />
												copy
											</Button>
										</div>
									</div>
									<pre className="rounded border bg-secondary px-2 py-2 text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed">
										{inspectorView === "parsed"
											? formatJsonBlock(
													selectedMessage.content || "(empty message body)",
													jsonView === "pretty",
												)
											: selectedMessage.content || "(empty message body)"}
									</pre>
								</div>
								{selectedMessage.images &&
									selectedMessage.images.length > 0 && (
										<div className="space-y-2">
											<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
												Image preview
											</div>
											{selectedImage && (
												<div className="rounded-md border bg-secondary p-2 space-y-2">
													<img
														src={imageSrc(selectedImage)}
														alt={selectedImage.label || "Selected"}
														className="w-full h-48 object-contain rounded border bg-background"
													/>
													<div className="flex items-center justify-between gap-2">
														<div className="text-[10px] text-muted-foreground break-words">
															{selectedImage.label ||
																selectedImage.filePath ||
																selectedImage.mediaType}
														</div>
														<div className="flex items-center gap-1">
															<Button
																variant="ghost"
																size="sm"
																className="h-6 px-2 text-[10px]"
																onClick={() =>
																	navigator.clipboard.writeText(
																		selectedImage.filePath ||
																			selectedImage.label ||
																			selectedImage.mediaType,
																	)
																}
															>
																<Copy className="w-3 h-3 mr-1" />
																copy
															</Button>
															<Button
																variant="ghost"
																size="sm"
																className="h-6 px-2 text-[10px]"
																onClick={() =>
																	window.open(
																		imageSrc(selectedImage),
																		"_blank",
																		"noopener,noreferrer",
																	)
																}
															>
																<ExternalLink className="w-3 h-3 mr-1" />
																open
															</Button>
														</div>
													</div>
												</div>
											)}
											<div className="grid grid-cols-3 gap-2">
												{selectedMessage.images.map((image, index) => (
													<button
														key={image.id}
														type="button"
														className={cn(
															"rounded-md border bg-secondary p-1.5 space-y-1 text-left",
															index === selectedImageIndex &&
																"ring-1 ring-primary/40 bg-primary/5",
														)}
														onClick={() => setSelectedImageIndex(index)}
													>
														<img
															src={imageSrc(image)}
															alt={image.label || "Selected"}
															className="w-full h-16 object-cover rounded border bg-background"
														/>
														<div className="text-[10px] text-muted-foreground truncate">
															{image.label || image.mediaType}
														</div>
													</button>
												))}
											</div>
										</div>
									)}
								{selectedMessage.toolExecutions.length > 0 && (
									<div className="space-y-2">
										<div className="flex items-center justify-between">
											<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
												Tool drill-down
											</div>
											<Badge variant="outline" className="text-[10px]">
												focus {selectedToolIndex + 1}/
												{selectedMessage.toolExecutions.length}
											</Badge>
										</div>
										<div className="flex flex-wrap gap-1.5">
											{selectedMessage.toolExecutions.map((tool, toolIndex) => (
												<Button
													key={`${selectedMessage.id}-${tool.id}-${toolIndex}-focus`}
													variant={
														toolIndex === selectedToolIndex
															? "secondary"
															: "outline"
													}
													size="sm"
													className="h-6 px-2 text-[10px]"
													onClick={() => setSelectedToolIndex(toolIndex)}
												>
													{tool.name}
												</Button>
											))}
										</div>
										{selectedTool && (
											<>
												<ToolCard tool={selectedTool} />
												<div className="grid grid-cols-1 gap-2">
													{selectedTool.input && (
														<div>
															<div className="flex items-center justify-between mb-1">
																<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
																	Focus tool input
																</div>
																<Button
																	variant="ghost"
																	size="sm"
																	className="h-6 px-2 text-[10px]"
																	onClick={() =>
																		navigator.clipboard.writeText(
																			selectedTool.input,
																		)
																	}
																>
																	<Copy className="w-3 h-3 mr-1" />
																	copy
																</Button>
															</div>
															<pre className="rounded border bg-secondary px-2 py-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
																{formatJsonBlock(
																	selectedTool.input,
																	jsonView === "pretty",
																)}
															</pre>
														</div>
													)}
													{(selectedTool.output || selectedTool.error) && (
														<div>
															<div className="flex items-center justify-between mb-1">
																<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
																	Focus tool output
																</div>
																<Button
																	variant="ghost"
																	size="sm"
																	className="h-6 px-2 text-[10px]"
																	onClick={() =>
																		navigator.clipboard.writeText(
																			selectedTool.output ||
																				selectedTool.error ||
																				"",
																		)
																	}
																>
																	<Copy className="w-3 h-3 mr-1" />
																	copy
																</Button>
															</div>
															<pre className="rounded border bg-secondary px-2 py-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
																{formatJsonBlock(
																	selectedTool.output ||
																		selectedTool.error ||
																		"",
																	jsonView === "pretty",
																)}
															</pre>
														</div>
													)}
												</div>
											</>
										)}
										{selectedMessage.toolExecutions.length > 1 && (
											<details className="rounded-md border bg-muted/10 p-2">
												<summary className="cursor-pointer text-[10px] uppercase tracking-wide text-muted-foreground">
													show all tools
												</summary>
												<div className="space-y-2 mt-2">
													{selectedMessage.toolExecutions.map(
														(tool, toolIndex) => (
															<ToolCard
																key={`${selectedMessage.id}-${tool.id}-${toolIndex}`}
																tool={tool}
															/>
														),
													)}
												</div>
											</details>
										)}
									</div>
								)}
							</div>
						) : null}
					</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Version
							</div>
						</div>
						{versionInfo ? (
							<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
								<div className="flex items-center justify-between gap-2">
									<span className="text-muted-foreground">Version</span>
									<span className="font-mono">{versionInfo.version}</span>
								</div>
								<div className="flex items-center justify-between gap-2">
									<span className="text-muted-foreground">Semver</span>
									<span className="font-mono">{versionInfo.semver}</span>
								</div>
								<div className="flex items-center justify-between gap-2">
									<span className="text-muted-foreground">Git</span>
									<span className="font-mono">
										{versionInfo.git_hash.slice(0, 8)}
									</span>
								</div>
								<div className="flex flex-wrap gap-1.5 pt-1">
									{versionInfo.release_build && (
										<Badge variant="secondary" className="text-[10px]">
											release
										</Badge>
									)}
									<Badge variant="outline" className="text-[10px] font-mono">
										{versionInfo.git_tag}
									</Badge>
								</div>
							</div>
						) : (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								Version info unavailable.
							</div>
						)}
					</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Authentication
							</div>
							<Badge variant="outline" className="text-[10px]">
								{authStatus?.providers.length ?? 0}
							</Badge>
						</div>
						{authStatus ? (
							<div className="space-y-2">
								{authStatus.providers.map((provider) => (
									<div
										key={provider.id}
										className="rounded-lg border bg-card p-3 space-y-1.5 text-xs"
									>
										<div className="flex items-center justify-between gap-2">
											<div className="flex items-center gap-1.5">
												{provider.configured ? (
													<ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
												) : (
													<Shield className="w-3.5 h-3.5 text-muted-foreground" />
												)}
												<span className="font-medium">
													{provider.display_name}
												</span>
											</div>
											<Badge
												variant={provider.configured ? "secondary" : "outline"}
												className="text-[10px]"
											>
												{provider.status}
											</Badge>
										</div>
										<div className="text-[11px] text-muted-foreground">
											{provider.method}
										</div>
										{provider.health && provider.health !== "ok" && (
											<div className="text-[11px] text-amber-600 dark:text-amber-400">
												{provider.health}
											</div>
										)}
										{provider.validation && (
											<div className="text-[11px] text-muted-foreground">
												validated: {provider.validation}
											</div>
										)}
									</div>
								))}
							</div>
						) : (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								Auth status unavailable.
							</div>
						)}
					</section>

				<Separator />

				<section className="space-y-2">
					<div className="flex items-center justify-between">
						<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Auth doctor
						</div>
						<div className="flex items-center gap-2">
							<Badge variant="outline" className="text-[10px]">
								{authDoctor?.needs_attention_count ?? "–"}
							</Badge>
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-[10px]"
								onClick={() => void refreshAuthDoctor()}
							>
								<Wrench className="w-3 h-3 mr-1" />
								Run
							</Button>
						</div>
					</div>
					{authDoctor ? (
						<div className="space-y-2">
							{authDoctor.needs_attention_count > 0 && (
								<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
									<div className="flex items-center gap-2">
										<TriangleAlert className="w-3.5 h-3.5 text-destructive" />
										<span className="font-medium">
											{authDoctor.needs_attention_count} provider{authDoctor.needs_attention_count === 1 ? "" : "s"} need attention
										</span>
									</div>
								</div>
							)}
							{authDoctor.providers.map((provider) => (
								<div
									key={provider.id}
									className="rounded-lg border bg-card p-3 space-y-1.5 text-xs"
								>
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-1.5">
											{provider.configured ? (
												<ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
											) : (
												<Shield className="w-3.5 h-3.5 text-muted-foreground" />
											)}
											<span className="font-medium">{provider.display_name}</span>
										</div>
										<Badge
											variant={
												provider.needs_attention ? "destructive" : provider.configured ? "secondary" : "outline"
											}
											className="text-[10px]"
										>
											{provider.status}
										</Badge>
									</div>
									{provider.diagnostics.length > 0 && (
										<div className="space-y-1">
											{provider.diagnostics.map((diag, i) => (
												<div
													key={i}
													className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"
												>
													<TriangleAlert className="w-3 h-3 mt-0.5 shrink-0" />
													<span>{diag}</span>
												</div>
											))}
										</div>
									)}
									{provider.recommended_actions.length > 0 && (
										<div className="space-y-1 pt-1">
											<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
												Recommended actions
											</div>
											{provider.recommended_actions.map((action, i) => (
												<div
													key={i}
													className="text-[11px] text-muted-foreground font-mono bg-secondary px-2 py-1 rounded"
												>
													{action}
												</div>
											))}
										</div>
									)}
									<div className="flex flex-wrap gap-1 pt-1">
										<Badge variant="outline" className="text-[10px]">
											{provider.credential_source}
										</Badge>
										<Badge variant="outline" className="text-[10px]">
											{provider.refresh_support}
										</Badge>
										<Badge variant="outline" className="text-[10px]">
											{provider.validation_method}
										</Badge>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
							Click “Run” to generate an auth diagnostic report.
						</div>
					)}
				</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Usage
							</div>
							<Badge variant="outline" className="text-[10px]">
								{usageInfo?.providers.length ?? 0}
							</Badge>
						</div>
						{usageInfo ? (
							<div className="space-y-2">
								{usageInfo.providers.map((provider) => (
									<div
										key={provider.provider_name}
										className="rounded-lg border bg-card p-3 space-y-1.5 text-xs"
									>
										<div className="flex items-center justify-between gap-2">
											<span className="font-medium">
												{provider.provider_name}
											</span>
											{provider.hard_limit_reached && (
												<Badge variant="destructive" className="text-[10px]">
													limit reached
												</Badge>
											)}
											{provider.error && (
												<Badge variant="outline" className="text-[10px]">
													error
												</Badge>
											)}
										</div>
										{provider.error && (
											<div className="text-[11px] text-destructive">
												{provider.error}
											</div>
										)}
										{provider.limits.map((limit) => (
											<div key={limit.name} className="space-y-1">
												<div className="flex items-center justify-between gap-2">
													<span className="text-muted-foreground">
														{limit.name}
													</span>
													<span className="font-mono">
														{Math.round(limit.usage_percent)}%
													</span>
												</div>
												<div className="h-1.5 rounded-full bg-secondary overflow-hidden">
													<div
														className="h-full rounded-full bg-primary transition-all"
														style={{
															width: `${Math.min(limit.usage_percent, 100)}%`,
															backgroundColor:
																limit.usage_percent > 90
																	? "#ef4444"
																	: limit.usage_percent > 70
																		? "#f59e0b"
																		: undefined,
														}}
													/>
												</div>
												{limit.resets_at && (
													<div className="text-[10px] text-muted-foreground">
														resets at {limit.resets_at}
													</div>
												)}
											</div>
										))}
										{provider.extra_info.length > 0 && (
											<div className="flex flex-wrap gap-1.5 pt-1">
												{provider.extra_info.map(([key, value]) => (
													<Badge
														key={key}
														variant="outline"
														className="text-[10px]"
													>
														{key}: {value}
													</Badge>
												))}
											</div>
										)}
									</div>
								))}
							</div>
						) : (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								Usage info unavailable.
							</div>
						)}
					</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
								<BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
								Memory
							</div>
							<Badge variant="outline" className="text-[10px]">
								{memoryStats?.total ?? "—"}
							</Badge>
						</div>
						<div className="flex flex-wrap gap-1">
							{(["all", "project", "global"] as const).map((scope) => (
								<button
									key={scope}
									className={cn(
										"px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors",
										memoryScope === scope
											? "bg-primary text-primary-foreground"
											: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
									)}
									onClick={() => setMemoryScope(scope)}
								>
									{scope}
								</button>
							))}
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								className="h-7 text-[10px]"
								onClick={async () => {
									try {
										const path = await save({
											filters: [{ name: "JSON", extensions: ["json"] }],
											defaultPath: "jcode-memories.json",
										});
										if (path && exportMemories) {
											await exportMemories(path);
										}
									} catch {
										// ignore
									}
								}}
							>
								Export
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="h-7 text-[10px]"
								onClick={async () => {
									try {
										const selected = await open({
											filters: [{ name: "JSON", extensions: ["json"] }],
											multiple: false,
										});
										if (
											selected &&
											typeof selected === "string" &&
											importMemories
										) {
											const result = await importMemories(selected);
											if (result) {
												// Refresh stats and entries after import
												const stats =
													await invoke<MemoryStats>("get_memory_stats");
												setMemoryStats(stats);
												const list = await invoke<{ memories: MemoryEntry[] }>(
													"get_memory_list",
													{ scope: memoryScope },
												);
												setMemoryEntries(list.memories.slice(0, 20));
											}
										}
									} catch {
										// ignore
									}
								}}
							>
								Import
							</Button>
						</div>
						{memoryStats ? (
							<div className="space-y-2">
								<div className="grid grid-cols-3 gap-2">
									<div className="rounded border bg-secondary px-2 py-2">
										<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
											Project
										</div>
										<div className="text-sm font-medium">
											{memoryStats.project_count}
										</div>
									</div>
									<div className="rounded border bg-secondary px-2 py-2">
										<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
											Global
										</div>
										<div className="text-sm font-medium">
											{memoryStats.global_count}
										</div>
									</div>
									<div className="rounded border bg-secondary px-2 py-2">
										<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
											Tags
										</div>
										<div className="text-sm font-medium">
											{memoryStats.unique_tags}
										</div>
									</div>
								</div>
								{Object.entries(memoryStats.categories).length > 0 && (
									<div className="flex flex-wrap gap-1.5">
										{Object.entries(memoryStats.categories).map(
											([cat, count]) => (
												<Badge
													key={cat}
													variant="outline"
													className="text-[10px]"
												>
													{cat}: {count}
												</Badge>
											),
										)}
									</div>
								)}
							</div>
						) : (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								Memory stats unavailable.
							</div>
						)}
						{memoryEntries && memoryEntries.length > 0 && (
							<div className="space-y-2">
								<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
									Recent entries ({memoryEntries.length})
								</div>
								{memoryEntries.map((entry) => (
									<div
										key={entry.id}
										className="rounded border bg-secondary px-2 py-2 space-y-1 text-xs"
									>
										<div className="flex items-start justify-between gap-2">
											<div className="font-medium break-words">
												{compactText(entry.content, 80)}
											</div>
											<Badge variant="outline" className="text-[10px] shrink-0">
												{entry.category}
											</Badge>
										</div>
										<div className="flex flex-wrap gap-1">
											{entry.tags.map((tag) => (
												<Badge
													key={tag}
													variant="secondary"
													className="text-[10px]"
												>
													{tag}
												</Badge>
											))}
										</div>
										<div className="flex items-center justify-between text-[10px] text-muted-foreground">
											<span>
												trust {entry.trust} · conf{" "}
												{Math.round(entry.effective_confidence * 100)}%
											</span>
											<span>{entry.access_count} reads</span>
										</div>
									</div>
								))}
							</div>
						)}
					</section>

					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
								<Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
								Devices
							</div>
							<Badge variant="outline" className="text-[10px]">
								{pairedDevices?.length ?? "—"}
							</Badge>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								className="h-7 text-[10px]"
								onClick={async () => {
									try {
										const code = await invoke<string>("generate_pairing_code");
										setPairingCode(code);
										void refreshDevices();
									} catch {
										// ignore
									}
								}}
							>
								Generate pairing code
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-[10px]"
								onClick={() => void refreshDevices()}
							>
								Refresh
							</Button>
						</div>
						{pairingCode && (
							<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
								<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
									Pairing code
								</div>
								<div className="text-2xl font-mono font-bold tracking-widest text-center">
									{pairingCode}
								</div>
								<div className="text-[10px] text-muted-foreground text-center">
									Valid for 5 minutes
								</div>
							</div>
						)}
						{pairedDevices && pairedDevices.length > 0 ? (
							<div className="space-y-2">
								{pairedDevices.map((device) => (
									<div
										key={device.id}
										className="rounded border bg-secondary px-2 py-2 space-y-1 text-xs"
									>
										<div className="flex items-start justify-between gap-2">
											<div className="font-medium">{device.name}</div>
											<Button
												variant="ghost"
												size="sm"
												className="h-5 px-1.5 text-[10px] text-destructive"
												onClick={async () => {
													try {
														await invoke("revoke_device", {
															deviceId: device.id,
														});
														void refreshDevices();
													} catch {
														// ignore
													}
												}}
											>
												Revoke
											</Button>
										</div>
										<div className="text-[10px] text-muted-foreground font-mono">
											{device.id}
										</div>
										<div className="text-[10px] text-muted-foreground">
											Last seen {device.last_seen}
										</div>
									</div>
								))}
							</div>
						) : (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								No paired devices.
							</div>
						)}
					</section>

					<Separator />
					<Separator />

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
								<Clock3 className="w-3.5 h-3.5 text-muted-foreground" />
								Background tasks
							</div>
							<Badge variant="outline" className="text-[10px]">
								{backgroundTasks?.length ?? "—"}
							</Badge>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								className="h-7 text-[10px]"
								onClick={async () => {
									if (!listBackgroundTasks) return;
									try {
										const tasks = await listBackgroundTasks();
										setBackgroundTasks(tasks);
									} catch {
										// ignore
									}
								}}
							>
								Refresh
							</Button>
						</div>
						{backgroundTasks && backgroundTasks.length > 0 ? (
							<div className="space-y-2">
								{backgroundTasks.slice(0, 10).map((task) => (
									<div
										key={task.task_id}
										className="rounded border bg-secondary px-2 py-2 space-y-1 text-xs"
									>
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0">
												<div className="font-medium">
													{task.display_name || task.tool_name}
												</div>
												<div className="text-[10px] text-muted-foreground font-mono">
													{task.task_id}
												</div>
											</div>
											<div className="flex flex-wrap gap-1">
												<Badge
													variant={
														task.status === "running"
															? "default"
															: task.status === "completed"
																? "secondary"
																: "outline"
													}
													className="text-[10px] uppercase"
												>
													{task.status}
												</Badge>
												{task.detached && (
													<Badge variant="outline" className="text-[10px]">
														detached
													</Badge>
												)}
											</div>
										</div>
										{task.progress && (
											<div className="space-y-1">
												{task.progress.percent !== undefined && (
													<div className="h-1.5 rounded-full bg-muted overflow-hidden">
														<div
															className="h-full bg-primary transition-all"
															style={{
																width: `${Math.min(task.progress.percent, 100)}%`,
															}}
														/>
													</div>
												)}
												<div className="text-[10px] text-muted-foreground">
													{task.progress.message || ""}
													{task.progress.current !== undefined &&
													task.progress.total !== undefined
														? ` (${task.progress.current}/${task.progress.total})`
														: ""}
												</div>
											</div>
										)}
										{task.status === "running" && cancelBackgroundTask && (
											<Button
												variant="ghost"
												size="sm"
												className="h-5 px-1.5 text-[10px] text-destructive"
												onClick={async () => {
													try {
														await cancelBackgroundTask(task.task_id);
														if (listBackgroundTasks) {
															const tasks = await listBackgroundTasks();
															setBackgroundTasks(tasks);
														}
													} catch {
														// ignore
													}
												}}
											>
												Cancel
											</Button>
										)}
									</div>
								))}
							</div>
						) : (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								No background tasks found.
							</div>
						)}
					</section>

				<Separator />

				<section className="space-y-2">
					<div className="flex items-center justify-between">
						<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Ambient
						</div>
						<div className="flex items-center gap-2">
							<Badge variant="outline" className="text-[10px]">
								{ambientStatus?.scheduled_count ?? "–"}
							</Badge>
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-[10px]"
								onClick={() => {
									void refreshAmbient();
									void refreshAmbientTranscripts();
								}}
							>
								<RotateCcw className="w-3 h-3 mr-1" />
								Refresh
							</Button>
						</div>
					</div>
					{ambientStatus ? (
						<div className="space-y-2">
							<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
								<div className="flex items-center justify-between gap-2">
									<div className="flex items-center gap-1.5">
										<Moon className="w-3.5 h-3.5 text-muted-foreground" />
										<span className="font-medium">Status</span>
									</div>
									<Badge
										variant={
											ambientStatus.status === "running"
												? "default"
												: ambientStatus.status === "scheduled"
													? "secondary"
													: "outline"
										}
										className="text-[10px] uppercase"
									>
										{ambientStatus.status}
									</Badge>
								</div>
								{!ambientStatus.enabled && (
									<div className="text-[11px] text-muted-foreground">
										Ambient mode is disabled in configuration.
									</div>
								)}
								{ambientStatus.last_run && (
									<div className="flex items-center justify-between gap-2">
										<span className="text-muted-foreground">Last run</span>
										<span className="font-mono">{new Date(ambientStatus.last_run).toLocaleString()}</span>
									</div>
								)}
								{ambientStatus.total_cycles > 0 && (
									<div className="flex items-center justify-between gap-2">
										<span className="text-muted-foreground">Total cycles</span>
										<span className="font-mono">{ambientStatus.total_cycles}</span>
									</div>
								)}
								{ambientStatus.last_summary && (
									<div className="rounded border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground">
										{ambientStatus.last_summary}
									</div>
								)}
								{ambientStatus.next_wake && (
									<div className="flex items-center justify-between gap-2">
										<span className="inline-flex items-center gap-1.5 text-muted-foreground">
											<Timer className="w-3.5 h-3.5" />
											Next wake
										</span>
										<span className="font-mono">{new Date(ambientStatus.next_wake).toLocaleString()}</span>
									</div>
								)}
								<div className="flex flex-wrap gap-1 pt-1">
									{ambientStatus.last_compactions !== undefined && (
										<Badge variant="outline" className="text-[10px]">
											compactions {ambientStatus.last_compactions}
										</Badge>
									)}
									{ambientStatus.last_memories_modified !== undefined && (
										<Badge variant="outline" className="text-[10px]">
											memories {ambientStatus.last_memories_modified}
										</Badge>
									)}
								</div>
							</div>
							{ambientStatus.scheduled_items.length > 0 && (
								<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
									<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
										Scheduled items
									</div>
									<div className="space-y-2">
										{ambientStatus.scheduled_items.map((item) => (
											<div
												key={item.id}
												className="rounded border bg-secondary px-2 py-2 space-y-1"
											>
												<div className="flex items-start justify-between gap-2">
													<div className="min-w-0">
														<div className="font-medium break-words">
															{item.task_description || item.context}
														</div>
														<div className="text-[10px] text-muted-foreground font-mono">
															{item.id}
														</div>
													</div>
													<div className="flex flex-wrap gap-1">
														<Badge variant="outline" className="text-[10px] uppercase">
															{item.priority}
														</Badge>
														<Badge variant="outline" className="text-[10px]">
															{item.target.kind}
														</Badge>
													</div>
												</div>
												<div className="text-[10px] text-muted-foreground">
													{new Date(item.scheduled_for).toLocaleString()}
												</div>
											</div>
										))}
									</div>
								</div>
							)}
							{ambientTranscripts && ambientTranscripts.length > 0 && (
								<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
									<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
										Recent transcripts
									</div>
									<div className="space-y-2">
										{ambientTranscripts.slice(0, 5).map((tx) => (
											<div
												key={tx.session_id + tx.started_at}
												className="rounded border bg-secondary px-2 py-2 space-y-1"
											>
												<div className="flex items-center justify-between gap-2">
													<span className="font-medium">
														{tx.provider} · {tx.model}
													</span>
													<Badge
														variant={
															tx.status === "complete" ? "secondary" : "outline"
														}
														className="text-[10px]"
													>
														{tx.status}
													</Badge>
												</div>
												<div className="text-[10px] text-muted-foreground">
													{new Date(tx.started_at).toLocaleString()}
													{tx.ended_at ? ` – ${new Date(tx.ended_at).toLocaleString()}` : ""}
												</div>
												{tx.summary && (
													<div className="text-[11px] text-muted-foreground break-words">
														{tx.summary}
													</div>
												)}
												<div className="flex flex-wrap gap-1">
													<Badge variant="outline" className="text-[10px]">
														{tx.compactions} compactions
													</Badge>
													<Badge variant="outline" className="text-[10px]">
														{tx.memories_modified} memories
													</Badge>
													<Badge variant="outline" className="text-[10px]">
														{tx.pending_permissions} pending permissions
													</Badge>
												</div>
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					) : (
						<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
							Ambient status unavailable.
						</div>
					)}
				</section>

					<section className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Runtime events
							</div>
							<Badge variant="outline" className="text-[10px]">
								{filteredRuntimeEvents.length}
							</Badge>
						</div>
						<div className="flex flex-wrap gap-1">
							{(
								[
									"all",
									"compaction",
									"rewind",
									"stdin",
									"queue",
									"memory",
									"reasoning",
									"connection",
									"other",
								] as const
							).map((kind) => (
								<button
									key={kind}
									className={cn(
										"px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors",
										runtimeFilter === kind
											? "bg-primary text-primary-foreground"
											: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
									)}
									onClick={() => setRuntimeFilter(kind)}
								>
									{kind}
								</button>
							))}
						</div>
						{filteredRuntimeEvents.length === 0 ? (
							<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
								System notices, queued prompts, stdin requests, and compaction
								events will show here.
							</div>
						) : (
							<div className="space-y-2">
								{filteredRuntimeEvents.map((event) => (
									<button
										key={event.messageId}
										type="button"
										className="w-full rounded-lg border bg-card p-3 text-left text-xs transition-colors hover:bg-secondary"
										onClick={() => onSelectMessage?.(event.messageId)}
									>
										<div className="flex items-center gap-2 mb-1.5">
											<MessageSquareText className="w-3.5 h-3.5 text-muted-foreground" />
											<span className="font-medium">{event.title}</span>
											<Badge
												variant={runtimeEventVariant(event.kind)}
												className="ml-auto text-[10px]"
											>
												{event.kind}
											</Badge>
										</div>
										<div className="text-muted-foreground break-words">
											{event.detail}
										</div>
									</button>
								))}
							</div>
						)}
					</section>
				</div>
			</ScrollArea>
		</aside>
	);
}
