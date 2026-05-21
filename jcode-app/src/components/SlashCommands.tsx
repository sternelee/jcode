import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import type { SessionInfo, ModelRoute } from "@/types";

// ── Slash command catalogue ──────────────────────────────────────────────
export interface SlashCommand {
	name: string;
	description: string;
	/** If true, command is executed on the frontend (no message sent to backend) */
	frontend?: boolean;
	/** Optional argument placeholder shown in autocomplete */
	args?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
	// Model & settings — handled frontend
	{ name: "/model", description: "List or switch the active AI model", frontend: true, args: "[name]" },
	{ name: "/models", description: "Alias for /model", frontend: true, args: "[name]" },
	{ name: "/effort", description: "Set reasoning effort", frontend: true, args: "<low|medium|high|auto>" },
	{ name: "/memory", description: "Toggle memory feature on/off", frontend: true },
	// Conversation control — handled frontend
	{ name: "/clear", description: "Clear conversation history", frontend: true },
	{ name: "/compact", description: "Compact context (background summarisation)", frontend: true },
	{ name: "/rewind", description: "Rewind to a previous message", frontend: true, args: "<N|undo>" },
	// Info — handled frontend
	{ name: "/git", description: "Show git status for the working directory", frontend: true },
	{ name: "/help", description: "Show help and available commands", frontend: true, args: "[command]" },
	// Agent workflows — passed to backend
	{ name: "/btw", description: "Ask a side question in the background", args: "<question>" },
	{ name: "/review", description: "Launch a one-shot review session" },
	{ name: "/judge", description: "Launch a one-shot judge session" },
	{ name: "/poke", description: "Poke model to resume with incomplete todos", args: "[on|off|status]" },
	{ name: "/fix", description: "Recover when the model cannot continue" },
	{ name: "/refactor", description: "Run a safe refactor loop", args: "[focus]" },
	{ name: "/improve", description: "Autonomously improve the repository" },
	{ name: "/overnight", description: "Run a supervised overnight coordinator" },
	{ name: "/convene", description: "Convene all agents in this workspace" },
	{ name: "/context", description: "Show full session context snapshot" },
	{ name: "/info", description: "Show session info and token usage" },
	{ name: "/version", description: "Show current version" },
	{ name: "/subagent", description: "Launch a subagent manually", args: "<prompt>" },
	{ name: "/agents", description: "Configure models for agent roles", args: "[role]" },
	{ name: "/observe", description: "Show latest tool context in the side panel", args: "[on|off|status]" },
];

/** Parse the slash command from text at or before cursor. Returns null if not a slash prefix. */
export function parseSlashQuery(text: string, cursorPos: number): string | null {
	const before = text.slice(0, cursorPos);
	const match = before.match(/(?:^|\s)(\/\w*)$/);
	if (!match) return null;
	return match[1] ?? null;
}

/** Check if text is a complete slash command invocation (starts with / and is a known command) */
export function parseSlashCommand(text: string): { cmd: string; args: string } | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) return null;
	const spaceIdx = trimmed.indexOf(" ");
	const cmd = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
	const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
	return { cmd: cmd.toLowerCase(), args };
}

// ── SlashCommandPalette component ────────────────────────────────────────
interface SlashCommandPaletteProps {
	query: string; // e.g. "/mo" or "/btw"
	onSelect: (command: SlashCommand) => void;
	selectedIndex: number;
	onIndexChange: (idx: number) => void;
}

