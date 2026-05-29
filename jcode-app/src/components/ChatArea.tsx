import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessage, SessionInfo } from "@/types";
import { MessageBubble } from "./MessageBubble";
import { AgentAvatar } from "./AgentAvatar";
import {
	SlashCommandPalette,
	AgentSettingsPopover,
	ModelPickerModal,
	type SlashCommand,
} from "./SlashCommands";

interface ChatAreaProps {
	messages: ChatMessage[];
	isProcessing: boolean;
	onSend: (content: string, images?: [string, string][]) => void;
	onCancel: () => void;
	channelName?: string;

	channelMembers?: string[];
	respondingRoles?: string[];
	workspaceSessions?: SessionInfo[];
	onConvene?: () => void;
	onAddAgent?: () => void;
	lastReadTimestamp?: number;
	isLoading?: boolean;
	currentModel?: string | null;
	currentProfileId?: string | null;
	reasoningEffort?: string | null;
	memoryEnabled?: boolean;
	availableModels?: string[];
	onSetModel?: (model: string, profileId?: string) => void;
	onSetEffort?: (effort: string) => void;
	onToggleMemory?: () => void;
	onCompact?: () => void;
	onClearChat?: () => void;
	onRenameSession?: (sessionId: string, newName: string) => void;
	currentSessionId?: string | null;
}

// ── Member role color map ────────────────────────────────────────────────
const MEMBER_ROLES: Record<
	string,
	{ name: string; tag: string; tagColor: string }
> = {
	Atlas: { name: "Atlas", tag: "RESEARCHER", tagColor: "#8B5CF6" },
	Bram: { name: "Bram", tag: "ENGINEER", tagColor: "#10B981" },
	Nova: { name: "Nova", tag: "STRATEGIST", tagColor: "#3B82F6" },
	Iris: { name: "Iris", tag: "DESIGNER", tagColor: "#EC4899" },
	Saga: { name: "Saga", tag: "CRITIC", tagColor: "#F59E0B" },
};

function UnreadSeparator() {
	return (
		<div className="flex items-center gap-3 my-4 px-2">
			<div className="flex-1 h-px bg-primary/20" />
			<span className="text-[11px] font-medium text-primary/60 shrink-0 select-none">
				New Messages
			</span>
			<div className="flex-1 h-px bg-primary/20" />
		</div>
	);
}

