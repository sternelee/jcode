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

// --- Types ---

interface ChatAreaProps {
	messages: ChatMessage[];
	isProcessing: boolean;
	onSend: (content: string, images?: [string, string][]) => void;
	onCancel: () => void;
	/** Display name for the current channel */
	channelName?: string;
	/** Online agents in this workspace */
	channelMembers?: string[];
	/** Roles currently generating a response */
	respondingRoles?: string[];
	/** Sessions in the current workspace (for dynamic member list + presence) */
	workspaceSessions?: SessionInfo[];
	/** Callback for Convene button */
	onConvene?: () => void;
	/** Callback to add a new agent to this workspace */
	onAddAgent?: () => void;
	/** Timestamp of last read message — messages after this show the unread separator */
	lastReadTimestamp?: number;
	/** True while the selected DM session history is loading */
	isLoading?: boolean;
	// Agent settings props
	currentModel?: string | null;
	reasoningEffort?: string | null;
	memoryEnabled?: boolean;
	availableModels?: string[];
	onSetModel?: (model: string) => void;
	onSetEffort?: (effort: string) => void;
	onToggleMemory?: () => void;
	onCompact?: () => void;
	onClearChat?: () => void;
}

// ── Unread separator ──────────────────────────────────────────────────────
function UnreadSeparator() {
	return (
		<div className="flex items-center gap-3 my-3">
			<div className="flex-1 h-px bg-red-200" />
			<span className="text-[11px] font-semibold text-red-400 shrink-0 select-none">
				New Messages
			</span>
			<div className="flex-1 h-px bg-red-200" />
		</div>
	);
}

