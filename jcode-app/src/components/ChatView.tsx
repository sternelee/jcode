import { useEffect, useMemo, useState } from "react";
import type { ChatMessage } from "@/types";
import { MessageBubble, SkeletonMessage } from "./MessageBubble";
import { InputArea } from "./InputArea";
import {
	Trash2,
	Undo2,
	ArrowDownWideNarrow,
	MessageSquare,
	Keyboard,
	ChevronDown,
	ChevronUp,
	History,
	Layers3,
	Archive,
	RotateCcw,
	Clock3,
	Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
	ConversationEmptyState,
} from "@/components/ai-elements/conversation";

const RECENT_MESSAGE_WINDOW = 14;
const RECENT_SEGMENT_WINDOW = 3;

interface ChatViewProps {
	messages: ChatMessage[];
	isProcessing: boolean;
	reasoningEffort: string | null;
	memoryEnabled: boolean;
	connectionType: string | null;
	statusDetail: string | null;
	queuedDraftCount: number;
	stdinPromptActive?: boolean;
	selectedMessageId?: string | null;
	availableRoles?: string[];
	/** roleName → current model display string */
	roleModels?: Record<string, string>;
	isSlackMode?: boolean;
	/** Slack 模式下正在回复的角色名列表（用于渲染骨架屏） */
	respondingRoles?: string[];
	onSend: (
		content: string,
		images?: [string, string][],
		targetRole?: string,
	) => void;
	onQueueSend: (
		content: string,
		images?: [string, string][],
		targetRole?: string,
	) => void;
	onCancel: () => void;
	onClearChat: () => void;
	onRewindChat: () => void;
	onSetReasoningEffort: (effort: string) => void;
	onSetMemoryEnabled: (enabled: boolean) => void | Promise<void>;
	onCompactContext: () => void;
}

interface MessageSegment {
	id: string;
	messages: ChatMessage[];
	kind: "history" | "compaction" | "rewind" | "runtime" | "conversation";
}

