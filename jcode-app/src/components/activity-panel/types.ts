import type { ChatMessage, ToolExecution } from "@/types";

export type SegmentKind =
	| "history"
	| "compaction"
	| "rewind"
	| "runtime"
	| "conversation";

export interface MessageSegment {
	id: string;
	messages: ChatMessage[];
	kind: SegmentKind;
}

export interface ToolActivityItem extends ToolExecution {
	key: string;
	timestamp: number;
	messageId: string;
	messagePreview: string;
	turnLabel: string;
}

export interface TurnActivity {
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

export interface BoundaryEntry {
	type: "boundary";
	id: string;
	segmentKind: Exclude<SegmentKind, "conversation">;
	messageId: string;
	title: string;
	summary: string;
}

export interface TurnEntry {
	type: "turn";
	id: string;
	turn: TurnActivity;
}

export type TimelineEntry = BoundaryEntry | TurnEntry;

export interface RuntimeEventItem {
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
