import { useEffect, useRef, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUp, X, Loader2, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatSession } from "@/hooks/useChatSession";
import { MessageList } from "@/components/MessageList";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { LauncherChatProvider } from "@/lib/launcherTypes";
import type { SkillInfo } from "@/types";

interface LauncherChatProps {
	provider: LauncherChatProvider;
	onClose: () => void;
	initialQuery?: string;
}

export function LauncherChat({ provider, onClose, initialQuery }: LauncherChatProps) {
	const { messages, isProcessing, error, send, cancel, currentModel, setModel } =
		useChatSession({
			providerKey: provider.providerKey,
			model: provider.model,
			workingDir: null,
			memoryEnabled: true,
			forceProvider: true,
		});
	const [input, setInput] = useState(initialQuery || "");
	const [hasSentInitial, setHasSentInitial] = useState(false);
	const [skills, setSkills] = useState<SkillInfo[]>([]);
	const [skillIndex, setSkillIndex] = useState(0);
	const displayName = provider.displayName || provider.providerKey || "AI";
	const hasModelSwitcher = provider.models.length > 1;
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const skillQuery = input.startsWith("/skills:")
		? input.slice("/skills:".length).toLowerCase()
		: null;
	const skillMatches = useMemo(
		() =>
			skills.filter(
				(s) =>
					!skillQuery ||
					s.name.toLowerCase().includes(skillQuery) ||
					s.description.toLowerCase().includes(skillQuery),
			),
		[skills, skillQuery],
	);

	useEffect(() => {
		if (skillQuery !== null) {
			invoke<SkillInfo[]>("list_skills").then(setSkills).catch(() => {});
		}
	}, [skillQuery]);

	useEffect(() => {
		if (initialQuery && !hasSentInitial) {
			setHasSentInitial(true);
			void send(initialQuery);
		}
	}, [initialQuery, hasSentInitial, send]);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const handleSend = async () => {
		if (!input.trim() || isProcessing) return;
		const text = input;
		setInput("");

		// /skills:xxx resolution
		const skillMatch = text.trim().match(/^\/skills:(\S+)(?:\s+(.*))?$/s);
		if (skillMatch) {
			const skillName = skillMatch[1];
			try {
				const list = skills.length > 0 ? skills : await invoke<SkillInfo[]>("list_skills");
				const skill = list.find((s) => s.name === skillName);
				if (skill) {
					await send(text, undefined, skill.content);
					return;
				}
			} catch (e) {
				console.warn("[LauncherChat] Failed to resolve skill:", e);
			}
		}

		void send(text);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (skillQuery !== null && skillMatches.length > 0) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSkillIndex((i) => Math.min(i + 1, skillMatches.length - 1));
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSkillIndex((i) => Math.max(i - 1, 0));
				return;
			}
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				const skill = skillMatches[skillIndex];
				if (skill) {
					setInput(`/skills:${skill.name} `);
					setSkillIndex(0);
				}
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setInput(input.replace(/\/skills:\S*$/, ""));
				return;
			}
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void handleSend();
		}
		// Escape is handled by the Launcher parent's document-level
		// keydown handler so it works regardless of focus.
	};

	return (
		<div className="h-screen w-screen flex flex-col text-foreground">
			<div className="flex-1 launcher-glass overflow-hidden flex flex-col animate-fade-in">
				{/* Header */}
				<div className="flex items-center justify-between px-3 py-2 border-b border-[var(--launcher-glass-border)]">
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
								<SelectTrigger className="h-5 border-0 bg-transparent p-0 text-[10px] launcher-muted shadow-none hover:text-foreground focus:ring-0 gap-1 w-fit">
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
							<span className="text-[10px] launcher-muted">{currentModel}</span>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="ml-auto size-6 rounded-md flex items-center justify-center launcher-muted hover:text-foreground hover:bg-muted/60 transition-colors"
						aria-label="Close chat"
					>
						<X className="size-3.5" />
					</button>
				</div>

				{/* Messages */}
				<MessageList
					messages={messages}
					error={error}
					variant="compact"
					emptyState={
						!initialQuery ? (
							<div className="launcher-muted text-xs">
								Start a conversation with {displayName}
							</div>
						) : undefined
					}
				/>

				{/* Input */}
				<div className="p-2 border-t border-[var(--launcher-glass-border)] relative">
					{skillQuery !== null && skillMatches.length > 0 && (
						<div className="absolute bottom-full left-0 right-0 mb-1 mx-2 launcher-glass z-50 max-h-48 overflow-y-auto">
							{skillMatches.map((skill, i) => (
								<button
									key={skill.name}
									type="button"
									onMouseDown={(e) => {
										e.preventDefault();
										setInput(`/skills:${skill.name} `);
										setSkillIndex(0);
										inputRef.current?.focus();
									}}
									onMouseEnter={() => setSkillIndex(i)}
									className={cn(
										"w-full text-left px-3 py-1.5 text-[12px] transition-colors",
										i === skillIndex ? "bg-primary/10" : "hover:bg-muted/50",
									)}
								>
									<span className="font-mono font-medium">{skill.name}</span>
									{skill.description && (
										<span className="ml-2 launcher-muted truncate">
											{skill.description}
										</span>
									)}
								</button>
							))}
						</div>
					)}
					<div className="launcher-input !h-auto min-h-12 py-2 flex items-end gap-2 px-3">
						<textarea
							ref={inputRef}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							rows={1}
							placeholder={`Ask ${displayName}...`}
							className="flex-1 bg-transparent resize-none outline-none text-[13px] max-h-24 py-1 placeholder:text-[var(--launcher-muted-fg)]/60"
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
										: "bg-muted launcher-muted",
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
						<span className="text-[10px] launcher-muted">
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