function systemKind(message: ChatMessage): MessageSegment["kind"] | null {
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

function flattenSegments(segments: MessageSegment[]): ChatMessage[] {
	return segments.flatMap((segment) => segment.messages);
}

function segmentTitle(kind: MessageSegment["kind"]): string {
	switch (kind) {
		case "history":
			return "restored history";
		case "compaction":
			return "compaction boundary";
		case "rewind":
			return "rewind boundary";
		case "runtime":
			return "runtime boundary";
		default:
			return "conversation";
	}
}

function segmentIcon(kind: MessageSegment["kind"]) {
	switch (kind) {
		case "history":
			return History;
		case "compaction":
			return Archive;
		case "rewind":
			return RotateCcw;
		case "runtime":
			return Clock3;
		default:
			return Layers3;
	}
}

function segmentSummary(segment: MessageSegment): string | null {
	if (segment.kind === "conversation") {
		const turns = segment.messages.filter(
			(message) => message.role === "user" || message.role === "assistant",
		).length;
		return turns > 0 ? `${turns} turns` : null;
	}
	const firstMessage = segment.messages[0]?.content || "";
	if (segment.kind === "history") {
		const count = firstMessage.match(/\((\d+) messages\)/)?.[1];
		return count ? `${count} restored messages` : "restored session context";
	}
	if (segment.kind === "compaction") {
		const tokenSummary = firstMessage.match(/Tokens:\s*([^\n]+)/)?.[1];
		return tokenSummary || "context window compressed";
	}
	if (segment.kind === "rewind") {
		const target = firstMessage.match(/message\s+(\d+)/)?.[1];
		return target ? `rewound to message ${target}` : "conversation truncated";
	}
	return firstMessage.split("\n")[0] || null;
}

export function ChatView({
	messages,
	isProcessing,
	reasoningEffort,
	memoryEnabled,
	connectionType,
	statusDetail,
	queuedDraftCount,
	stdinPromptActive,
	selectedMessageId,
	availableRoles,
	roleModels,
	isSlackMode = false,
	respondingRoles = [],
	onSend,
	onQueueSend,
	onCancel,
	onClearChat,
	onRewindChat,
	onSetReasoningEffort,
	onSetMemoryEnabled,
	onCompactContext,
}: ChatViewProps) {
	const [showEarlierMessages, setShowEarlierMessages] = useState(false);

	// 骨架屏：正在生成但还没有 streaming 内容的角色
	const streamingRoleNames = new Set(
		messages
			.filter((m) => m.role === "assistant" && m.isStreaming && m.roleName)
			.map((m) => m.roleName!),
	);
	// Slack 模式：只对「正在处理但还未开始 streaming」的角色显示骨架屏
	const skeletonRoles = respondingRoles.filter(
		(r) => !streamingRoleNames.has(r),
	);
	// 普通模式：processing 且还没有任何 streaming 消息时显示通用骨架屏
	const showGenericSkeleton =
		!isSlackMode &&
		isProcessing &&
		!messages.some((m) => m.role === "assistant" && m.isStreaming) &&
		messages.some((m) => m.role === "user");

	const collapseState = useMemo(() => {
		const segments = buildSegments(messages);
		const shouldCollapseBySegment = segments.length > RECENT_SEGMENT_WINDOW;
		const shouldCollapseByCount = messages.length > RECENT_MESSAGE_WINDOW;
		const shouldCollapse = shouldCollapseBySegment || shouldCollapseByCount;

		if (!shouldCollapse || showEarlierMessages) {
			return {
				hiddenSegments: [] as MessageSegment[],
				visibleSegments: segments,
				hiddenMessages: [] as ChatMessage[],
				hasHiddenHistory: false,
				hiddenConversationCount: 0,
				hiddenSegmentCount: 0,
			};
		}

		let hiddenSegments: MessageSegment[] = [];
		let visibleSegments: MessageSegment[] = segments;

		if (shouldCollapseBySegment) {
			hiddenSegments = segments.slice(0, -RECENT_SEGMENT_WINDOW);
			visibleSegments = segments.slice(-RECENT_SEGMENT_WINDOW);
		} else {
			const splitAt = Math.max(0, messages.length - RECENT_MESSAGE_WINDOW);
			hiddenSegments = [
				{
					id: "segment-hidden-legacy",
					kind: "conversation" as const,
					messages: messages.slice(0, splitAt),
				},
			].filter((segment) => segment.messages.length > 0);
			visibleSegments = [
				{
					id: "segment-visible-legacy",
					kind: "conversation" as const,
					messages: messages.slice(splitAt),
				},
			];
		}

		const hiddenMessages = flattenSegments(hiddenSegments);
		return {
			hiddenSegments,
			visibleSegments,
			hiddenMessages,
			hasHiddenHistory: hiddenSegments.some(
				(segment) => segment.kind === "history",
			),
			hiddenConversationCount: hiddenMessages.filter(
				(message) => message.role === "user" || message.role === "assistant",
			).length,
			hiddenSegmentCount: hiddenSegments.length,
		};
	}, [messages, showEarlierMessages]);

	useEffect(() => {
		if (!selectedMessageId) return;
		const isHidden = collapseState.hiddenMessages.some(
			(message) => message.id === selectedMessageId,
		);
		if (isHidden) {
			setShowEarlierMessages(true);
		}
	}, [selectedMessageId, collapseState.hiddenMessages]);

	useEffect(() => {
		if (!selectedMessageId) return;
		const target = document.querySelector(
			`[data-message-id="${selectedMessageId}"]`,
		);
		if (target instanceof HTMLElement) {
			target.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}, [selectedMessageId, showEarlierMessages, messages.length]);

	useEffect(() => {
		if (messages.length <= RECENT_MESSAGE_WINDOW) {
			setShowEarlierMessages(false);
		}
	}, [messages.length]);

	const renderSegment = (segment: MessageSegment, isVisibleRegion: boolean) => {
		const containsSelected = Boolean(
			selectedMessageId &&
				segment.messages.some((message) => message.id === selectedMessageId),
		);
		const Icon = segmentIcon(segment.kind);
		const summary = segmentSummary(segment);

		return (
			<div
				key={segment.id}
				className={cn(
					"space-y-2",
					segment.kind !== "conversation" && "mb-3",
					containsSelected &&
						"rounded-xl bg-primary/5 ring-1 ring-primary/20 px-2 py-2",
				)}
			>
				{segment.kind !== "conversation" && (
					<div className="flex items-center gap-2 px-3 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
						<Icon className="w-3.5 h-3.5" />
						<span>{segmentTitle(segment.kind)}</span>
						{summary && (
							<span className="text-[10px] normal-case px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
								{summary}
							</span>
						)}
						{!isVisibleRegion && (
							<span className="text-[10px] ml-auto px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
								hidden segment
							</span>
						)}
					</div>
				)}
				{segment.messages.map((msg) => (
					<MessageBubble
						key={msg.id}
						message={msg}
						isStreaming={isVisibleRegion && msg.isStreaming}
						isHighlighted={msg.id === selectedMessageId}
					/>
				))}
			</div>
		);
	};

	return (
		<div className="flex flex-col flex-1 overflow-hidden">
			<div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
					{isSlackMode ? (
						/* Slack 模式头部：显示 workspace 线程标识和实时状态 */
						<>
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<div className="w-2 h-2 rounded-full bg-emerald-500" />
								<span className="font-medium">Workspace thread</span>
								{availableRoles && availableRoles.length > 0 && (
									<div className="flex gap-1 ml-2">
										{availableRoles.map((role) => (
											<span
												key={role}
												className="px-2 py-0.5 rounded-full bg-secondary text-[10px] font-medium"
											>
												{role}
											</span>
										))}
									</div>
								)}
							</div>
							<div className="flex items-center gap-2">
								{connectionType && (
									<span className="text-[10px] text-muted-foreground font-mono bg-secondary px-2 py-0.5 rounded-full">
										{connectionType}
									</span>
								)}
								{isProcessing && (
									<span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
										• responding
									</span>
								)}
							</div>
						</>
					) : (
						/* 普通模式单会话控制栏 */
						<>
							<div className="flex items-center gap-2">
								<Select
									value={reasoningEffort || ""}
									onValueChange={(v) => v && onSetReasoningEffort(v)}
								>
									<SelectTrigger className="h-7 text-xs w-32 bg-background border-border rounded-lg">
										<SelectValue placeholder="Reasoning" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="">Default</SelectItem>
										<SelectItem value="none">None</SelectItem>
										<SelectItem value="low">Low</SelectItem>
										<SelectItem value="medium">Medium</SelectItem>
										<SelectItem value="high">High</SelectItem>
										<SelectItem value="xhigh">Max</SelectItem>
									</SelectContent>
								</Select>
								<Button
									variant={memoryEnabled ? "default" : "outline"}
									size="sm"
									className="h-7 text-xs gap-1 rounded-lg"
									onClick={() => onSetMemoryEnabled(!memoryEnabled)}
								>
									<Brain className="w-3 h-3" />
									Memory {memoryEnabled ? "on" : "off"}
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="h-7 text-xs gap-1 rounded-lg"
									onClick={onCompactContext}
									disabled={isProcessing}
								>
									<ArrowDownWideNarrow className="w-3 h-3" />
									Compact
								</Button>
							</div>
							<div className="flex items-center gap-2">
								{connectionType && (
									<span className="text-[10px] text-muted-foreground font-mono bg-secondary px-2 py-0.5 rounded-full">
										{connectionType}
									</span>
								)}
								{statusDetail && (
									<span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
										{statusDetail}
									</span>
								)}
								{stdinPromptActive && (
									<span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 font-mono">
										<Keyboard className="w-3 h-3" />
										input pending
									</span>
								)}
								{queuedDraftCount > 0 && (
									<span className="text-[10px] text-muted-foreground font-mono bg-secondary px-2 py-0.5 rounded-full">
										queued:{queuedDraftCount}
										{stdinPromptActive ? " (paused)" : ""}
									</span>
								)}
								<Button
									variant="outline"
									size="sm"
									className="h-7 text-xs gap-1 rounded-lg"
									onClick={onRewindChat}
									disabled={isProcessing || messages.length === 0}
								>
									<Undo2 className="w-3 h-3" />
									Rewind
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="h-7 text-xs gap-1 text-destructive hover:text-destructive rounded-lg"
									onClick={onClearChat}
									disabled={isProcessing || messages.length === 0}
								>
									<Trash2 className="w-3 h-3" />
									Clear
								</Button>
							</div>
						</>
					)}
			</div>
			<Conversation className="flex-1">
				<ConversationContent>
					{messages.length === 0 ? (
						<ConversationEmptyState
							icon={
								<div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center">
									<MessageSquare className="w-6 h-6 text-muted-foreground" />
								</div>
							}
							title="Start a conversation"
							description="Type a message below to begin chatting"
						/>
					) : (
						<>
							{collapseState.hiddenSegments.length > 0 && (
								<div className="mb-6 flex justify-center">
									<button
										type="button"
										className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-xs font-medium text-muted-foreground transition-all hover:bg-secondary hover:text-foreground shadow-sm"
										onClick={() => setShowEarlierMessages((value) => !value)}
									>
										<History className="w-3.5 h-3.5" />
										{showEarlierMessages ? (
											<>
												<ChevronUp className="w-3.5 h-3.5" />
												Collapse earlier transcript
											</>
										) : (
											<>
												<ChevronDown className="w-3.5 h-3.5" />
												Show {collapseState.hiddenMessages.length} earlier
												messages
												{collapseState.hiddenConversationCount > 0
													? ` · ${collapseState.hiddenConversationCount} turns`
													: ""}
												{collapseState.hiddenSegmentCount > 0
													? ` · ${collapseState.hiddenSegmentCount} segments`
													: ""}
												{collapseState.hasHiddenHistory
													? " · includes history"
													: ""}
											</>
										)}
									</button>
								</div>
							)}

							{showEarlierMessages &&
								collapseState.hiddenSegments.length > 0 && (
									<>
										<div className="mb-6 flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
											<div className="h-px flex-1 bg-border" />
											earlier transcript segments
											<div className="h-px flex-1 bg-border" />
										</div>
										{collapseState.hiddenSegments.map((segment) =>
											renderSegment(segment, false),
										)}
										<div className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
											<div className="h-px flex-1 bg-border" />
											current context
											<Layers3 className="w-3.5 h-3.5" />
											<div className="h-px flex-1 bg-border" />
										</div>
									</>
								)}

							{collapseState.visibleSegments.map((segment) =>
								renderSegment(segment, true),
							)}
							{/* 骨架屏：Slack 模式自动显示正在回复的角色 */}
							{skeletonRoles.map((role) => (
								<SkeletonMessage key={`skeleton-${role}`} roleName={role} />
							))}
							{/* 骨架屏：普通模式等待 AI 开始回复 */}
							{showGenericSkeleton && <SkeletonMessage />}
						</>
					)}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>
			<InputArea
				onSend={onSend}
				onQueueSend={onQueueSend}
				onCancel={onCancel}
				isProcessing={isProcessing}
				queuedDraftCount={queuedDraftCount}
				availableRoles={availableRoles}
				roleModels={roleModels}
			/>
		</div>
	);
}