export function SlashCommandPalette({
	query,
	onSelect,
	selectedIndex,
	onIndexChange,
}: SlashCommandPaletteProps) {
	const q = query.toLowerCase();
	const matches = useMemo(
		() => SLASH_COMMANDS.filter((c) => c.name.startsWith(q)),
		[q],
	);

	if (matches.length === 0) return null;

	return (
		<div className="absolute bottom-full left-0 right-0 mb-1.5 bg-white border border-[#E5E7EB] rounded-xl shadow-xl overflow-hidden z-50 max-h-[320px] overflow-y-auto">
			<div className="px-3 py-1.5 border-b border-[#F3F4F6] text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
				Commands — ↑↓ navigate · Enter run · Esc close
			</div>
			{matches.map((cmd, i) => (
				<button
					key={cmd.name}
					type="button"
					onMouseDown={(e) => {
						e.preventDefault();
						onSelect(cmd);
					}}
					onMouseEnter={() => onIndexChange(i)}
					className={cn(
						"w-full text-left px-3 py-2.5 flex items-center gap-3 text-[13px] transition-colors",
						i === selectedIndex ? "bg-[#EFF6FF]" : "hover:bg-[#F9FAFB]",
					)}
				>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span
								className={cn(
									"font-mono font-semibold text-[12px]",
									i === selectedIndex ? "text-[#2563EB]" : "text-[#374151]",
								)}
							>
								{cmd.name}
								{cmd.args && (
									<span className="text-[#9CA3AF] font-normal ml-1">{cmd.args}</span>
								)}
							</span>
							{cmd.frontend && (
								<span className="text-[9px] font-bold px-1 py-0.5 rounded bg-[#EFF6FF] text-[#3B82F6]">
									UI
								</span>
							)}
						</div>
						<div className="text-[11px] text-[#6B7280] mt-0.5 truncate">
							{cmd.description}
						</div>
					</div>
					<svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-[#D1D5DB] shrink-0">
						<path fillRule="evenodd" d="M2 8a.75.75 0 01.75-.75h8.69L8.22 4.03a.75.75 0 011.06-1.06l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06-1.06l3.22-3.22H2.75A.75.75 0 012 8z" clipRule="evenodd" />
					</svg>
				</button>
			))}
		</div>
	);
}

// ── ModelPickerModal component ────────────────────────────────────────────
interface ModelPickerModalProps {
	open: boolean;
	onClose: () => void;
	availableModels: string[];
	currentModel: string | null;
	onSelectModel: (model: string) => void;
}

export function ModelPickerModal({
	open,
	onClose,
	availableModels,
	currentModel,
	onSelectModel,
}: ModelPickerModalProps) {
	const [search, setSearch] = useState("");
	const [routes, setRoutes] = useState<ModelRoute[]>([]);
	const [loading, setLoading] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const loadModels = useCallback(async () => {
		setLoading(true);
		try {
			const data = await invoke<{ routes: ModelRoute[] }>("get_models");
			setRoutes(data.routes || []);
		} catch {
			// fallback to prop if backend call fails
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open) {
			setSearch("");
			void loadModels();
			setTimeout(() => inputRef.current?.focus(), 50);
		}
	}, [open, loadModels]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && open) onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	// Build model list from routes (prefer backend data, fallback to prop)
	const allModels = useMemo(() => {
		if (routes.length > 0) {
			return routes.map((r) => r.model);
		}
		return availableModels;
	}, [routes, availableModels]);

	const filtered = useMemo(
		() => allModels.filter((m) => m.toLowerCase().includes(search.toLowerCase())),
		[allModels, search],
	);

	const grouped = useMemo(() => {
		const groups: Record<string, string[]> = {};
		for (const m of filtered) {
			const prefix = m.includes("claude")
				? "Claude (Anthropic)"
				: m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")
				? "OpenAI"
				: m.includes("gemini")
				? "Google"
				: m.includes("deepseek")
				? "DeepSeek"
				: m.includes("llama") || m.includes("meta")
				? "Meta"
				: "Other";
			groups[prefix] ??= [];
			groups[prefix].push(m);
		}
		return groups;
	}, [filtered]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0 bg-black/30" onClick={onClose} />
			<div className="relative w-[480px] max-h-[600px] bg-card rounded-2xl shadow-xl border border-border flex flex-col overflow-hidden">
				{/* Header */}
				<div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
					<div className="flex items-center justify-between mb-3">
						<h2 className="text-[16px] font-bold text-foreground">Switch Model</h2>
						<button
							type="button"
							onClick={onClose}
							className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
						>
							<svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
								<path d="M2.22 2.22a.75.75 0 011.06 0L6 4.94l2.72-2.72a.75.75 0 111.06 1.06L7.06 6l2.72 2.72a.75.75 0 11-1.06 1.06L6 7.06l-2.72 2.72a.75.75 0 01-1.06-1.06L4.94 6 2.22 3.28a.75.75 0 010-1.06z" />
							</svg>
						</button>
					</div>
					<div className="relative">
						<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2">
							<path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
						</svg>
						<input
							ref={inputRef}
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder={loading ? "Loading models…" : "Search models…"}
							className="w-full h-9 pl-9 pr-3 rounded-xl bg-muted border border-border text-[13px] text-foreground placeholder-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
						/>
					</div>
				</div>

				{/* Model list */}
				<div className="flex-1 overflow-y-auto px-2 py-2">
					{loading && routes.length === 0 && (
						<div className="text-center py-8 text-[12px] text-muted-foreground">
							Loading models…
						</div>
					)}
					{Object.entries(grouped).map(([group, models]) => (
						<div key={group} className="mb-2">
							<div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
								{group}
							</div>
							{models.map((m) => {
								const isCurrent = m === currentModel;
								return (
									<button
										key={m}
										type="button"
										onClick={() => {
											onSelectModel(m);
											onClose();
										}}
										className={cn(
											"w-full text-left px-3 py-2.5 rounded-xl text-[13px] flex items-center gap-3 transition-colors",
											isCurrent
												? "bg-primary/10 text-primary"
												: "text-foreground hover:bg-muted",
										)}
									>
										<span className="font-mono flex-1 truncate">{m}</span>
										{isCurrent && (
											<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-primary shrink-0">
												<path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
											</svg>
										)}
									</button>
								);
							})}
						</div>
					))}
					{!loading && filtered.length === 0 && (
						<div className="text-center py-8 text-[12px] text-muted-foreground">
							No models match "{search}"
						</div>
					)}
				</div>

				{/* Footer hint */}
				<div className="px-5 py-3 border-t border-border text-[11px] text-muted-foreground shrink-0">
					Use <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-foreground">/model &lt;name&gt;</kbd> in the chat to switch directly
				</div>
			</div>
		</div>
	);
}

// ── AgentSettingsPopover component ────────────────────────────────────────
interface AgentSettingsPopoverProps {
	open: boolean;
	onClose: () => void;
	currentModel: string | null;
	reasoningEffort: string | null;
	memoryEnabled: boolean;
	isProcessing: boolean;
	onOpenModelPicker: () => void;
	onSetEffort: (effort: string) => void;
	onToggleMemory: () => void;
	onCompact: () => void;
	onClearChat: () => void;
	workspaceSessions?: SessionInfo[];
}

const EFFORT_LEVELS = [
	{ value: "low", label: "Low", icon: "⚡" },
	{ value: "medium", label: "Medium", icon: "⚖️" },
	{ value: "high", label: "High", icon: "🧠" },
] as const;

export function AgentSettingsPopover({
	open,
	onClose,
	currentModel,
	reasoningEffort,
	memoryEnabled,
	isProcessing,
	onOpenModelPicker,
	onSetEffort,
	onToggleMemory,
	onCompact,
	onClearChat,
}: AgentSettingsPopoverProps) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onClick = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		setTimeout(() => document.addEventListener("mousedown", onClick), 0);
		return () => document.removeEventListener("mousedown", onClick);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			ref={ref}
			className="absolute top-full right-0 mt-1 w-[300px] bg-white rounded-2xl shadow-xl border border-[#E5E7EB] overflow-hidden z-50"
		>
			{/* Model row */}
			<div className="px-4 py-3 border-b border-[#F3F4F6]">
				<div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
					Model
				</div>
				<button
					type="button"
					onClick={() => { onClose(); onOpenModelPicker(); }}
					className="w-full text-left px-3 py-2 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] hover:border-[#3B82F6] hover:bg-[#EFF6FF] transition-all flex items-center gap-2 group"
				>
					<span className="flex-1 font-mono text-[12px] text-[#374151] truncate">
						{currentModel || "default"}
					</span>
					<svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-[#9CA3AF] group-hover:text-[#3B82F6] shrink-0">
						<path fillRule="evenodd" d="M6.22 4.22a.75.75 0 011.06 0l3.25 3.25a.75.75 0 010 1.06l-3.25 3.25a.75.75 0 01-1.06-1.06L9 8 6.22 5.28a.75.75 0 010-1.06z" clipRule="evenodd" />
					</svg>
				</button>
			</div>

			{/* Reasoning effort */}
			<div className="px-4 py-3 border-b border-[#F3F4F6]">
				<div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
					Reasoning Effort
				</div>
				<div className="flex gap-1.5">
					{EFFORT_LEVELS.map(({ value, label, icon }) => (
						<button
							key={value}
							type="button"
							onClick={() => onSetEffort(value)}
							className={cn(
								"flex-1 py-2 rounded-xl text-[12px] font-medium transition-all border flex flex-col items-center gap-1",
								(reasoningEffort ?? "medium") === value
									? "bg-[#EFF6FF] border-[#3B82F6] text-[#2563EB]"
									: "bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]",
							)}
						>
							<span className="text-base">{icon}</span>
							<span>{label}</span>
						</button>
					))}
				</div>
			</div>

			{/* Memory toggle */}
			<div className="px-4 py-3 border-b border-[#F3F4F6]">
				<div className="flex items-center justify-between">
					<div>
						<div className="text-[13px] font-semibold text-[#374151]">Memory</div>
						<div className="text-[11px] text-[#9CA3AF]">Project-scoped long-term memory</div>
					</div>
					<button
						type="button"
						onClick={onToggleMemory}
						className={cn(
							"w-10 h-6 rounded-full transition-all relative",
							memoryEnabled ? "bg-[#3B82F6]" : "bg-[#D1D5DB]",
						)}
					>
						<span
							className={cn(
								"absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all",
								memoryEnabled ? "right-0.5" : "left-0.5",
							)}
						/>
					</button>
				</div>
			</div>

			{/* Actions */}
			<div className="px-4 py-3 flex flex-col gap-1.5">
				<div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
					Session Actions
				</div>
				<button
					type="button"
					onClick={() => { onClose(); onCompact(); }}
					className="w-full text-left px-3 py-2 rounded-xl text-[13px] text-[#374151] hover:bg-[#F3F4F6] transition-colors flex items-center gap-2"
				>
					<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-[#9CA3AF]">
						<path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
					</svg>
					Compact context
					<span className="ml-auto text-[11px] font-mono text-[#9CA3AF]">/compact</span>
				</button>
				<button
					type="button"
					onClick={() => { onClose(); onClearChat(); }}
					disabled={isProcessing}
					className="w-full text-left px-3 py-2 rounded-xl text-[13px] text-[#EF4444] hover:bg-[#FEF2F2] transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
				>
					<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
						<path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
					</svg>
					Clear chat
					<span className="ml-auto text-[11px] font-mono text-[#9CA3AF]">/clear</span>
				</button>
			</div>
		</div>
	);
}
