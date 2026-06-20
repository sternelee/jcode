import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatBubble } from "@/components/ChatBubble";
import type { ChatMessage } from "@/types";

// ─── Props ──────────────────────────────────────────────────────────

export interface MessageListProps {
	messages: ChatMessage[];
	error?: string | null;
	/** "compact" = launcher, "full" = workbench. */
	variant?: "compact" | "full";
	/** Shown when messages is empty. */
	emptyState?: ReactNode;
}

// ─── Auto-scroll threshold ──────────────────────────────────────────

const SCROLL_THRESHOLD = 200;

// ─── Component ──────────────────────────────────────────────────────

export function MessageList({
	messages,
	error,
	variant = "compact",
	emptyState,
}: MessageListProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [showScrollButton, setShowScrollButton] = useState(false);

	// Auto-scroll when near bottom.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;

		const isNearBottom =
			el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;

		if (isNearBottom) {
			el.scrollTop = el.scrollHeight;
			setShowScrollButton(false);
		} else {
			setShowScrollButton(true);
		}
	}, [messages]);

	// Track manual scroll to toggle the scroll-down button.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;

		const handleScroll = () => {
			const isNearBottom =
				el.scrollHeight - el.scrollTop - el.clientHeight <
				SCROLL_THRESHOLD;
			setShowScrollButton(!isNearBottom);
		};

		el.addEventListener("scroll", handleScroll, { passive: true });
		return () => el.removeEventListener("scroll", handleScroll);
	}, []);

	const scrollToBottom = () => {
		const el = scrollRef.current;
		if (el) {
			el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
		}
	};

	return (
		<div className="relative flex-1 min-h-0">
			<div
				ref={scrollRef}
				className={cn(
					"h-full overflow-y-auto",
					variant === "compact" ? "p-3 space-y-3" : "p-4 space-y-4",
				)}
			>
				{messages.length === 0 && emptyState && (
					<div className="h-full flex items-center justify-center">
						{emptyState}
					</div>
				)}
				{messages.map((msg) => (
					<ChatBubble
						key={msg.id}
						message={msg}
						variant={variant}
					/>
				))}
				{error && (
					<div className="text-[11px] text-destructive px-1">
						{error}
					</div>
				)}
			</div>

			{showScrollButton && messages.length > 0 && (
				<button
					type="button"
					onClick={scrollToBottom}
					className={cn(
						"absolute bottom-3 left-1/2 -translate-x-1/2 size-8 rounded-full backdrop-blur-sm border shadow-md flex items-center justify-center hover:text-foreground transition-colors",
						variant === "compact"
							? "bg-[var(--launcher-input-bg)] border-[var(--launcher-glass-border)] launcher-muted hover:bg-[var(--launcher-glass)]"
							: "bg-background/80 border-border text-muted-foreground hover:bg-background",
					)}
					aria-label="Scroll to bottom"
				>
					<ChevronDown className="size-4" />
				</button>
			)}
		</div>
	);
}