const MEMBER_ROLES: Record<string, { name: string; tag: string; tagColor: string }> = {

	Atlas: { name: "Atlas", tag: "RESEARCHER", tagColor: "#8B5CF6" },
	Bram: { name: "Bram", tag: "ENGINEER", tagColor: "#10B981" },
	Nova: { name: "Nova", tag: "STRATEGIST", tagColor: "#3B82F6" },
	Iris: { name: "Iris", tag: "DESIGNER", tagColor: "#EC4899" },
	Saga: { name: "Saga", tag: "CRITIC", tagColor: "#F59E0B" },
};

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
	reasoningEffort = null,
	memoryEnabled = true,
	availableModels = [],
	onSetModel,
	onSetEffort,
	onToggleMemory,
	onCompact,
	onClearChat,
}: ChatAreaProps) {
	const [text, setText] = useState("");
	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [mentionIndex, setMentionIndex] = useState(0);
	const [slashQuery, setSlashQuery] = useState<string | null>(null);
	const [slashIndex, setSlashIndex] = useState(0);
	// Convene feedback: briefly show "Convening team…" in the status bar
	const [convening, setConvening] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	// In-chat search
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchText, setSearchText] = useState("");
	const [searchMatchIdx, setSearchMatchIdx] = useState(0);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const feedRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// ── Channel member list (from session role names or prop) ──────────────
	const channelMembers = useMemo(() => {
		if (_channelMembers) return _channelMembers;
		const roleNames = workspaceSessions
			.map((s) => s.roleName)
			.filter((r): r is string => Boolean(r));
		if (roleNames.length === 0) return [] as string[];
		return roleNames;
	}, [_channelMembers, workspaceSessions]);

	// ── Session lookup by role name (for presence) ─────────────────────────
	const sessionByRoleName = useMemo(() => {
		const map = new Map<string, SessionInfo>();
		for (const s of workspaceSessions) {
			if (s.roleName) map.set(s.roleName, s);
		}
		return map;
	}, [workspaceSessions]);

	// ── @mention autocomplete ──────────────────────────────────────────────
	const mentionMatches = useMemo(() => {
		if (mentionQuery === null) return [] as string[];
		const q = mentionQuery.toLowerCase();
		return channelMembers.filter((name) => name.toLowerCase().startsWith(q));
	}, [mentionQuery, channelMembers]);

	const detectMention = useCallback((value: string, cursorPos: number) => {
		const beforeCursor = value.slice(0, cursorPos);
		const match = beforeCursor.match(/@(\w*)$/);
		if (match) {
			setMentionQuery(match[1]);
			setMentionIndex(0);
		} else {
			setMentionQuery(null);
		}
	}, []);

	const insertMention = useCallback(
		(name: string) => {
			const cursor = textareaRef.current?.selectionStart ?? text.length;
			const beforeCursor = text.slice(0, cursor);
			const afterCursor = text.slice(cursor);
			const match = beforeCursor.match(/@(\w*)$/);
			if (!match) return;
			const newBefore =
				beforeCursor.slice(0, beforeCursor.length - match[0].length) + `@${name} `;
			setText(newBefore + afterCursor);
			setMentionQuery(null);
			// Restore cursor after state flush
			setTimeout(() => {
				if (textareaRef.current) {
					textareaRef.current.selectionStart = newBefore.length;
					textareaRef.current.selectionEnd = newBefore.length;
					textareaRef.current.focus();
				}
			}, 0);
		},
		[text],
	);

	// ── Auto-scroll ────────────────────────────────────────────────────────
	// Use container scrollTop instead of scrollIntoView to avoid scrolling
	// body/html ancestors (a known scrollIntoView footgun).
	useEffect(() => {
		const el = feedRef.current;
		if (!el) return;
		// Stay pinned to bottom if already near it, or on initial load.
		const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
		if (isNearBottom || messages.length <= 2) {
			el.scrollTop = el.scrollHeight;
		}
	}, [messages.length]);

	// ── Helpers ────────────────────────────────────────────────────────────
	const memberRole = (name: string) =>
		MEMBER_ROLES[name] ?? { name, tag: "AGENT", tagColor: "#6B7280" };

	const typingRole = respondingRoles.length > 0 ? respondingRoles[0] : null;
	void typingRole; // kept for backward compatibility, actual display iterates all respondingRoles

	// Relative time for message timestamps
	const relativeTime = (ts?: number): string => {
		if (!ts) return "";
		const diff = Date.now() - ts;
		if (diff < 60_000) return "just now";
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
		return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
	};

	// First unread message index for the separator
	const firstUnreadIdx = useMemo(() => {
		if (!lastReadTimestamp) return -1;
		return messages.findIndex(
			(m) => m.role === "assistant" && (m.timestamp ?? 0) > lastReadTimestamp,
		);
	}, [messages, lastReadTimestamp]);

	// In-chat search: matched message ids
	const searchMatchIds = useMemo(() => {
		if (!searchText.trim()) return [] as string[];
		const q = searchText.toLowerCase();
		return messages
			.filter((m) => m.content.toLowerCase().includes(q))
			.map((m) => m.id);
	}, [messages, searchText]);

	// Reset match cursor when query changes
	useEffect(() => {
		setSearchMatchIdx(0);
	}, [searchText]);

	// Focus search input when opened
	useEffect(() => {
		if (searchOpen) {
			searchInputRef.current?.focus();
			setSearchText("");
			setSearchMatchIdx(0);
		}
	}, [searchOpen]);

	// Scroll to current match — use container offset to avoid body scroll.
	useEffect(() => {
		const matchId = searchMatchIds[searchMatchIdx];
		if (!matchId || !feedRef.current) return;
		const el = feedRef.current.querySelector(`[data-msg-id="${matchId}"]`);
		if (!el) return;
		const containerRect = feedRef.current.getBoundingClientRect();
		const elRect = el.getBoundingClientRect();
		const offset = elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2;
		feedRef.current.scrollBy({ top: offset, behavior: "smooth" });
	}, [searchMatchIdx, searchMatchIds]);

	// Keyboard shortcut: Cmd+F / Ctrl+F
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "f") {
				e.preventDefault();
				setSearchOpen((o) => !o);
			}
			if (e.key === "Escape" && searchOpen) {
				setSearchOpen(false);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [searchOpen]);

	// ── Send handler ───────────────────────────────────────────────────────
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
		// @mention detection
		detectMention(val, cursor);
		// Slash command detection (only when text starts with /)
		const beforeCursor = val.slice(0, cursor);
		const slashMatch = beforeCursor.match(/(?:^|\s)(\/\w*)$/);
		if (slashMatch) {
			setSlashQuery(slashMatch[1] ?? null);
			setSlashIndex(0);
		} else {
			setSlashQuery(null);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		// Slash command navigation takes priority
		if (slashQuery !== null) {
			if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex((i) => i + 1); return; }
			if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex((i) => Math.max(i - 1, 0)); return; }
			if (e.key === "Escape") { setSlashQuery(null); return; }
			// Tab or Enter with slash autocomplete
			if (e.key === "Tab" || (e.key === "Enter" && slashQuery.length > 1)) {
				// will be handled by onSelect below
			}
		}
		// @mention navigation takes priority
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
				const name = mentionMatches[mentionIndex];
				if (name) insertMention(name);
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
		// Insert the command name into input, replacing the slash query
		const cursor = textareaRef.current?.selectionStart ?? text.length;
		const before = text.slice(0, cursor);
		const slashMatch = before.match(/(?:^|\s)(\/\w*)$/);
		if (!slashMatch) return;
		const replaceStart = before.length - slashMatch[1].length;
		const newText = text.slice(0, replaceStart) + cmd.name + (cmd.args ? " " : "") + text.slice(cursor);
		setText(newText);
		setSlashQuery(null);
		const newCursor = replaceStart + cmd.name.length + (cmd.args ? 1 : 0);
		setTimeout(() => {
			if (textareaRef.current) {
				textareaRef.current.selectionStart = newCursor;
				textareaRef.current.selectionEnd = newCursor;
				textareaRef.current.focus();
			}
		}, 0);
	};

	// ── Presence dot color ─────────────────────────────────────────────────
	const presenceDot = (roleName: string) => {
		const session = sessionByRoleName.get(roleName);
		if (!session) return "bg-border"; // offline / unknown
		if (session.liveProcessing) return "bg-amber-400 animate-pulse"; // typing/thinking
		return "bg-emerald-500"; // idle but connected
	};

	return (
		<>
		<div className="flex-1 flex flex-col overflow-hidden bg-card">
			{/* ── Channel Header ── */}
			<div className="px-6 py-3 border-b border-border bg-card flex items-center justify-between shrink-0">
				<div className="flex items-center gap-3 min-w-0">
					<svg viewBox="0 0 20 20" fill="#F59E0B" className="w-5 h-5 shrink-0">
						<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
					</svg>
					<div className="min-w-0">
						<h2 className="text-[17px] font-bold text-foreground leading-tight">
							{channelName}
						</h2>
						{channelMembers.length > 0 && (
							<p className="text-[12px] text-muted-foreground mt-0.5 truncate">
								{channelMembers.join(", ")} + you
							</p>
						)}
					</div>
				</div>

				<div className="flex items-center gap-3 shrink-0">
					{/* Presence avatars */}
					{channelMembers.length > 0 && (
						<div className="hidden md:flex items-center -space-x-1.5">
							{channelMembers.slice(0, 5).map((name) => (
								<div key={name} className="relative" title={name}>
									<AgentAvatar name={name} size="sm" />
									<span
										className={cn(
											"absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-background",
											presenceDot(name),
										)}
									/>
								</div>
							))}
							{channelMembers.length > 5 && (
								<div className="w-6 h-6 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[9px] font-medium text-muted-foreground -ml-1.5">
									+{channelMembers.length - 5}
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
							"w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
							searchOpen
								? "bg-primary/10 text-primary"
								: "text-muted-foreground hover:text-muted-foreground hover:bg-muted",
						)}
					>
						<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
							<path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
						</svg>
					</button>

					{/* Agent Settings gear */}
					<div className="relative">
						<button
							type="button"
							onClick={() => setSettingsOpen((o) => !o)}
							title="Agent settings"
							className={cn(
								"w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
								settingsOpen
									? "bg-primary/10 text-primary"
									: "text-muted-foreground hover:text-muted-foreground hover:bg-muted",
							)}
						>
							<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
								<path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.205 1.251l-1.18 2.044a1 1 0 01-1.186.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.113a7.047 7.047 0 010-2.228L1.821 7.773a1 1 0 01-.205-1.251l1.18-2.044a1 1 0 011.186-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
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
						/>
					</div>

					{/* Convene */}
					<button
						type="button"
						onClick={() => {
							onConvene?.();
							setConvening(true);
							setTimeout(() => setConvening(false), 4000);
						}}
						className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
							<path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
						</svg>
						Convene
					</button>
				</div>
			</div>

			{/* ── Status Bar ── */}
			{workspaceSessions.some((s) => s.roleName) && (
				<div className="px-6 py-1.5 border-b border-border bg-muted flex items-center gap-4 text-[11px] text-muted-foreground shrink-0">
					<span>{channelMembers.length} agents</span>
					{respondingRoles.length > 0 ? (
						<span className="flex items-center gap-1.5 text-amber-600">
							<span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
							{respondingRoles.length === 1
								? `${respondingRoles[0]} is responding`
								: `${respondingRoles.join(", ")} are responding`}
						</span>
					) : convening ? (
						<span className="flex items-center gap-1.5 text-violet-600">
							<span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
							Convening team…
						</span>
					) : (
						<span className="flex items-center gap-1.5 text-emerald-600">
							<span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
							All agents ready
						</span>
					)}
					{/* Add Agent button */}
					{onAddAgent && (
						<button
							type="button"
							onClick={onAddAgent}
							className="ml-auto flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium transition-colors"
							title="Add an agent to this workspace"
						>
							<svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
								<path d="M8 1a.75.75 0 01.75.75v5.5h5.5a.75.75 0 010 1.5h-5.5v5.5a.75.75 0 01-1.5 0v-5.5h-5.5a.75.75 0 010-1.5h5.5v-5.5A.75.75 0 018 1z" />
							</svg>
							+ Add Agent
						</button>
					)}
				</div>
			)}

			{/* ── Message Feed ── */}
			{/* Search bar */}
			{searchOpen && (
				<div className="flex items-center gap-2 px-6 py-2 border-b border-border bg-muted shrink-0">
					<svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-muted-foreground shrink-0">
						<path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
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
								if (e.shiftKey) {
									setSearchMatchIdx((i) => (i - 1 + searchMatchIds.length) % Math.max(searchMatchIds.length, 1));
								} else {
									setSearchMatchIdx((i) => (i + 1) % Math.max(searchMatchIds.length, 1));
								}
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
					<div className="flex items-center gap-1 shrink-0">
						<button type="button" onClick={() => setSearchMatchIdx((i) => (i - 1 + searchMatchIds.length) % Math.max(searchMatchIds.length, 1))} className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Previous (Shift+Enter)">
							<svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M8 14a.75.75 0 01-.75-.75V4.56L4.03 7.78a.75.75 0 01-1.06-1.06l4.5-4.5a.75.75 0 011.06 0l4.5 4.5a.75.75 0 01-1.06 1.06L8.75 4.56v8.69A.75.75 0 018 14z" clipRule="evenodd" /></svg>
						</button>
						<button type="button" onClick={() => setSearchMatchIdx((i) => (i + 1) % Math.max(searchMatchIds.length, 1))} className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Next (Enter)">
							<svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M8 2a.75.75 0 01.75.75v8.69l3.22-3.22a.75.75 0 111.06 1.06l-4.5 4.5a.75.75 0 01-1.06 0l-4.5-4.5a.75.75 0 111.06-1.06L7.25 11.44V2.75A.75.75 0 018 2z" clipRule="evenodd" /></svg>
						</button>
						<button type="button" onClick={() => setSearchOpen(false)} className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Close (Esc)">
							<svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5"><path d="M2.22 2.22a.75.75 0 011.06 0L6 4.94l2.72-2.72a.75.75 0 111.06 1.06L7.06 6l2.72 2.72a.75.75 0 11-1.06 1.06L6 7.06l-2.72 2.72a.75.75 0 01-1.06-1.06L4.94 6 2.22 3.28a.75.75 0 010-1.06z" /></svg>
						</button>
					</div>
				</div>
			)}
			<div ref={feedRef} style={{ color: "var(--foreground)" }} className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
				{/* Loading skeleton while DM history is being fetched */}
				{isLoading && messages.length === 0 && (
					<div className="space-y-6 pt-2">
						{[0.7, 1, 0.5, 0.85].map((w, i) => (
							<div key={i} className="flex gap-3 animate-pulse">
								<div className="w-9 h-9 rounded-xl bg-border shrink-0" />
								<div className="flex-1 space-y-2">
									<div className="h-3 bg-border rounded" style={{ width: `${w * 40 + 15}%` }} />
									<div className="h-3 bg-muted rounded" style={{ width: `${w * 60 + 10}%` }} />
									{i % 2 === 0 && <div className="h-3 bg-muted rounded" style={{ width: `${w * 30 + 5}%` }} />}
								</div>
							</div>
						))}
					</div>
				)}

				{/* Empty state */}
				{messages.length === 0 && !isLoading && (
					<div className="h-full min-h-[240px] flex items-center justify-center">
						<div className="max-w-sm text-center">
							<div className="text-[15px] font-semibold text-foreground">
								No messages yet
							</div>
							<div className="mt-2 text-[13px] text-muted-foreground leading-6">
								Start the conversation, type{" "}
								<kbd className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono text-foreground">
									@
								</kbd>{" "}
								to summon an agent, or Convene the team.
							</div>
						</div>
					</div>
				)}

				{messages.map((msg, idx) => {
					const isUser = msg.role === "user";
					const isSystem = msg.role === "system";
					const role = msg.roleName ? memberRole(msg.roleName) : null;
					const agentSession = msg.roleName ? sessionByRoleName.get(msg.roleName) : undefined;
					const isCoordinator = agentSession?.swarmRole === "coordinator";
					const showUnreadSeparator = idx === firstUnreadIdx && firstUnreadIdx >= 0;
					const isSearchMatch = searchMatchIds.includes(msg.id);
					const isCurrentMatch = searchMatchIds[searchMatchIdx] === msg.id;

					if (isUser) {
						// ── Right-aligned user bubble ──────────────────────────
						return (
							<div key={msg.id} data-msg-id={msg.id}>
								{showUnreadSeparator && <UnreadSeparator />}
								<div className={cn("flex justify-end group/msg gap-2", isCurrentMatch && "rounded-2xl ring-2 ring-yellow-400")}>
									<div className="max-w-[72%]">
										{msg.images && msg.images.length > 0 && (
											<div className="flex gap-2 mb-2 flex-wrap justify-end">
												{msg.images.map((img) => (
													<img
														key={img.id}
														src={img.base64Data ? `data:${img.mediaType};base64,${img.base64Data}` : img.filePath || ""}
														alt={img.label || "Attached"}
														className="w-16 h-16 rounded-xl object-cover"
													/>
												))}
											</div>
										)}
										<div className={cn("bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap", isSearchMatch && !isCurrentMatch && "ring-2 ring-yellow-300")}>
											{msg.content}
										</div>
										<div className="text-[11px] text-muted-foreground text-right mt-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
											{relativeTime(msg.timestamp)}
										</div>
									</div>
								</div>
							</div>
						);
					}

					if (isSystem) {
						// ── Centered system message via MessageBubble ──────────
						return (
							<div key={msg.id} className="flex justify-center">
								<MessageBubble message={msg} isStreaming={false} />
							</div>
						);
					}

					if (role) {
						// ── Slack-style agent message (left, avatar + role badge) ──
						return (
							<div key={msg.id} className="group/msg">
								{showUnreadSeparator && <UnreadSeparator />}
								<div className="flex gap-3">
									<div className="shrink-0 mt-1">
										<AgentAvatar name={role.name} size="md" />
									</div>
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2 mb-1">
											<span className="text-[14px] font-bold text-foreground">{role.name}</span>
											<span
												className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
												style={{ backgroundColor: role.tagColor }}
											>
												{role.tag}
											</span>
											{isCoordinator && (
												<span className="px-1 py-0.5 rounded text-[9px] font-bold text-white bg-violet-500">
													LEAD
												</span>
											)}
											<div className="ml-auto flex items-center gap-1.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
												{msg.tokenUsage && (
													<span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
														↑{msg.tokenUsage.input.toLocaleString()} ↓{msg.tokenUsage.output.toLocaleString()}
													</span>
												)}
												<span className="text-[11px] text-muted-foreground">
													{relativeTime(msg.timestamp)}
												</span>
											</div>
										</div>
										<MessageBubble message={msg} isStreaming={msg.isStreaming} hideHeader={true} />
									</div>
								</div>
							</div>
						);
					}

					// ── Non-role assistant (coordinator / single-session) ──
					return (
						<div key={msg.id} data-msg-id={msg.id} className={cn("group/msg", (isSearchMatch || isCurrentMatch) && "rounded-xl ring-2", isCurrentMatch ? "ring-yellow-400" : isSearchMatch ? "ring-yellow-200" : "")}>
							{showUnreadSeparator && <UnreadSeparator />}
							<div className="flex gap-3">
								<div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shrink-0 mt-0.5">
									<span className="text-white text-[13px] font-bold">J</span>
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 mb-1">
										<span className="text-[14px] font-bold text-foreground">JCode</span>
										<span className="px-1 py-0.5 rounded text-[9px] font-bold text-white bg-violet-500">
											LEAD
										</span>
										<span className="text-[11px] text-muted-foreground ml-auto opacity-0 group-hover/msg:opacity-100 transition-opacity">
											{relativeTime(msg.timestamp)}
										</span>
									</div>
									<MessageBubble message={msg} isStreaming={msg.isStreaming} hideHeader={true} />
								</div>
							</div>
						</div>
					);
				})}

				{/* Typing indicator – show all responding roles */}
				{(isProcessing || respondingRoles.length > 0) && (
					<div className="flex flex-col gap-2 px-1">
						{(respondingRoles.length > 0 ? respondingRoles : [null]).map(
							(role, idx) => (
								<div key={role ?? "processing"} className="flex items-center gap-3">
									{role && (
										<AgentAvatar name={role} size="sm" />
									)}
									<div className="flex items-center gap-2">
										<div className="flex gap-1">
											<span
												className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
												style={{ animationDelay: `${idx * 80}ms` }}
											/>
											<span
												className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
												style={{ animationDelay: `${idx * 80 + 150}ms` }}
											/>
											<span
												className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
												style={{ animationDelay: `${idx * 80 + 300}ms` }}
											/>
										</div>
										<span className="text-[13px] font-medium text-transparent bg-clip-text bg-gradient-to-r from-primary to-primary/60">
											{role ? `${role} is typing…` : "Processing…"}
										</span>
									</div>
								</div>
							),
						)}
					</div>
				)}

			</div>

			{/* ── Input Area ── */}
			<div className="px-4 pb-4 pt-2 bg-card border-t border-border">
				<div className="max-w-full mx-auto relative">
					{/* Slash command palette */}
					{slashQuery !== null && (
						<SlashCommandPalette
							query={slashQuery}
							selectedIndex={slashIndex}
							onIndexChange={setSlashIndex}
							onSelect={handleSlashSelect}
						/>
					)}
					{/* @mention dropdown – floats above the input box */}
					{mentionQuery !== null && mentionMatches.length > 0 && (
						<div className="absolute bottom-full left-0 right-0 mb-1.5 bg-white border border-[#E5E7EB] rounded-xl shadow-xl overflow-hidden z-50">
							<div className="px-3 py-1.5 border-b border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
								Agents — ↑↓ navigate · Enter insert
							</div>
							{mentionMatches.map((name, i) => {
								const mr = memberRole(name);
								const agentSession = sessionByRoleName.get(name);
								return (
									<button
										key={name}
										type="button"
										onMouseDown={(e) => {
											e.preventDefault();
											insertMention(name);
										}}
										className={cn(
											"w-full text-left px-3 py-2.5 flex items-center gap-3 text-[13px] transition-colors",
											i === mentionIndex
												? "bg-primary/10"
												: "hover:bg-muted",
										)}
									>
										<div className="relative shrink-0">
											<AgentAvatar name={name} size="sm" />
											<span
												className={cn(
													"absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-background",
													agentSession?.liveProcessing
														? "bg-amber-400"
														: "bg-emerald-500",
												)}
											/>
										</div>
										<div className="flex-1 min-w-0">
											<span
												className={cn(
													"font-semibold",
													i === mentionIndex
														? "text-[#2563EB]"
														: "text-foreground",
												)}
											>
												{name}
											</span>
										</div>
										<span
											className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-white shrink-0"
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
					<div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm overflow-hidden focus-within:border-[#3B82F6] focus-within:ring-1 focus-within:ring-[#3B82F6]/20 transition-all">
						<textarea
							ref={textareaRef}
							value={text}
							onChange={handleChange}
							onKeyDown={handleKeyDown}
							placeholder="Message the team — type @ to mention an agent"
							rows={1}
							className="w-full px-4 pt-3 pb-2 text-[14px] text-foreground placeholder-muted-foreground outline-none resize-none bg-transparent"
							style={{ minHeight: 44, maxHeight: 120 }}
						/>
						<div className="flex items-center justify-between px-3 py-2 border-t border-border">
							<div className="flex items-center gap-1">
								{/* Attach */}
								<button
									type="button"
									className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors"
									title="Attach file"
								>
									<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
										<path
											fillRule="evenodd"
											d="M15.621 4.379a3 3 0 00-4.242 0l-7 7a3 3 0 004.242 4.242l.086-.086a.75.75 0 00-1.06-1.06l-.086.086a1.5 1.5 0 01-2.121-2.121l7-7a1.5 1.5 0 012.121 2.121l-5.5 5.5a.75.75 0 001.06 1.06l5.5-5.5a3 3 0 000-4.242z"
											clipRule="evenodd"
										/>
									</svg>
								</button>
								{/* @mention trigger button */}
								<button
									type="button"
									title="Mention an agent"
									onClick={() => {
										const ta = textareaRef.current;
										if (!ta) return;
										const cursor = ta.selectionStart ?? text.length;
										const newText =
											text.slice(0, cursor) + "@" + text.slice(cursor);
										setText(newText);
										setMentionQuery("");
										setMentionIndex(0);
										setTimeout(() => {
											ta.selectionStart = cursor + 1;
											ta.selectionEnd = cursor + 1;
											ta.focus();
										}, 0);
									}}
									className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors"
								>
									<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
										<path
											fillRule="evenodd"
											d="M5.404 14.596A6.5 6.5 0 1116.5 10a1.25 1.25 0 01-2.5 0 4 4 0 10-.571 2.06A2.75 2.75 0 0018 10a8 8 0 10-6.55 7.83.75.75 0 01.362 1.455A9.5 9.5 0 115.404 14.596zM10 5.5a.75.75 0 01.75.75v.5a.75.75 0 01-1.5 0v-.5A.75.75 0 0110 5.5zm0 5a.75.75 0 01.75.75v.5a.75.75 0 01-1.5 0v-.5a.75.75 0 01.75-.75z"
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
										className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
									>
										Cancel
									</button>
								)}
								<button
									type="button"
									onClick={handleSend}
									disabled={!text.trim()}
									className={cn(
										"inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all",
										text.trim()
											? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
											: "bg-muted text-muted-foreground cursor-not-allowed",
									)}
								>
									<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
										<path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
									</svg>
									Send
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
		{/* Model picker modal (portal-style, outside layout) */}
		<ModelPickerModal
			open={modelPickerOpen}
			onClose={() => setModelPickerOpen(false)}
			availableModels={availableModels}
			currentModel={currentModel}
			onSelectModel={(m) => {
				onSetModel?.(m);
			}}
		/>
		</>
	);
}
