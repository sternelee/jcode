import { useState } from "react";
import { motion } from "motion/react";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage, ToolExecution } from "@/types";

// ─── Props ──────────────────────────────────────────────────────────

export interface ChatBubbleProps {
	message: ChatMessage;
	isStreaming?: boolean;
	/** "compact" = launcher (tight, no chrome), "full" = workbench (rich). */
	variant?: "compact" | "full";
}

// ─── Tool summary pill ──────────────────────────────────────────────

function ToolSummary({ tools }: { tools: ToolExecution[] }) {
	const [expanded, setExpanded] = useState(false);
	if (tools.length === 0) return null;

	return (
		<div className="mt-1">
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
			>
				<Wrench className="size-3" />
				<span>
					{tools.length} tool{tools.length > 1 ? "s" : ""}
				</span>
				{expanded ? (
					<ChevronDown className="size-3" />
				) : (
					<ChevronRight className="size-3" />
				)}
			</button>
			{expanded && (
				<div className="mt-1 space-y-1 pl-4">
					{tools.map((t) => (
						<div
							key={t.id}
							className="text-[11px] text-muted-foreground flex items-center gap-1.5"
						>
							<span
								className={cn(
									"size-1.5 rounded-full shrink-0",
									t.status === "done"
										? "bg-green-500"
										: t.status === "error"
											? "bg-red-500"
											: "bg-yellow-500 animate-pulse",
								)}
							/>
							<code className="font-mono">{t.name || "…"}</code>
							{t.status === "done" && (
								<span className="opacity-50">done</span>
							)}
							{t.status === "error" && (
								<span className="text-red-500">error</span>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ─── Compact tool line (inline, no expand) ──────────────────────────

function CompactToolLine({ tools }: { tools: ToolExecution[] }) {
	if (tools.length === 0) return null;
	const last = tools[tools.length - 1];
	return (
		<div className="flex items-center gap-1.5 text-[11px] launcher-muted mt-1">
			<Wrench className="size-3 shrink-0" />
			<code className="font-mono">{last.name || "…"}</code>
			{last.status === "executing" && (
				<span className="animate-pulse">running…</span>
			)}
			{last.status === "done" && <span>done</span>}
			{last.status === "error" && (
				<span className="text-red-500">error</span>
			)}
		</div>
	);
}

// ─── Reasoning block ────────────────────────────────────────────────

function ReasoningBlock({
	reasoning,
	variant,
}: {
	reasoning: string;
	variant: "compact" | "full";
}) {
	const [collapsed, setCollapsed] = useState(variant === "full");

	if (variant === "compact") {
		return (
			<div className="text-[12px] italic opacity-60 mb-1 border-l-2 border-current pl-2 whitespace-pre-wrap">
				{reasoning}
			</div>
		);
	}

	return (
		<div className="mb-1">
			<button
				type="button"
				onClick={() => setCollapsed((v) => !v)}
				className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
			>
				{collapsed ? (
					<ChevronRight className="size-3" />
				) : (
					<ChevronDown className="size-3" />
				)}
				<span>Reasoning</span>
			</button>
			{!collapsed && (
				<div className="mt-1 text-[12px] italic opacity-70 border-l-2 border-current pl-2 whitespace-pre-wrap">
					{reasoning}
				</div>
			)}
		</div>
	);
}

// ─── Streaming indicator ────────────────────────────────────────────

function StreamingDot() {
	return (
		<span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse ml-1 align-middle" />
	);
}

// ─── ChatBubble ─────────────────────────────────────────────────────

export function ChatBubble({
	message,
	isStreaming,
	variant = "compact",
}: ChatBubbleProps) {
	const streaming = isStreaming ?? message.isStreaming;

	if (variant === "compact") {
		return <CompactBubble message={message} streaming={streaming} />;
	}

	return <FullBubble message={message} streaming={streaming} />;
}

// ─── Compact variant (launcher) ─────────────────────────────────────

function CompactBubble({
	message,
	streaming,
}: {
	message: ChatMessage;
	streaming: boolean;
}) {
	const isUser = message.role === "user";

	if (message.role === "system") {
		return (
			<motion.div
				initial={{ opacity: 0, y: 4 }}
				animate={{ opacity: 1, y: 0 }}
				className="flex w-full justify-center"
			>
				<div className="text-[11px] launcher-muted/70 px-3 py-1">
					{message.content}
				</div>
			</motion.div>
		);
	}

	return (
		<motion.div
			initial={{ opacity: 0, y: 8, scale: 0.98 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			transition={{ duration: 0.18, ease: "easeOut" }}
			className={cn(
				"flex w-full",
				isUser ? "justify-end" : "justify-start",
			)}
		>
			<div
				className={cn(
					"max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
					isUser
						? "bg-primary text-primary-foreground rounded-br-md whitespace-pre-wrap"
						: "bg-[var(--launcher-input-bg)] border border-[var(--launcher-glass-border)] text-foreground rounded-bl-md backdrop-blur-sm",
				)}
			>
				{!isUser && message.reasoning && (
					<ReasoningBlock
						reasoning={message.reasoning}
						variant="compact"
					/>
				)}
				{!isUser && message.content ? (
					<MessageResponse>{message.content}</MessageResponse>
				) : (
					<span className="whitespace-pre-wrap">
						{message.content}
					</span>
				)}
				{!isUser && message.toolExecutions.length > 0 && (
					<CompactToolLine tools={message.toolExecutions} />
				)}
				{streaming && <StreamingDot />}
			</div>
		</motion.div>
	);
}

// ─── Full variant (workbench) ───────────────────────────────────────

function FullBubble({
	message,
	streaming,
}: {
	message: ChatMessage;
	streaming: boolean;
}) {
	if (message.role === "system") {
		return (
			<motion.div
				initial={{ opacity: 0, y: 4 }}
				animate={{ opacity: 1, y: 0 }}
				className="flex w-full justify-center py-1"
			>
				<div className="text-[11px] text-muted-foreground/70 px-3">
					{message.content}
				</div>
			</motion.div>
		);
	}

	return (
		<motion.div
			initial={{ opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.2, ease: "easeOut" }}
		>
			<Message from={message.role === "user" ? "user" : "assistant"}>
			<MessageContent>
				{message.role !== "user" && message.reasoning && (
					<ReasoningBlock
						reasoning={message.reasoning}
						variant="full"
					/>
				)}
				{message.role === "user" ? (
					<span className="whitespace-pre-wrap">
						{message.content}
					</span>
				) : message.content ? (
					<MessageResponse>{message.content}</MessageResponse>
				) : null}
				{message.role !== "user" &&
					message.toolExecutions.length > 0 && (
						<ToolSummary tools={message.toolExecutions} />
					)}
				{streaming && <StreamingDot />}
			</MessageContent>
		</Message>
		</motion.div>
	);
}