function relativeTime(ts?: number): string {
	if (!ts) return "";
	const diff = Date.now() - ts;
	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return new Date(ts).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

function memberRole(name: string) {
	return MEMBER_ROLES[name] ?? { name, tag: "AGENT", tagColor: "#6B7280" };
}

export function ChatArea({
	messages,
	isProcessing,
	onSend,
	onCancel,
	channelName = "Everyone",
	channelMembers: _channelMembers,
	respondingRoles = [],
	workspaceSessions = [],
	onConvene,
	onAddAgent,
	lastReadTimestamp,
	isLoading = false,
	currentModel = null,
	currentProfileId = null,
	reasoningEffort = null,
	memoryEnabled = true,
	availableModels = [],
	onSetModel,
	onSetEffort,
	onToggleMemory,
	onCompact,
	onClearChat,
	onRenameSession,
	currentSessionId,
}: ChatAreaProps) {
	const [text, setText] = useState("");
	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [mentionIndex, setMentionIndex] = useState(0);
	const [slashQuery, setSlashQuery] = useState<string | null>(null);
	const [slashIndex, setSlashIndex] = useState(0);
	const [convening, setConvening] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchText, setSearchText] = useState("");
	const [searchMatchIdx, setSearchMatchIdx] = useState(0);

	const feedRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);

	const channelMembers = useMemo(() => {
		if (_channelMembers) return _channelMembers;
		return workspaceSessions
			.map((s) => s.roleName)
			.filter((r): r is string => Boolean(r));
	}, [_channelMembers, workspaceSessions]);

	const sessionByRoleName = useMemo(() => {
		const map = new Map<string, SessionInfo>();
		for (const s of workspaceSessions) {
			if (s.roleName) map.set(s.roleName, s);
		}
		return map;
	}, [workspaceSessions]);

	// ── @mention ──────────────────────────────────────────────────────────
	const mentionMatches = useMemo(() => {
		if (mentionQuery === null) return [] as string[];
		const q = mentionQuery.toLowerCase();
		return channelMembers.filter((name) => name.toLowerCase().startsWith(q));
	}, [mentionQuery, channelMembers]);

	const detectMention = useCallback((value: string, cursorPos: number) => {
		const beforeCursor = value.slice(0, cursorPos);
		const match = beforeCursor.match(/@(\w*)$/);
		setMentionQuery(match ? match[1] : null);
		if (match) setMentionIndex(0);
	}, []);

	const insertMention = useCallback(
		(name: string) => {
			const cursor = textareaRef.current?.selectionStart ?? text.length;
			const beforeCursor = text.slice(0, cursor);
			const afterCursor = text.slice(cursor);
			const match = beforeCursor.match(/@(\w*)$/);
			if (!match) return;
			const newBefore =
				beforeCursor.slice(0, beforeCursor.length - match[0].length) +
				`@${name} `;
			setText(newBefore + afterCursor);
			setMentionQuery(null);
			setTimeout(() => {
				textareaRef.current?.focus();
				if (textareaRef.current) {
					textareaRef.current.selectionStart = newBefore.length;
					textareaRef.current.selectionEnd = newBefore.length;
				}
			}, 0);
		},
		[text],
	);

	// ── Auto-scroll ───────────────────────────────────────────────────────
	useEffect(() => {
		const el = feedRef.current;
		if (!el) return;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
		if (nearBottom || messages.length <= 2) {
			el.scrollTop = el.scrollHeight;
		}
	}, [messages.length]);

	// ── Search ────────────────────────────────────────────────────────────
	const searchMatchIds = useMemo(() => {
		if (!searchText.trim()) return [] as string[];
		const q = searchText.toLowerCase();
		return messages
			.filter((m) => m.content.toLowerCase().includes(q))
			.map((m) => m.id);
	}, [messages, searchText]);

	useEffect(() => {
		setSearchMatchIdx(0);
	}, [searchText]);
	useEffect(() => {
		if (searchOpen) {
			searchInputRef.current?.focus();
			setSearchText("");
			setSearchMatchIdx(0);
		}
	}, [searchOpen]);

	useEffect(() => {
		const matchId = searchMatchIds[searchMatchIdx];
		if (!matchId || !feedRef.current) return;
		const el = feedRef.current.querySelector(`[data-msg-id="${matchId}"]`);
		if (!el) return;
		const cr = feedRef.current.getBoundingClientRect();
		const er = el.getBoundingClientRect();
		feedRef.current.scrollBy({
			top: er.top - cr.top - cr.height / 2 + er.height / 2,
			behavior: "smooth",
		});
	}, [searchMatchIdx, searchMatchIds]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "f") {
				e.preventDefault();
				setSearchOpen((o) => !o);
			}
			if (e.key === "Escape" && searchOpen) setSearchOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [searchOpen]);

	// ── Input handlers ────────────────────────────────────────────────────
	const handleSend = () => {
		const content = text.trim();
		if (!content) return;
		onSend(content);
		setText("");
		setMentionQuery(null);
	};

	const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const val = e.target.value;
		const cursor = e.target.selectionStart ?? val.length;
		setText(val);
		detectMention(val, cursor);
		const beforeCursor = val.slice(0, cursor);
		const slashMatch = beforeCursor.match(/(?:^|\s)(\/\w*)$/);
		if (slashMatch) {
			setSlashQuery(slashMatch[1] ?? null);
			setSlashIndex(0);
		} else setSlashQuery(null);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (slashQuery !== null) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSlashIndex((i) => i + 1);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSlashIndex((i) => Math.max(i - 1, 0));
				return;
			}
			if (e.key === "Escape") {
				setSlashQuery(null);
				return;
			}
		}
		if (mentionQuery !== null && mentionMatches.length > 0) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setMentionIndex((i) => Math.min(i + 1, mentionMatches.length - 1));
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setMentionIndex((i) => Math.max(i - 1, 0));
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				const n = mentionMatches[mentionIndex];
				if (n) insertMention(n);
				return;
			}
			if (e.key === "Escape") {
				setMentionQuery(null);
				return;
			}
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleSlashSelect = (cmd: SlashCommand) => {
		const cursor = textareaRef.current?.selectionStart ?? text.length;
		const before = text.slice(0, cursor);
		const slashMatch = before.match(/(?:^|\s)(\/\w*)$/);
		if (!slashMatch) return;
		const replaceStart = before.length - slashMatch[1].length;
		const newText =
			text.slice(0, replaceStart) +
			cmd.name +
			(cmd.args ? " " : "") +
			text.slice(cursor);
		setText(newText);
		setSlashQuery(null);
		const newCursor = replaceStart + cmd.name.length + (cmd.args ? 1 : 0);
		setTimeout(() => {
			textareaRef.current?.focus();
			if (textareaRef.current) {
				textareaRef.current.selectionStart = newCursor;
				textareaRef.current.selectionEnd = newCursor;
			}
		}, 0);
	};

	// ── Derived ───────────────────────────────────────────────────────────
	const firstUnreadIdx = useMemo(() => {
		if (!lastReadTimestamp) return -1;
		return messages.findIndex(
			(m) => m.role === "assistant" && (m.timestamp ?? 0) > lastReadTimestamp,
		);
	}, [messages, lastReadTimestamp]);

	const presenceDot = (roleName: string) => {
		const session = sessionByRoleName.get(roleName);
		if (!session) return "bg-muted-foreground/30";
		if (session.liveProcessing) return "bg-primary/70 animate-pulse";
		return "bg-emerald-500";
	};

	return (
		<>
			<div className="flex-1 flex flex-col overflow-hidden bg-card">
				{/* ── Channel Header ── */}
				<div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0 min-h-[56px]">
					<div className="flex items-center gap-3 min-w-0">
						<div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary shrink-0">
							<svg
								viewBox="0 0 18 18"
								fill="currentColor"
								className="w-[18px] h-[18px]"
							>
								<path d="M9 1.5a.75.75 0 01.75.75v5.25h5.25a.75.75 0 010 1.5h-5.25v5.25a.75.75 0 01-1.5 0V9H3.75a.75.75 0 010-1.5H9V2.25A.75.75 0 019 1.5z" />
							</svg>
						</div>
						<div className="min-w-0">
							<h2 className="text-[15px] font-semibold text-foreground leading-tight">
								{channelName}
							</h2>
							{channelMembers.length > 0 && (
								<p className="text-[12px] text-muted-foreground mt-0.5 truncate">
									{channelMembers.join(", ")}
								</p>
							)}
						</div>
					</div>

					<div className="flex items-center gap-1 shrink-0">
						{/* Presence */}
						{channelMembers.length > 0 && (
							<div className="hidden md:flex items-center -space-x-1.5 mr-2">
								{channelMembers.slice(0, 4).map((name) => (
									<div key={name} className="relative" title={name}>
										<AgentAvatar name={name} size="sm" />
										<span
											className={cn(
												"absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-card",
												presenceDot(name),
											)}
										/>
									</div>
								))}
								{channelMembers.length > 4 && (
									<div className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center text-[9px] font-medium text-muted-foreground -ml-1.5">
										+{channelMembers.length - 4}
									</div>
								)}
							</div>
						)}
						{/* Search */}
						<button
							type="button"
							onClick={() => setSearchOpen((o) => !o)}
							title="Search (Cmd+F)"
							className={cn(
								"w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150",
								searchOpen
									? "bg-primary/10 text-primary"
									: "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted",
							)}
						>
							<svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
								<path
									fillRule="evenodd"
									d="M11.5 7.5a4 4 0 11-8 0 4 4 0 018 0zm-.82 4.74a5.5 5.5 0 111.06-1.06l2.79 2.79a.75.75 0 11-1.06 1.06l-2.79-2.79z"
									clipRule="evenodd"
								/>
							</svg>
						</button>
						{/* Settings */}
						<button
							type="button"
							onClick={() => setSettingsOpen((o) => !o)}
							title="Settings"
							className={cn(
								"w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150",
								settingsOpen
									? "bg-primary/10 text-primary"
									: "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted",
							)}
						>
							<svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
								<path d="M8 1.5c.35 0 .65.23.73.57l.5 2.19a.9.9 0 00.58.65l2.14.75c.42.15.6.62.44 1.05l-1 2.02a.9.9 0 00.08.86l1.33 1.96c.32.47.17 1.1-.33 1.37l-1.73 1a.9.9 0 01-.98-.27l-1.3-1.6a.9.9 0 00-.98-.27l-2.14.75a.9.9 0 01-1.05-.44l-1-2.02a.9.9 0 01.44-1.2l2.14-.75a.9.9 0 00.58-.65l.5-2.19A.75.75 0 018 1.5z" />
							</svg>
						</button>
						<AgentSettingsPopover
							open={settingsOpen}
							onClose={() => setSettingsOpen(false)}
							currentModel={currentModel}
							reasoningEffort={reasoningEffort}
							memoryEnabled={memoryEnabled}
							isProcessing={isProcessing}
							onOpenModelPicker={() => setModelPickerOpen(true)}
							onSetEffort={(e) => onSetEffort?.(e)}
							onToggleMemory={() => onToggleMemory?.()}
							onCompact={() => onCompact?.()}
							onClearChat={() => onClearChat?.()}
							onRenameSession={onRenameSession}
							currentSessionId={currentSessionId}
							sessionTitle={channelName}
							isSwarmRole={workspaceSessions.some(
								(s) => s.sessionId === currentSessionId && !!s.roleName,
							)}
						/>{" "}
						{/* Convene */}
						{workspaceSessions.some((s) => s.roleName) && onConvene && (
							<button
								type="button"
								onClick={() => {
									onConvene();
									setConvening(true);
									setTimeout(() => setConvening(false), 4000);
								}}
								className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-all duration-150 shadow-sm ml-1"
							>
								<svg
									viewBox="0 0 16 16"
									fill="currentColor"
									className="w-3.5 h-3.5"
								>
									<path d="M5.3 3.3A1.5 1.5 0 003 4.5v7a1.5 1.5 0 002.3 1.2l7-4.5a1.5 1.5 0 000-2.4l-7-4.5z" />
								</svg>
								Convene
							</button>
						)}
					</div>
				</div>

				{/* ── Agent status bar ── */}
				{workspaceSessions.some((s) => s.roleName) && (
					<div className="px-5 py-1.5 border-b border-border bg-muted/30 flex items-center gap-4 text-[11px] text-muted-foreground shrink-0">
						<span className="font-medium">{channelMembers.length} agents</span>
						{respondingRoles.length > 0 ? (
							<span className="flex items-center gap-1.5 text-primary">
								<span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
								{respondingRoles.length === 1
									? `${respondingRoles[0]} is responding`
									: `${respondingRoles.join(", ")} are responding`}
							</span>
						) : convening ? (
							<span className="flex items-center gap-1.5 text-primary">
								<span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
								Convening team…
							</span>
						) : (
							<span className="flex items-center gap-1.5 text-emerald-600">
								<span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
								All agents ready
							</span>
						)}
						{onAddAgent && (
							<button
								type="button"
								onClick={onAddAgent}
								className="ml-auto flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary font-medium transition-colors"
							>
								<svg
									viewBox="0 0 14 14"
									fill="currentColor"
									className="w-3 h-3"
								>
									<path d="M7 0a.75.75 0 01.75.75v5.5h5.5a.75.75 0 010 1.5h-5.5v5.5a.75.75 0 01-1.5 0v-5.5h-5.5a.75.75 0 010-1.5h5.5V.75A.75.75 0 017 0z" />
								</svg>
								+ Add Agent
							</button>
						)}
					</div>
				)}

				{/* ── Search bar ── */}
				{searchOpen && (
					<div className="flex items-center gap-2 px-5 py-2 border-b border-border bg-muted/30 shrink-0">
						<svg
							viewBox="0 0 16 16"
							fill="currentColor"
							className="w-3.5 h-3.5 text-muted-foreground shrink-0"
						>
							<path
								fillRule="evenodd"
								d="M11.5 7.5a4 4 0 11-8 0 4 4 0 018 0zm-.82 4.74a5.5 5.5 0 111.06-1.06l2.79 2.79a.75.75 0 11-1.06 1.06l-2.79-2.79z"
								clipRule="evenodd"
							/>
						</svg>
						<input
							ref={searchInputRef}
							type="text"
							value={searchText}
							onChange={(e) => setSearchText(e.target.value)}
							placeholder="Search messages…"
							className="flex-1 text-[13px] text-foreground bg-transparent outline-none placeholder-muted-foreground"
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									setSearchMatchIdx((i) =>
										e.shiftKey
											? (i - 1 + searchMatchIds.length) %
												Math.max(searchMatchIds.length, 1)
											: (i + 1) % Math.max(searchMatchIds.length, 1),
									);
								}
								if (e.key === "Escape") setSearchOpen(false);
							}}
						/>
						{searchText.trim() && (
							<span className="text-[11px] text-muted-foreground shrink-0">
								{searchMatchIds.length === 0
									? "No results"
									: `${searchMatchIdx + 1} / ${searchMatchIds.length}`}
							</span>
						)}
						<button
							type="button"
							onClick={() =>
								setSearchMatchIdx(
									(i) =>
										(i - 1 + searchMatchIds.length) %
										Math.max(searchMatchIds.length, 1),
								)
							}
							className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-colors"
							title="Previous"
						>
							<svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
								<path
									fillRule="evenodd"
									d="M6 10.5a.75.75 0 01-.75-.75V3.31L3.03 5.53a.75.75 0 01-1.06-1.06l3.75-3.75a.75.75 0 011.06 0l3.75 3.75a.75.75 0 01-1.06 1.06L6.75 3.31v6.44a.75.75 0 01-.75.75z"
									clipRule="evenodd"
								/>
							</svg>
						</button>
						<button
							type="button"
							onClick={() =>
								setSearchMatchIdx(
									(i) => (i + 1) % Math.max(searchMatchIds.length, 1),
								)
							}
							className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-colors"
							title="Next"
						>
							<svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
								<path
									fillRule="evenodd"
									d="M6 1.5a.75.75 0 01.75.75v6.44l2.22-2.22a.75.75 0 111.06 1.06L6.28 11.3a.75.75 0 01-1.06 0L1.47 7.53a.75.75 0 111.06-1.06L5.25 8.69V2.25A.75.75 0 016 1.5z"
									clipRule="evenodd"
								/>
							</svg>
						</button>
						<button
							type="button"
							onClick={() => setSearchOpen(false)}
							className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
							title="Close"
						>
							<svg
								viewBox="0 0 10 10"
								fill="currentColor"
								className="w-2.5 h-2.5"
							>
								<path d="M2.22 2.22a.75.75 0 011.06 0L5 3.94l1.72-1.72a.75.75 0 111.06 1.06L6.06 5l1.72 1.72a.75.75 0 11-1.06 1.06L5 6.06l-1.72 1.72a.75.75 0 01-1.06-1.06L3.94 5 2.22 3.28a.75.75 0 010-1.06z" />
							</svg>
						</button>
					</div>
				)}

				{/* ── Message Feed ── */}
				<div ref={feedRef} className="flex-1 overflow-y-auto px-5 py-4">
					{isLoading && messages.length === 0 && (
						<div className="space-y-5 pt-2 max-w-3xl mx-auto">
							{[0.6, 0.85, 0.4, 0.7].map((w, i) => (
								<div key={i} className="flex gap-3 animate-pulse">
									<div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
									<div className="flex-1 space-y-2 pt-1">
										<div
											className="h-3 bg-muted rounded"
											style={{ width: `${w * 35 + 10}%` }}
										/>
										<div
											className="h-3 bg-muted/60 rounded"
											style={{ width: `${w * 55 + 5}%` }}
										/>
									</div>
								</div>
							))}
						</div>
					)}

					<div className="max-w-3xl mx-auto space-y-4">
						{messages.length === 0 && !isLoading && (
							<div className="flex items-center justify-center min-h-[200px]">
								<div className="text-center">
									<div className="text-[15px] font-medium text-foreground">
										No messages yet
									</div>
									<div className="mt-1.5 text-[13px] text-muted-foreground">
										Type to start a conversation, or @mention an agent.
									</div>
								</div>
							</div>
						)}

						{messages.map((msg, idx) => {
							const isUser = msg.role === "user";
							const role = msg.roleName ? memberRole(msg.roleName) : null;
							const agentSession = msg.roleName
								? sessionByRoleName.get(msg.roleName)
								: undefined;
							const isCoordinator = agentSession?.swarmRole === "coordinator";
							const showUnreadSeparator =
								idx === firstUnreadIdx && firstUnreadIdx >= 0;
							const isSearchMatch = searchMatchIds.includes(msg.id);
							const isCurrentMatch = searchMatchIds[searchMatchIdx] === msg.id;

							if (isUser) {
								return (
									<div
										key={msg.id}
										data-msg-id={msg.id}
										className="message-enter"
									>
										{showUnreadSeparator && <UnreadSeparator />}
										<div className="flex justify-end gap-2 group/msg">
											<div
												className={cn(
													"max-w-[75%] min-w-0",
													isCurrentMatch &&
														"ring-2 ring-primary/40 rounded-2xl",
												)}
											>
												{msg.images && msg.images.length > 0 && (
													<div className="flex gap-2 mb-2 flex-wrap justify-end">
														{msg.images.map((img) => (
															<img
																key={img.id}
																src={
																	img.base64Data
																		? `data:${img.mediaType};base64,${img.base64Data}`
																		: img.filePath || ""
																}
																alt={img.label || "Attached"}
																className="w-16 h-16 rounded-lg object-cover border border-border"
															/>
														))}
													</div>
												)}
												<div
													className={cn(
														"bg-chat-user text-chat-user-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap shadow-sm",
														isSearchMatch &&
															!isCurrentMatch &&
															"ring-2 ring-primary/30",
													)}
												>
													{msg.content}
												</div>
												<div className="text-[11px] text-muted-foreground/60 text-right mt-0.5 px-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
													{relativeTime(msg.timestamp)}
												</div>
											</div>
										</div>
									</div>
								);
							}

							if (msg.role === "system") {
								return (
									<div
										key={msg.id}
										className="flex justify-center message-enter"
									>
										<MessageBubble message={msg} isStreaming={false} />
									</div>
								);
							}

							// ── Role message (swarm agent) ──
							if (role) {
								return (
									<div key={msg.id} className="group/msg message-enter">
										{showUnreadSeparator && <UnreadSeparator />}
										<div className="flex gap-3">
											<div className="shrink-0 mt-0.5">
												<AgentAvatar name={role.name} size="md" />
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2 mb-1.5">
													<span className="text-[14px] font-semibold text-foreground">
														{role.name}
													</span>
													<span
														className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white leading-none"
														style={{ backgroundColor: role.tagColor }}
													>
														{role.tag}
													</span>
													{isCoordinator && (
														<span className="px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-primary leading-none">
															LEAD
														</span>
													)}
													<div className="ml-auto flex items-center gap-1.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
														{msg.tokenUsage && (
															<span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
																↑{msg.tokenUsage.input.toLocaleString()} ↓
																{msg.tokenUsage.output.toLocaleString()}
															</span>
														)}
														<span className="text-[11px] text-muted-foreground">
															{relativeTime(msg.timestamp)}
														</span>
													</div>
												</div>
												<MessageBubble
													message={msg}
													isStreaming={msg.isStreaming}
													hideHeader
												/>
											</div>
										</div>
									</div>
								);
							}

							// ── Assistant (default) ──
							return (
								<div
									key={msg.id}
									data-msg-id={msg.id}
									className={cn(
										"group/msg message-enter",
										(isSearchMatch || isCurrentMatch) && "rounded-xl",
										isCurrentMatch && "ring-2 ring-primary/40",
									)}
								>
									{showUnreadSeparator && <UnreadSeparator />}
									<div className="flex gap-3">
										<div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
											<span className="text-white text-[13px] font-bold">
												J
											</span>
										</div>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2 mb-1.5">
												<span className="text-[14px] font-semibold text-foreground">
													JCode
												</span>
												<span className="text-[11px] text-muted-foreground ml-auto opacity-0 group-hover/msg:opacity-100 transition-opacity">
													{relativeTime(msg.timestamp)}
												</span>
											</div>
											<MessageBubble
												message={msg}
												isStreaming={msg.isStreaming}
												hideHeader
											/>
										</div>
									</div>
								</div>
							);
						})}

						{/* ── Typing indicator ── */}
						{(isProcessing || respondingRoles.length > 0) && (
							<div className="flex flex-col gap-2 pl-1">
								{(respondingRoles.length > 0 ? respondingRoles : [null]).map(
									(role) => (
										<div
											key={role ?? "processing"}
											className="flex items-center gap-3"
										>
											{role && <AgentAvatar name={role} size="sm" />}
											<div className="flex items-center gap-2">
												<div className="flex gap-1 items-center">
													<span
														className="w-2 h-2 bg-primary/60 rounded-full animate-bounce"
														style={{ animationDelay: "0ms" }}
													/>
													<span
														className="w-2 h-2 bg-primary/60 rounded-full animate-bounce"
														style={{ animationDelay: "150ms" }}
													/>
													<span
														className="w-2 h-2 bg-primary/60 rounded-full animate-bounce"
														style={{ animationDelay: "300ms" }}
													/>
												</div>
												<span className="text-[13px] font-medium text-primary/70">
													{role ? `${role} is typing…` : "Processing…"}
												</span>
											</div>
										</div>
									),
								)}
							</div>
						)}
					</div>
				</div>

				{/* ── Input Area ── */}
				<div className="px-4 pb-3 pt-2 border-t border-border bg-card">
					<div className="max-w-3xl mx-auto relative">
						{/* Slash command palette */}
						{slashQuery !== null && (
							<SlashCommandPalette
								query={slashQuery}
								selectedIndex={slashIndex}
								onIndexChange={setSlashIndex}
								onSelect={handleSlashSelect}
							/>
						)}

						{/* @mention dropdown */}
						{mentionQuery !== null && mentionMatches.length > 0 && (
							<div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50 animate-fade-in">
								<div className="px-3 py-1.5 border-b border-border text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
									Agents — ↑↓ Enter
								</div>
								{mentionMatches.map((name, i) => {
									const mr = memberRole(name);
									const as = sessionByRoleName.get(name);
									return (
										<button
											key={name}
											type="button"
											onMouseDown={(e) => {
												e.preventDefault();
												insertMention(name);
											}}
											className={cn(
												"w-full text-left px-3 py-2 flex items-center gap-2.5 text-[13px] transition-colors",
												i === mentionIndex ? "bg-primary/10" : "hover:bg-muted",
											)}
										>
											<div className="relative shrink-0">
												<AgentAvatar name={name} size="sm" />
												<span
													className={cn(
														"absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-card",
														as?.liveProcessing
															? "bg-primary animate-pulse"
															: "bg-emerald-500",
													)}
												/>
											</div>
											<div className="flex-1 min-w-0">
												<span
													className={cn(
														"font-medium",
														i === mentionIndex
															? "text-primary"
															: "text-foreground",
													)}
												>
													{name}
												</span>
											</div>
											<span
												className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-white shrink-0 leading-none"
												style={{ backgroundColor: mr.tagColor }}
											>
												{mr.tag}
											</span>
										</button>
									);
								})}
							</div>
						)}

						{/* Input box */}
						<div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-150">
							<textarea
								ref={textareaRef}
								value={text}
								onChange={handleChange}
								onKeyDown={handleKeyDown}
								placeholder="Type a message… (@ to mention)"
								rows={1}
								className="w-full px-4 pt-3 pb-2 text-[14px] text-foreground placeholder-muted-foreground/50 outline-none resize-none bg-transparent"
								style={{ minHeight: 44, maxHeight: 120 }}
							/>
							<div className="flex items-center justify-between px-3 py-1.5 border-t border-border">
								<div className="flex items-center gap-0.5">
									{/* Attach */}
									<button
										type="button"
										className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-all duration-150"
										title="Attach"
									>
										<svg
											viewBox="0 0 16 16"
											fill="currentColor"
											className="w-4 h-4"
										>
											<path
												fillRule="evenodd"
												d="M12.5 3.5a2 2 0 00-2.83 0l-5.5 5.5a2.5 2.5 0 003.54 3.54l4.5-4.5a.75.75 0 011.06 1.06l-4.5 4.5a4 4 0 01-5.66-5.66l5.5-5.5a3.5 3.5 0 014.95 4.95l-5.5 5.5A2.12 2.12 0 016.5 11.5a.75.75 0 010-1.5c.54 0 1.07-.22 1.47-.61l5.5-5.5a2 2 0 000-2.83z"
												clipRule="evenodd"
											/>
										</svg>
									</button>
									{/* @mention */}
									<button
										type="button"
										title="Mention agent"
										onClick={() => {
											const ta = textareaRef.current;
											if (!ta) return;
											const cursor = ta.selectionStart ?? text.length;
											setText(text.slice(0, cursor) + "@" + text.slice(cursor));
											setMentionQuery("");
											setMentionIndex(0);
											setTimeout(() => {
												ta.focus();
												ta.selectionStart = cursor + 1;
												ta.selectionEnd = cursor + 1;
											}, 0);
										}}
										className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-all duration-150"
									>
										<svg
											viewBox="0 0 16 16"
											fill="currentColor"
											className="w-4 h-4"
										>
											<path
												fillRule="evenodd"
												d="M8 1a7 7 0 107 7 1 1 0 00-2 0 5 5 0 11-1.5-3.53 1 1 0 001.5-1.33A7 7 0 108 1zm0 4a2 2 0 100 4 2 2 0 000-4z"
												clipRule="evenodd"
											/>
										</svg>
									</button>
								</div>

								<div className="flex items-center gap-2">
									{isProcessing && (
										<button
											type="button"
											onClick={onCancel}
											className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-150"
										>
											Cancel
										</button>
									)}
									<button
										type="button"
										onClick={handleSend}
										disabled={!text.trim()}
										className={cn(
											"inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150",
											text.trim()
												? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
												: "bg-muted text-muted-foreground/50 cursor-not-allowed",
										)}
									>
										<svg
											viewBox="0 0 16 16"
											fill="currentColor"
											className="w-4 h-4"
										>
											<path d="M2.5 2.5a.5.5 0 01.68-.47l12 5a.5.5 0 010 .94l-12 5a.5.5 0 01-.68-.47V9.5a.5.5 0 01.4-.49L9 8 2.9 7a.5.5 0 01-.4-.5V2.5z" />
										</svg>
										Send
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Model picker modal */}
			<ModelPickerModal
				open={modelPickerOpen}
				onClose={() => setModelPickerOpen(false)}
				availableModels={availableModels}
				currentModel={currentModel}
				currentProfileId={currentProfileId}
				onSelectModel={(m, pid) => onSetModel?.(m, pid)}
			/>
		</>
	);
}
