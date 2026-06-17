import { useEffect, useRef, useState } from "react";
import { ArrowUp, X, Loader2, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLauncherChat } from "@/hooks/useLauncherChat";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { LauncherChatProvider } from "@/lib/launcherTypes";
import type { ChatMessage } from "@/types";

interface LauncherChatProps {
	provider: LauncherChatProvider;
	onClose: () => void;
	initialQuery?: string;
}

function ChatMessageRow({ message }: { message: ChatMessage }) {
	const isUser = message.role === "user";
	return (
		<div
			className={cn(
				"flex w-full",
				isUser ? "justify-end" : "justify-start",
			)}
		>
			<div
				className={cn(
					"max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap",
					isUser
						? "bg-primary text-primary-foreground rounded-br-md"
						: "bg-muted text-foreground rounded-bl-md",
				)}
			>
				{!isUser && message.reasoning && (
					<div className="text-[12px] italic opacity-60 mb-1 border-l-2 border-current pl-2">
						{message.reasoning}
					</div>
				)}
				{message.content}
				{message.isStreaming && (
					<span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse ml-1 align-middle" />
				)}
			</div>
		</div>
	);
}

export function LauncherChat({ provider, onClose, initialQuery }: LauncherChatProps) {
	const { messages, isProcessing, error, send, cancel, currentModel, setModel } =
		useLauncherChat(provider);
	const [input, setInput] = useState(initialQuery || "");
	const [hasSentInitial, setHasSentInitial] = useState(false);
	const displayName = provider.displayName || provider.providerKey || "AI";
	const hasModelSwitcher = provider.models.length > 1;
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (initialQuery && !hasSentInitial) {
			setHasSentInitial(true);
			void send(initialQuery);
		}
	}, [initialQuery, hasSentInitial, send]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, [messages]);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const handleSend = () => {
		if (!input.trim() || isProcessing) return;
		const text = input;
		setInput("");
		void send(text);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
		// Escape is handled by the Launcher parent's document-level
		// keydown handler so it works regardless of focus.
	};

	return (
		<div className="h-screen w-screen flex flex-col bg-background text-foreground p-2">
			<div className="flex-1 rounded-xl bg-card/95 backdrop-blur-xl border border-border shadow-2xl overflow-hidden flex flex-col animate-fade-in">
				{/* Header */}
				<div className="flex items-center justify-between px-3 py-2 border-b border-border">
					<div className="flex items-center gap-2">
						<div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium text-primary">
							{displayName.charAt(0).toUpperCase()}
						</div>
						<span className="text-[13px] font-medium">{displayName}</span>
						{hasModelSwitcher ? (
							<Select
								value={currentModel}
								onValueChange={(value) => {
									if (value) void setModel(value);
								}}
							>
								<SelectTrigger className="h-5 border-0 bg-transparent p-0 text-[10px] text-muted-foreground shadow-none hover:text-foreground focus:ring-0 gap-1 w-fit">
									<SelectValue placeholder={currentModel} />
								</SelectTrigger>
								<SelectContent
									className="max-h-40"
									sideOffset={2}
									align="start"
									side="bottom"
								>
									{provider.models.map((m) => (
										<SelectItem key={m} value={m} className="text-[12px]">
											{m}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							<span className="text-[10px] text-muted-foreground">{currentModel}</span>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="ml-auto size-6 rounded-md flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors"
						aria-label="Close chat"
					>
						<X className="size-3.5" />
					</button>
				</div>

				{/* Messages */}
				<div
					ref={scrollRef}
					className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0"
				>
					{messages.length === 0 && !initialQuery && (
						<div className="h-full flex items-center justify-center text-muted-foreground text-xs">
							Start a conversation with {displayName}
						</div>
					)}
					{messages.map((msg) => (
						<ChatMessageRow key={msg.id} message={msg} />
					))}
					{error && (
						<div className="text-[11px] text-destructive px-1">{error}</div>
					)}
				</div>

				{/* Input */}
				<div className="p-2 border-t border-border">
					<div className="flex items-end gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 focus-within:ring-1 focus-within:ring-primary/30">
						<textarea
							ref={inputRef}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							rows={1}
							placeholder={`Ask ${displayName}...`}
							className="flex-1 bg-transparent resize-none outline-none text-[13px] max-h-24 py-1"
							style={{ minHeight: "24px" }}
						/>
						<button
							type="button"
							onClick={isProcessing ? cancel : handleSend}
							disabled={!isProcessing && !input.trim()}
							className={cn(
								"w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0",
								isProcessing
									? "bg-destructive/10 text-destructive hover:bg-destructive/20"
									: input.trim()
										? "bg-primary text-primary-foreground hover:bg-primary/90"
										: "bg-muted text-muted-foreground",
							)}
						>
							{isProcessing ? (
								<Square className="w-3.5 h-3.5 fill-current" />
							) : (
								<ArrowUp className="w-3.5 h-3.5" />
							)}
						</button>
					</div>
					<div className="flex items-center justify-between px-1 pt-1">
						<span className="text-[10px] text-muted-foreground">
							{isProcessing ? (
								<span className="flex items-center gap-1">
									<Loader2 className="w-3 h-3 animate-spin" />
									Thinking…
								</span>
							) : (
								"Enter to send · Esc to back"
							)}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
