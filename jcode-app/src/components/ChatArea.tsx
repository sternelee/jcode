import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import type { ChatMessage, SessionInfo } from "@/types";
import { MessageBubble } from "./MessageBubble";
import { AgentAvatar } from "./AgentAvatar";
import {
	Search,
	Settings,
	ChevronUp,
	ChevronDown,
	ArrowDown,
	X,
	Plus,
	Play,
	Terminal,
	Lightbulb,
	UserPlus,
	Paperclip,
	SendHorizonal,
	Mic,
	Loader2,
	FileText,
	Shield,
	Circle,
} from "lucide-react";
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
	connected?: boolean;
	currentModel?: string | null;
	totalTokens?: [number, number] | null;
	currentProfileId?: string | null;
	reasoningEffort?: string | null;
	memoryEnabled?: boolean;
	availableModels?: string[];
	onSetModel?: (model: string, profileId?: string) => void;
	onSetAgentModel?: (
		sessionId: string,
		model: string,
		profileId?: string,
	) => void;
	onSetEffort?: (effort: string) => void;
	onToggleMemory?: () => void;
	onCompact?: () => void;
	onClearChat?: () => void;
	onRenameSession?: (sessionId: string, newName: string) => void;
	currentSessionId?: string | null;
	onRunDictation?: () => Promise<{ text: string; mode: string } | null>;
	onSendSoftInterrupt?: (content: string) => Promise<void>;
	onRegenerateMessage?: (messageIndex: number) => void;
	onEditMessage?: (messageIndex: number, newContent: string) => void;
	onQuoteMessage?: (content: string, role: string) => void;
	currentWorkingDir?: string | null;
	onExecuteShellCommand?: (
		command: string,
		workingDir?: string | null,
		sessionId?: string,
	) => Promise<void>;
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
	connected = true,
	currentModel = null,
	totalTokens = null,
	currentProfileId = null,
	reasoningEffort = null,
	memoryEnabled = true,
	availableModels = [],
	onSetModel,
	onSetAgentModel,
	onSetEffort,
	onToggleMemory,
	onCompact,
	onClearChat,
	onRenameSession,
	currentSessionId,
	onRunDictation,
	onSendSoftInterrupt,
	onRegenerateMessage,
	onEditMessage,
	onQuoteMessage,
	currentWorkingDir,
	onExecuteShellCommand,
}: ChatAreaProps) {
	const [text, setText] = useState("");
	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [mentionIndex, setMentionIndex] = useState(0);
	const [fileList, setFileList] = useState<string[]>([]);
	const [fileMatches, setFileMatches] = useState<string[]>([]);
	const [slashQuery, setSlashQuery] = useState<string | null>(null);
	const [slashIndex, setSlashIndex] = useState(0);
	const [convening, setConvening] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [modelPickerAgentSessionId, setModelPickerAgentSessionId] = useState<
		string | null
	>(null);
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchText, setSearchText] = useState("");
	const [searchMatchIdx, setSearchMatchIdx] = useState(0);
	const [attachedImages, setAttachedImages] = useState<
		Array<{ id: string; mediaType: string; base64: string; name: string }>
	>([]);
	const [dictating, setDictating] = useState(false);
	const [softInterruptMode, setSoftInterruptMode] = useState(false);
	const [showScrollButton, setShowScrollButton] = useState(false);

	const feedRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Listen for quote-to-input prefills from MessageBubble actions
	useEffect(() => {
		const handler = (e: Event) => {
			const detail = (e as CustomEvent).detail as string;
			if (typeof detail === "string") {
				setText((prev) => (prev ? prev + "\n" + detail : detail));
				textareaRef.current?.focus();
			}
		};
		window.addEventListener("jcode:prefill-input", handler);
		return () => window.removeEventListener("jcode:prefill-input", handler);
	}, []);

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
	const mentionAgentMatches = useMemo(() => {
		if (mentionQuery === null) return [] as string[];
		const q = mentionQuery.toLowerCase();
		return channelMembers.filter((name) => name.toLowerCase().startsWith(q));
	}, [mentionQuery, channelMembers]);

	// Load file list when @ is triggered
	useEffect(() => {
		if (mentionQuery === null) {
			setFileMatches([]);
			return;
		}
		const q = mentionQuery.toLowerCase();
		if (fileList.length > 0) {
			setFileMatches(
				fileList.filter((f) => f.toLowerCase().includes(q)).slice(0, 50),
			);
		} else if (currentWorkingDir) {
			invoke<string[]>("list_workspace_files", { workingDir: currentWorkingDir })
				.then((files) => {
					setFileList(files);
					setFileMatches(
						files.filter((f) => f.toLowerCase().includes(q)).slice(0, 50),
					);
				})
				.catch(() => setFileMatches([]));
		}
	}, [mentionQuery, fileList, currentWorkingDir]);

	const totalMentionMatches = mentionAgentMatches.length + fileMatches.length;

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

	// ── Scroll position & auto-scroll ─────────────────────────────────────
	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		const el = feedRef.current;
		if (!el) return;
		el.scrollTo({ top: el.scrollHeight, behavior });
	}, []);

	const checkScrollPosition = useCallback(() => {
		const el = feedRef.current;
		if (!el) return;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
		setShowScrollButton(!nearBottom);
	}, []);

	useEffect(() => {
		const el = feedRef.current;
		if (!el) return;
		const onScroll = () => checkScrollPosition();
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [checkScrollPosition]);

	// Auto-scroll when new messages arrive or content streams in
	useEffect(() => {
		const el = feedRef.current;
		if (!el) return;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
		if (nearBottom || messages.length <= 2) {
			// Use requestAnimationFrame to ensure DOM has updated
			requestAnimationFrame(() => {
				scrollToBottom("auto");
				setShowScrollButton(false);
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		messages.length,
		messages[messages.length - 1]?.content,
		messages[messages.length - 1]?.isStreaming,
		scrollToBottom,
	]);

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
		if (!content && attachedImages.length === 0) return;
		if (softInterruptMode && onSendSoftInterrupt) {
			onSendSoftInterrupt(content);
			setText("");
			setMentionQuery(null);
			setAttachedImages([]);
			return;
		}
		// Handle `!` shell commands like TUI
		if (content.startsWith('!') && onExecuteShellCommand) {
			const command = content.slice(1).trim();
			if (command) {
				void onExecuteShellCommand(command, currentWorkingDir);
			}
			setText("");
			setMentionQuery(null);
			setAttachedImages([]);
			return;
		}
		const images: [string, string][] = attachedImages.map((img) => [
			img.mediaType,
			img.base64,
		]);
		onSend(content, images.length > 0 ? images : undefined);
		setText("");
		setMentionQuery(null);
		setAttachedImages([]);
	};

	const handleDictation = async () => {
		if (!onRunDictation || dictating) return;
		setDictating(true);
		try {
			const result = await onRunDictation();
			if (!result) return;
			const { text: transcript, mode } = result;
			if (!transcript) return;
			const normalized = transcript.trim();
			if (!normalized) return;
			switch (mode) {
				case "send": {
					onSend(normalized, undefined);
					setText("");
					break;
				}
				case "replace": {
					setText(normalized);
					break;
				}
				case "append": {
					setText((prev) =>
						prev.trim() ? `${prev.trim()} ${normalized}` : normalized,
					);
					break;
				}
				case "insert":
				default: {
					const ta = textareaRef.current;
					if (ta) {
						const cursor = ta.selectionStart ?? text.length;
						const before = text.slice(0, cursor);
						const after = text.slice(cursor);
						const spacer =
							before.length > 0 && !before.endsWith(" ") ? " " : "";
						const newText = before + spacer + normalized + after;
						setText(newText);
						setTimeout(() => {
							ta.focus();
							ta.selectionStart = cursor + spacer.length + normalized.length;
							ta.selectionEnd = ta.selectionStart;
						}, 0);
					} else {
						setText((prev) =>
							prev.trim() ? `${prev.trim()} ${normalized}` : normalized,
						);
					}
					break;
				}
			}
		} catch (e) {
			console.error("Dictation failed:", e);
		} finally {
			setDictating(false);
		}
	};

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (!files || files.length === 0) return;
		for (const file of Array.from(files)) {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				const base64 = result.split(",")[1] || "";
				const mediaType = file.type || "image/png";
				setAttachedImages((prev) => [
					...prev,
					{
						id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
						mediaType,
						base64,
						name: file.name,
					},
				]);
			};
			reader.readAsDataURL(file);
		}
		e.target.value = "";
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
		if (mentionQuery !== null && totalMentionMatches > 0) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setMentionIndex((i) => Math.min(i + 1, totalMentionMatches - 1));
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setMentionIndex((i) => Math.max(i - 1, 0));
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				if (mentionIndex < mentionAgentMatches.length) {
					const n = mentionAgentMatches[mentionIndex];
					if (n) insertMention(n);
				} else {
					const f = fileMatches[mentionIndex - mentionAgentMatches.length];
					if (f) insertMention(f);
				}
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



	return (
		<>
			<div className="flex-1 flex flex-col overflow-hidden bg-card">
				{/* ── Channel Header ── */}
				<div className="px-5 py-2.5 border-b border-border flex items-center justify-between shrink-0 min-h-[48px]">
					<div className="flex items-center gap-2.5 min-w-0">
						<div className="w-7 h-7 rounded-lg bg-foreground/[0.06] flex items-center justify-center shrink-0">
							<Plus className="w-4 h-4 text-foreground/60" />
						</div>
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<h2 className="text-[14px] font-medium text-foreground leading-tight truncate">
									{channelName}
								</h2>
								<span
									title={connected ? "Connected" : "Disconnected"}
									className={cn(
										"w-1.5 h-1.5 rounded-full shrink-0",
										connected
											? isLoading
												? "bg-amber-500 animate-pulse"
												: "bg-emerald-500"
											: "bg-destructive",
									)}
								/>
							</div>
							{channelMembers.length > 0 && (
								<p className="text-[11px] text-muted-foreground mt-0.5 truncate">
									{channelMembers.join(", ")}
								</p>
							)}
						</div>
					</div>

					<div className="flex items-center gap-0.5 shrink-0 relative">
						{/* Search */}
						<button
							type="button"
							onClick={() => setSearchOpen((o) => !o)}
							title="Search (Cmd+F)"
							className={cn(
								"w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150",
								searchOpen
									? "bg-foreground/[0.06] text-foreground"
									: "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted",
							)}
						>
							<Search className="w-3.5 h-3.5" />
						</button>
						{/* Settings */}
						<button
							type="button"
							onClick={() => setSettingsOpen((o) => !o)}
							title="Settings"
							className={cn(
								"w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150",
								settingsOpen
									? "bg-foreground/[0.06] text-foreground"
									: "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted",
							)}
						>
							<Settings className="w-3.5 h-3.5" />
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
								(s) =>
									s.sessionId === currentSessionId &&
									(!!s.roleName || s.swarmRole === "coordinator"),
							)}
							totalTokens={totalTokens}
						/>{" "}
						{/* Convene */}
						{workspaceSessions.some(
							(s) => s.roleName || s.swarmRole === "coordinator",
						) &&
							onConvene && (
							<button
								type="button"
								onClick={() => {
									onConvene();
									setConvening(true);
									setTimeout(() => setConvening(false), 4000);
								}}
								className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground/[0.08] text-foreground/70 text-[11px] font-medium hover:bg-foreground/[0.12] transition-all duration-150 ml-1"
							>
								<Play className="w-3 h-3" />
								Convene
							</button>
						)}
					</div>
				</div>

				{/* ── Agent status bar ── */}
				{workspaceSessions.some(
					(s) => s.roleName || s.swarmRole === "coordinator",
				) && (
					<div className="px-5 py-1 border-b border-border bg-muted/20 flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
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
								<UserPlus className="w-3 h-3" />+ Add Agent
							</button>
						)}
					</div>
				)}

				{/* ── Search bar ── */}
				{searchOpen && (
					<div className="flex items-center gap-2 px-5 py-2 border-b border-border bg-muted/30 shrink-0">
						<Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
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
							<ChevronUp className="w-3 h-3" />
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
							<ChevronDown className="w-3 h-3" />
						</button>
						<button
							type="button"
							onClick={() => setSearchOpen(false)}
							className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
							title="Close"
						>
							<X className="w-2.5 h-2.5" />
						</button>
					</div>
				)}

				{/* ── Message Feed ── */}
				<div ref={feedRef} className="flex-1 overflow-y-auto px-5 py-4 relative">
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
												"max-w-[80%] min-w-0",
												isCurrentMatch &&
													"ring-1 ring-foreground/20 rounded-2xl",
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
												"bg-secondary text-secondary-fg rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap",
												isSearchMatch &&
													!isCurrentMatch &&
													"ring-1 ring-foreground/10",
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
													onRegenerate={() => onRegenerateMessage?.(idx)}
														onEdit={(newContent) => onEditMessage?.(idx, newContent)}
														onQuote={(content, role) => onQuoteMessage?.(content, role)}
												/>
											</div>
										</div>
									</div>
								);
							}						// ── Assistant (default) — with execution timeline ──
						return (
							<div
								key={msg.id}
								data-msg-id={msg.id}
								className={cn(
									"group/msg message-enter relative flex gap-3",
									isCurrentMatch && "ring-1 ring-foreground/20 rounded-xl",
								)}
							>
								{showUnreadSeparator && <UnreadSeparator />}
								<div className="relative flex flex-col items-center w-5 shrink-0">
									<div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px border-l border-dashed border-border/50" />
									<div className="relative z-10 mt-1 w-5 h-5 rounded-full bg-card border border-border flex items-center justify-center">
										{msg.isStreaming ? (
											<Loader2 className="w-3 h-3 text-primary animate-spin" />
										) : msg.content.includes("```") || msg.content.includes("$ ") ? (
											<Terminal className="w-3 h-3 text-muted-foreground" />
										) : msg.content.length > 200 ? (
											<Lightbulb className="w-3 h-3 text-amber-500" />
										) : (
											<div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
										)}
									</div>
								</div>
								<div className="flex-1 min-w-0">
									<MessageBubble
										message={msg}
										isStreaming={msg.isStreaming}
										hideHeader
										onRegenerate={() => onRegenerateMessage?.(idx)}
										onEdit={(newContent) => onEditMessage?.(idx, newContent)}
										onQuote={(content, role) => onQuoteMessage?.(content, role)}
									/>
								</div>
							</div>
						);
						})}

						{/* ── Typing indicator ── */}
						{respondingRoles.length > 0 && (
							<div className="flex flex-col gap-2 pl-1">
								{respondingRoles.map((role) => (
									<div
										key={role}
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
												{`${role} is typing…`}
											</span>
										</div>
									</div>
								))}
							</div>
						)}
					</div>

					{/* ── Scroll-to-bottom button ── */}
					{showScrollButton && messages.length > 0 && (
						<button
							onClick={() => scrollToBottom("smooth")}
							className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 px-3 py-2 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all duration-200 animate-fade-in"
							title="Scroll to bottom"
						>
							<ArrowDown className="w-3.5 h-3.5" />
							<span className="text-[12px] font-medium">New</span>
						</button>
					)}
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
						{mentionQuery !== null && totalMentionMatches > 0 && (
							<div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50 animate-fade-in max-h-80 flex flex-col">
								<div className="overflow-y-auto">
									{mentionAgentMatches.length > 0 && (
										<>
											<div className="px-3 py-1.5 border-b border-border text-[10px] font-medium text-muted-foreground uppercase tracking-wider sticky top-0 bg-card">
												Agents — ↑↓ Enter
											</div>
											{mentionAgentMatches.map((name, i) => {
												const mr = memberRole(name);
												const as = sessionByRoleName.get(name);
												return (
													<button
														key={`agent-${name}`}
														type="button"
														onMouseDown={(e) => {
															e.preventDefault();
															insertMention(name);
														}}
														className={cn(
															"w-full text-left px-3 py-2 flex items-center gap-2.5 text-[13px] transition-colors",
															i === mentionIndex ? "bg-muted" : "hover:bg-muted/50",
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
																		? "text-foreground"
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
										</>
									)}
									{fileMatches.length > 0 && (
										<>
											<div className="px-3 py-1.5 border-b border-border text-[10px] font-medium text-muted-foreground uppercase tracking-wider sticky top-0 bg-card">
												Files — ↑↓ Enter
											</div>
											{fileMatches.map((fpath, i) => {
												const globalIndex = mentionAgentMatches.length + i;
												return (
													<button
														key={`file-${fpath}`}
														type="button"
														onMouseDown={(e) => {
															e.preventDefault();
															insertMention(fpath);
														}}
														className={cn(
															"w-full text-left px-3 py-2 flex items-center gap-2.5 text-[13px] transition-colors",
															globalIndex === mentionIndex ? "bg-muted" : "hover:bg-muted/50",
														)}
													>
														<FileText className="w-4 h-4 text-muted-foreground shrink-0" />
														<div className="flex-1 min-w-0">
															<span
																className={cn(
																	"font-medium truncate block",
																	globalIndex === mentionIndex
																		? "text-foreground"
																		: "text-foreground",
																)}
															>
																{fpath}
															</span>
														</div>
													</button>
												);
											})}
										</>
									)}
								</div>
							</div>
						)}

						{/* Input box */}
						<div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-foreground/10 transition-all duration-150">
							{/* Image previews */}
							{attachedImages.length > 0 && (
								<div className="flex gap-2 px-4 pt-3 pb-1 flex-wrap">
									{attachedImages.map((img) => (
										<div key={img.id} className="relative group/img shrink-0">
											<img
												src={`data:${img.mediaType};base64,${img.base64}`}
												alt={img.name}
												className="w-14 h-14 rounded-lg object-cover border border-border"
											/>
											<button
												type="button"
												onClick={() =>
													setAttachedImages((prev) =>
														prev.filter((i) => i.id !== img.id),
													)
												}
												className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover/img:opacity-100 transition-opacity shadow-sm"
												title="Remove"
											>
												<X className="w-2.5 h-2.5" />
											</button>
										</div>
									))}
								</div>
							)}
							<textarea
								ref={textareaRef}
								value={text}
								onChange={handleChange}
								onKeyDown={handleKeyDown}
								placeholder="Follow up here…"
								rows={1}
								className="w-full px-4 pt-3 pb-2 text-[14px] text-foreground placeholder-muted-foreground/50 outline-none resize-none bg-transparent"
								style={{ minHeight: 44, maxHeight: 120 }}
							/>
							<div className="flex items-center justify-between px-2 py-1.5 border-t border-border">
								<div className="flex items-center gap-0.5">
									{/* Attach */}
									<button
										type="button"
										onClick={() => fileInputRef.current?.click()}
										className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-all"
										title="Attach files"
									>
										<Paperclip className="w-4 h-4" />
									</button>
									{/* Full access shield */}
									<button
										type="button"
										className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-all"
										title="Access mode"
									>
										<Shield className="w-3.5 h-3.5" />
										Full access
										<ChevronDown className="w-3 h-3" />
									</button>
									{/* Dictation */}
									{onRunDictation && (
										<button
											type="button"
											title="Voice input"
											onClick={handleDictation}
											disabled={dictating}
											className={cn(
												"w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150",
												dictating
													? "text-primary bg-primary/10 animate-pulse"
													: "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted",
											)}
										>
											{dictating ? (
												<Loader2 className="w-4 h-4 animate-spin" />
											) : (
												<Mic className="w-4 h-4" />
											)}
										</button>
									)}
								</div>

								<div className="flex items-center gap-2">
									{/* Model label */}
									<span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium text-muted-foreground/60">
										<Circle className="w-2 h-2 fill-current opacity-50" />
										{currentModel ? `${currentProfileId ?? ""} ${currentModel}`.trim() : "Agent"}
									</span>
									{isProcessing && onSendSoftInterrupt && (
										<button
											type="button"
											onClick={() => setSoftInterruptMode((m) => !m)}
											className={cn(
												"px-2 py-1 rounded-lg text-[11px] font-medium transition-all border",
												softInterruptMode
													? "bg-amber-500/10 text-amber-600 border-amber-500/30"
													: "text-muted-foreground border-border hover:text-foreground hover:bg-muted",
											)}
									>
										{softInterruptMode ? "Interrupt" : "Send"}
									</button>
									)}
									{isProcessing ? (
										<button
											type="button"
											onClick={onCancel}
											className="w-7 h-7 rounded-full bg-foreground flex items-center justify-center hover:bg-foreground/90 transition-all shrink-0"
											title="Stop generation"
										>
											<div className="w-3 h-3 rounded-sm bg-background" />
										</button>
									) : (
										<button
											type="button"
											onClick={handleSend}
											disabled={!text.trim() && attachedImages.length === 0}
											className={cn(
												"w-7 h-7 rounded-full flex items-center justify-center transition-all shrink-0",
												text.trim() || attachedImages.length > 0
													? "bg-foreground text-background hover:bg-foreground/90"
													: "bg-muted text-muted-foreground/40 cursor-not-allowed",
											)}
										>
											<SendHorizonal className="w-4 h-4" />
										</button>
									)}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* ── Hidden file input ── */}
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				multiple
				onChange={handleFileSelect}
				className="hidden"
			/>
			{/* Model picker modal */}
			<ModelPickerModal
				open={modelPickerOpen}
				onClose={() => setModelPickerOpen(false)}
				availableModels={availableModels}
				currentModel={currentModel}
				currentProfileId={currentProfileId}
				onSelectModel={(m, pid) => {
					if (modelPickerAgentSessionId && onSetAgentModel) {
						onSetAgentModel(modelPickerAgentSessionId, m, pid);
						setModelPickerAgentSessionId(null);
					} else {
						onSetModel?.(m, pid);
					}
				}}
			/>
		</>
	);
}
