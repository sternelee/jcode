import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import type { ModelRoute, ProviderCatalogEntry } from "@/types";
import type { ProviderAuthPrompt, ProviderConfigOption } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	KeyRound,
	Link2,
	ExternalLink,
	Loader2,
	ChevronDown,
	ChevronRight,
	RefreshCw,
} from "lucide-react";

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

	{
		name: "/effort",
		description: "Set reasoning effort",
		frontend: true,
		args: "<low|medium|high|auto>",
	},
	{
		name: "/memory",
		description: "Toggle memory feature on/off",
		frontend: true,
	},
	// Conversation control — handled frontend
	{ name: "/clear", description: "Clear conversation history", frontend: true },
	{
		name: "/compact",
		description: "Compact context (background summarisation)",
		frontend: true,
	},
	{
		name: "/rewind",
		description: "Rewind to a previous message",
		frontend: true,
		args: "<N|undo>",
	},
	{
		name: "/rename",
		description: "Rename the current session",
		args: "<title>",
	},
	{ name: "/stop", description: "Interrupt the running generation" },
	{ name: "/cancel", description: "Alias for /stop" },
	// Info — handled frontend
	{
		name: "/git",
		description: "Show git status for the working directory",
		frontend: true,
	},
	{ name: "/status", description: "Show session status and metadata" },
	{
		name: "/help",
		description: "Show help and available commands",
		frontend: true,
		args: "[command]",
	},
	// Agent workflows — passed to backend
	{
		name: "/btw",
		description: "Ask a side question in the background",
		args: "<question>",
	},
	{ name: "/review", description: "Launch a one-shot review session" },
	{ name: "/judge", description: "Launch a one-shot judge session" },
	{
		name: "/poke",
		description: "Poke model to resume with incomplete todos",
		args: "[on|off|status]",
	},
	{ name: "/fix", description: "Recover when the model cannot continue" },
	{
		name: "/refactor",
		description: "Run a safe refactor loop",
		args: "[focus]",
	},
	{ name: "/improve", description: "Autonomously improve the repository" },
	{ name: "/overnight", description: "Run a supervised overnight coordinator" },
	{ name: "/context", description: "Show full session context snapshot" },
	{ name: "/info", description: "Show session info and token usage" },
	{ name: "/usage", description: "Show provider usage limits" },
	{ name: "/version", description: "Show current version" },
	{ name: "/dictate", description: "Run speech-to-text and inject transcript" },
	{
		name: "/subagent",
		description: "Launch a subagent manually",
		args: "<prompt>",
	},
	{
		name: "/observe",
		description: "Show latest tool context in the side panel",
		args: "[on|off|status]",
	},
	{
		name: "/plan",
		description: "Enter planning mode to create an actionable plan",
		args: "[goal]",
	},
	{
		name: "/convene",
		description: "Ask all agents to contribute their perspectives",
	},
];

/** Parse the slash command from text at or before cursor. Returns null if not a slash prefix. */
export function parseSlashQuery(
	text: string,
	cursorPos: number,
): string | null {
	const before = text.slice(0, cursorPos);
	const match = before.match(/(?:^|\s)(\/\w*)$/);
	if (!match) return null;
	return match[1] ?? null;
}

/** Check if text is a complete slash command invocation (starts with / and is a known command) */
export function parseSlashCommand(
	text: string,
): { cmd: string; args: string } | null {
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
		<div className="absolute bottom-full left-0 right-0 mb-1.5 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-50 max-h-[320px] overflow-y-auto">
			<div className="px-3 py-1.5 border-b border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
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
						i === selectedIndex ? "bg-primary/10" : "hover:bg-muted/50",
					)}
				>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span
								className={cn(
									"font-mono font-semibold text-[12px]",
									i === selectedIndex ? "text-primary" : "text-foreground",
								)}
							>
								{cmd.name}
								{cmd.args && (
									<span className="text-muted-foreground font-normal ml-1">
										{cmd.args}
									</span>
								)}
							</span>
							{cmd.frontend && (
								<span className="text-[9px] font-bold px-1 py-0.5 rounded bg-primary/10 text-primary">
									UI
								</span>
							)}
						</div>
						<div className="text-[11px] text-muted-foreground mt-0.5 truncate">
							{cmd.description}
						</div>
					</div>
					<svg
						viewBox="0 0 16 16"
						fill="currentColor"
						className="w-3 h-3 text-muted-foreground/30 shrink-0"
					>
						<path
							fillRule="evenodd"
							d="M2 8a.75.75 0 01.75-.75h8.69L8.22 4.03a.75.75 0 011.06-1.06l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06-1.06l3.22-3.22H2.75A.75.75 0 012 8z"
							clipRule="evenodd"
						/>
					</svg>
				</button>
			))}
		</div>
	);
}

// ── Provider-profile helpers (mirror backend grouping logic) ─────────────

/** Map a provider display name to its auth/profile ID. Mirrors backend direct_config_provider_id. */
function profileIdFromDisplayName(displayName: string): string | null {
	const normalized = displayName.trim().toLowerCase();
	switch (normalized) {
		case "anthropic":
			return "claude";
		case "openai":
			return "openai";
		case "cursor":
			return "cursor";
		case "copilot":
		case "github copilot":
			return "copilot";
		case "gemini":
		case "google gemini":
			return "gemini";
		case "antigravity":
			return "antigravity";
		case "aws bedrock":
		case "bedrock":
			return "bedrock";
		case "jcode":
		case "jcode subscription":
			return "jcode";
		default:
			return null;
	}
}

/** Extract the profile ID from a ModelRoute. Must align with backend auth_provider_id. */
function profileIdFromRoute(route: ModelRoute): string {
	if (route.api_method?.startsWith("openai-compatible:")) {
		const suffix = route.api_method.slice("openai-compatible:".length).trim();
		if (suffix) return suffix;
	}
	if (route.api_method === "openrouter") {
		return "openrouter";
	}
	if (route.api_method === "openai-compatible") {
		const fromDisplay = profileIdFromDisplayName(route.provider);
		if (fromDisplay) return fromDisplay;
	}
	const p = route.provider.toLowerCase();
	if (p === "auto") return "openrouter";
	return p;
}

/** Extract profile ID from a ProviderCatalogEntry. */
function profileIdFromProvider(provider: ProviderCatalogEntry): string {
	return provider.auth_provider_id || provider.provider_key;
}

function optionKey(profileId: string, option: ProviderConfigOption): string {
	return `${profileId}:${option.provider_id}:${option.kind}`;
}

function statusBadgeVariant(
	status: ProviderCatalogEntry["status"],
): "secondary" | "outline" | "destructive" {
	switch (status) {
		case "available":
			return "secondary";
		case "expired":
			return "destructive";
		default:
			return "outline";
	}
}

function statusLabel(status: ProviderCatalogEntry["status"]): string {
	switch (status) {
		case "available":
			return "configured";
		case "expired":
			return "expired";
		case "not_configured":
			return "未配置";
		default:
			return "status unknown";
	}
}

interface ProviderDraftState {
	apiKey?: string;
	authInput?: string;
	extras?: Record<string, string>;
}

// ── ModelPickerModal component ────────────────────────────────────────────
interface ModelPickerModalProps {
	open: boolean;
	onClose: () => void;
	availableModels: string[];
	currentModel: string | null;
	currentProfileId: string | null;
	onSelectModel: (model: string, profileId?: string) => void;
	closeOnSelect?: boolean;
}

export function ModelPickerModal({
	open,
	onClose,
	availableModels,
	currentModel,
	currentProfileId,
	onSelectModel,
	closeOnSelect = true,
}: ModelPickerModalProps) {
	const [search, setSearch] = useState("");
	const [routes, setRoutes] = useState<ModelRoute[]>([]);
	const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
	const [loading, setLoading] = useState(false);
	// Cache get_models result to avoid refetching every time modal opens
	const cachedModelsRef = useRef<{
		routes: ModelRoute[];
		providers: ProviderCatalogEntry[];
		timestamp: number;
	} | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const [collapsedProfiles, setCollapsedProfiles] = useState<
		Record<string, boolean>
	>({});
	const [providerDrafts, setProviderDrafts] = useState<
		Record<string, ProviderDraftState>
	>({});
	const [selectedOptionByProvider, setSelectedOptionByProvider] = useState<
		Record<string, string>
	>({});
	const [providerBusy, setProviderBusy] = useState<Record<string, boolean>>({});
	const [providerMessages, setProviderMessages] = useState<
		Record<string, string | null>
	>({});
	const [providerErrors, setProviderErrors] = useState<
		Record<string, string | null>
	>({});
	const [authPrompts, setAuthPrompts] = useState<
		Record<string, ProviderAuthPrompt | null>
	>({});

	const loadModels = useCallback(async (force = false) => {
		// Use cached result if available and not forcing refresh (cache for 30s)
		const now = Date.now();
		const cache = cachedModelsRef.current;
		if (!force && cache && now - cache.timestamp < 30000) {
			setRoutes(cache.routes);
			setProviders(cache.providers);
			return;
		}
		setLoading(true);
		try {
			const data = await invoke<{
				routes: ModelRoute[];
				providers: ProviderCatalogEntry[];
			}>("get_models");
			const newRoutes = data.routes || [];
			const newProviders = data.providers || [];
			setRoutes(newRoutes);
			setProviders(newProviders);
			cachedModelsRef.current = {
				routes: newRoutes,
				providers: newProviders,
				timestamp: Date.now(),
			};
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

	// Group routes by provider profile, deduplicating models within each group.
	const groupedProfiles = useMemo(() => {
		const profileMap = new Map<string, ProviderCatalogEntry>();
		for (const p of providers) {
			profileMap.set(profileIdFromProvider(p), p);
		}

		const routeGroups = new Map<string, ModelRoute[]>();
		for (const route of routes) {
			const pid = profileIdFromRoute(route);
			const bucket = routeGroups.get(pid) || [];
			bucket.push(route);
			routeGroups.set(pid, bucket);
		}

		// Collect all profile keys (from both providers and routes)
		const profileKeys = new Set<string>();
		profileMap.forEach((_, pid) => profileKeys.add(pid));
		routeGroups.forEach((_, pid) => profileKeys.add(pid));

		const groups = Array.from(profileKeys)
			.map((pid) => {
				const provider = profileMap.get(pid) || null;
				const groupRoutes = routeGroups.get(pid) || [];
				// Sort: current model first, then available, then by name
				const sorted = [...groupRoutes].sort((a, b) => {
					const aCurrent = a.model === currentModel ? 0 : 1;
					const bCurrent = b.model === currentModel ? 0 : 1;
					if (aCurrent !== bCurrent) return aCurrent - bCurrent;
					const aAvail = a.available === false ? 1 : 0;
					const bAvail = b.available === false ? 1 : 0;
					if (aAvail !== bAvail) return aAvail - bAvail;
					return a.model.localeCompare(b.model);
				});
				// Deduplicate by model name (keep first / best)
				const seen = new Set<string>();
				const deduped = sorted.filter((r) => {
					if (seen.has(r.model)) return false;
					seen.add(r.model);
					return true;
				});
				const rawLabel =
					provider?.display_name || provider?.provider_key || pid;
				return {
					profileId: pid,
					label: rawLabel === "auto" ? "OpenRouter" : rawLabel,
					provider,
					models: deduped,
					isCurrentProfile: pid === currentProfileId,
					configured: provider?.configured ?? true,
					hasConfigSurface: provider?.has_config_surface ?? false,
				};
			})
			.filter((g) => g.models.length > 0)
			.sort((a, b) => {
				// Current provider first, then configured, then alphabetically
				const aCurrent = a.provider?.is_current_provider ? 0 : 1;
				const bCurrent = b.provider?.is_current_provider ? 0 : 1;
				if (aCurrent !== bCurrent) return aCurrent - bCurrent;
				const aConfigured = a.provider?.configured !== false ? 0 : 1;
				const bConfigured = b.provider?.configured !== false ? 0 : 1;
				if (aConfigured !== bConfigured) return aConfigured - bConfigured;
				return a.label.localeCompare(b.label);
			});

		return groups;
	}, [routes, providers, currentModel, currentProfileId]);

	// Apply search filter to each group
	const filteredGroups = useMemo(() => {
		if (!search.trim()) return groupedProfiles;
		const q = search.toLowerCase();
		return groupedProfiles
			.map((g) => ({
				...g,
				models: g.models.filter((r) => r.model.toLowerCase().includes(q)),
			}))
			.filter((g) => g.models.length > 0);
	}, [groupedProfiles, search]);

	// Fallback: prop-based model list when backend is unavailable
	const fallbackFiltered = useMemo(() => {
		if (routes.length > 0) return [];
		const q = search.toLowerCase();
		return availableModels.filter((m) => m.toLowerCase().includes(q));
	}, [routes.length, availableModels, search]);

	useEffect(() => {
		setCollapsedProfiles((current) => {
			let changed = false;
			const next = { ...current };
			for (const group of groupedProfiles) {
				if (!(group.profileId in next)) {
					next[group.profileId] = group.provider
						? !group.provider.configured
						: false;
					changed = true;
				}
			}
			return changed ? next : current;
		});
	}, [groupedProfiles]);

	const setDraftValue = useCallback(
		(profileId: string, field: keyof ProviderDraftState, value: string) => {
			setProviderDrafts((current) => ({
				...current,
				[profileId]: {
					...current[profileId],
					[field]: value,
				},
			}));
		},
		[],
	);

	const setDraftExtraValue = useCallback(
		(profileId: string, extraKey: string, value: string) => {
			setProviderDrafts((current) => ({
				...current,
				[profileId]: {
					...current[profileId],
					extras: {
						...(current[profileId]?.extras || {}),
						[extraKey]: value,
					},
				},
			}));
		},
		[],
	);

	const selectProviderOption = useCallback(
		(profileId: string, option: ProviderConfigOption) => {
			const key = optionKey(profileId, option);
			setSelectedOptionByProvider((current) => ({
				...current,
				[profileId]: key,
			}));
			setProviderErrors((current) => ({ ...current, [profileId]: null }));
			setProviderMessages((current) => ({ ...current, [profileId]: null }));
			setCollapsedProfiles((current) => ({ ...current, [profileId]: false }));
			setProviderDrafts((current) => {
				if (current[profileId]) return current;
				const extras = Object.fromEntries(
					(option.extra_fields || []).map((field) => [
						field.key,
						field.default_value || "",
					]),
				);
				return {
					...current,
					[profileId]: { extras },
				};
			});
		},
		[],
	);

	const withProviderBusy = useCallback(
		async (profileId: string, fn: () => Promise<void>) => {
			setProviderBusy((current) => ({ ...current, [profileId]: true }));
			setProviderErrors((current) => ({ ...current, [profileId]: null }));
			try {
				await fn();
			} catch (err) {
				setProviderErrors((current) => ({
					...current,
					[profileId]: String(err),
				}));
			} finally {
				setProviderBusy((current) => ({ ...current, [profileId]: false }));
			}
		},
		[],
	);

	const handleSaveApiKey = useCallback(
		async (profileId: string, option: ProviderConfigOption) => {
			const draft = providerDrafts[profileId];
			const apiKey = draft?.apiKey?.trim() || "";
			await withProviderBusy(profileId, async () => {
				if (!apiKey) {
					throw new Error("Please paste an API key first.");
				}
				await invoke("save_provider_api_key", {
					providerId: option.provider_id,
					apiKey,
					region: draft?.extras?.region || null,
					apiBase: draft?.extras?.api_base || null,
				});
				setProviderMessages((current) => ({
					...current,
					[profileId]: `${option.label} saved. Model catalog refreshed.`,
				}));
				setProviderDrafts((current) => ({
					...current,
					[profileId]: {
						...current[profileId],
						apiKey: "",
					},
				}));
				await loadModels();
			});
		},
		[loadModels, providerDrafts, withProviderBusy],
	);

	const handleStartAuth = useCallback(
		async (profileId: string, option: ProviderConfigOption) => {
			await withProviderBusy(profileId, async () => {
				const prompt = await invoke<ProviderAuthPrompt>(
					"start_provider_auth_flow",
					{
						providerId: option.provider_id,
					},
				);
				setAuthPrompts((current) => ({ ...current, [profileId]: prompt }));
				setProviderMessages((current) => ({
					...current,
					[profileId]:
						"Sign-in flow started. Open the auth URL below, then complete the flow here.",
				}));
			});
		},
		[withProviderBusy],
	);

	const handleCompleteAuth = useCallback(
		async (profileId: string) => {
			const prompt = authPrompts[profileId];
			const input = providerDrafts[profileId]?.authInput?.trim() || "";
			await withProviderBusy(profileId, async () => {
				if (!prompt) {
					throw new Error("Start the auth flow first.");
				}
				const result = await invoke<{
					email?: string | null;
					account_label?: string | null;
				}>("complete_provider_auth_flow", {
					providerId: prompt.provider,
					inputKind: prompt.input_kind,
					input: prompt.input_kind === "complete" ? null : input,
				});
				const suffix =
					result?.email || result?.account_label
						? ` (${result.email || result.account_label})`
						: "";
				setProviderMessages((current) => ({
					...current,
					[profileId]: `Authentication completed${suffix}.`,
				}));
				setAuthPrompts((current) => ({ ...current, [profileId]: null }));
				setProviderDrafts((current) => ({
					...current,
					[profileId]: {
						...current[profileId],
						authInput: "",
					},
				}));
				await loadModels();
			});
		},
		[authPrompts, loadModels, providerDrafts, withProviderBusy],
	);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0 bg-black/30" onClick={onClose} />
			<div className="relative w-[480px] max-h-[600px] bg-card rounded-2xl shadow-xl border border-border flex flex-col overflow-hidden">
				{/* Header */}
				<div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
					<div className="flex items-center justify-between mb-3">
						<h2 className="text-[16px] font-bold text-foreground">
							Switch Model
						</h2>
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={() => void loadModels(true)}
								className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
								title="Refresh models"
							>
								<RefreshCw className="w-3.5 h-3.5" />
							</button>
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
					</div>
					<div className="relative">
						<svg
							viewBox="0 0 20 20"
							fill="currentColor"
							className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2"
						>
							<path
								fillRule="evenodd"
								d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
								clipRule="evenodd"
							/>
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

					{/* Fallback: prop-based model list when backend unavailable */}
					{fallbackFiltered.length > 0 && (
						<div className="mb-2">
							<div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
								Models
							</div>
							{fallbackFiltered.map((m) => {
								const isCurrent = m === currentModel;
								return (
									<button
										key={m}
										type="button"
										onClick={() => {
											onSelectModel(m, undefined);
											if (closeOnSelect) onClose();
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
											<svg
												viewBox="0 0 20 20"
												fill="currentColor"
												className="w-4 h-4 text-primary shrink-0"
											>
												<path
													fillRule="evenodd"
													d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
													clipRule="evenodd"
												/>
											</svg>
										)}
									</button>
								);
							})}
						</div>
					)}

					{/* Provider-profile grouped model list */}
					{filteredGroups.map((group) => {
						const collapsed = collapsedProfiles[group.profileId] ?? false;
						const status = group.provider?.status || "unknown";
						const statusText =
							group.provider && group.hasConfigSurface
								? statusLabel(status)
								: null;
						const selectedOptionKey = selectedOptionByProvider[group.profileId];
						const selectedOption =
							group.provider?.options.find(
								(option) =>
									optionKey(group.profileId, option) === selectedOptionKey,
							) || group.provider?.options[0];
						const draft = providerDrafts[group.profileId] || {};
						const authPrompt = authPrompts[group.profileId];
						const busy = providerBusy[group.profileId] || false;
						const authNeedsInput =
							authPrompt && authPrompt.input_kind !== "complete";

						return (
							<div key={group.profileId} className="mb-2">
								<button
									type="button"
									className="w-full flex items-center gap-2 px-3 py-2 text-left rounded-xl hover:bg-muted/50 transition-colors"
									onClick={() =>
										setCollapsedProfiles((current) => ({
											...current,
											[group.profileId]: !collapsed,
										}))
									}
								>
									{collapsed ? (
										<ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
									) : (
										<ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
									)}
									<span className="text-[13px] font-medium">{group.label}</span>
									<span className="text-[11px] text-muted-foreground/60">
										({group.models.length})
									</span>
									{group.isCurrentProfile && (
										<span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
											current
										</span>
									)}
									{statusText && (
										<span
											className={cn(
												"text-[9px] px-1.5 py-0.5 rounded ml-auto",
												statusBadgeVariant(status) === "secondary" &&
													"bg-secondary text-secondary-foreground",
												statusBadgeVariant(status) === "outline" &&
													"border text-muted-foreground",
												statusBadgeVariant(status) === "destructive" &&
													"bg-destructive text-destructive-foreground",
											)}
										>
											{statusText}
										</span>
									)}
								</button>

								{!collapsed && (
									<>
										{group.provider &&
											group.hasConfigSurface &&
											(!group.configured ||
												(group.models.length > 0 &&
													group.models.every(
														(route) => route.available === false,
													))) && (
												<div className="px-3 py-3 border-b space-y-3 bg-muted/20 ml-3 border-l-2 border-muted pl-3">
													<div className="flex items-start gap-2 text-xs text-muted-foreground">
														<Link2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
														<div>
															<div className="font-medium text-foreground">
																{group.configured
																	? `${group.label} authentication expired`
																	: `${group.label} not configured`}
															</div>
															<div>{group.provider.method_detail}</div>
															<div className="mt-1">
																{group.configured
																	? "Credentials are no longer valid. Re-authenticate below."
																	: "Models stay hidden until credentials are available."}
															</div>
														</div>
													</div>

													{group.provider.options.length > 0 && (
														<div className="flex gap-2 flex-wrap">
															{group.provider.options.map((option) => {
																const key = optionKey(group.profileId, option);
																const active =
																	selectedOption &&
																	optionKey(group.profileId, selectedOption) ===
																		key;
																return (
																	<Button
																		key={key}
																		type="button"
																		size="sm"
																		variant={active ? "secondary" : "outline"}
																		className="h-7 text-[10px]"
																		onClick={() =>
																			selectProviderOption(
																				group.profileId,
																				option,
																			)
																		}
																	>
																		{option.kind === "api_key" ? (
																			<KeyRound className="w-3 h-3 mr-1" />
																		) : (
																			<Link2 className="w-3 h-3 mr-1" />
																		)}
																		{option.label}
																	</Button>
																);
															})}
														</div>
													)}

													{selectedOption && (
														<div className="space-y-2 rounded border bg-background px-3 py-3">
															<div className="text-xs font-medium">
																{selectedOption.label}
															</div>
															{selectedOption.detail && (
																<div className="text-xs text-muted-foreground">
																	{selectedOption.detail}
																</div>
															)}

															{selectedOption.kind === "api_key" ? (
																<>
																	<Input
																		type="password"
																		placeholder={
																			selectedOption.input_placeholder ||
																			"Paste API key"
																		}
																		value={draft.apiKey || ""}
																		onChange={(event) =>
																			setDraftValue(
																				group.profileId,
																				"apiKey",
																				event.target.value,
																			)
																		}
																	/>
																	{(selectedOption.extra_fields || []).map(
																		(field) => (
																			<Input
																				key={`${group.profileId}-${field.key}`}
																				placeholder={
																					field.placeholder || field.label
																				}
																				value={draft.extras?.[field.key] || ""}
																				onChange={(event) =>
																					setDraftExtraValue(
																						group.profileId,
																						field.key,
																						event.target.value,
																					)
																				}
																			/>
																		),
																	)}
																	<div className="flex gap-2 flex-wrap">
																		<Button
																			size="sm"
																			className="h-7 text-[10px]"
																			disabled={busy}
																			onClick={() =>
																				void handleSaveApiKey(
																					group.profileId,
																					selectedOption,
																				)
																			}
																		>
																			{busy ? (
																				<Loader2 className="w-3 h-3 mr-1 animate-spin" />
																			) : null}
																			Save credentials
																		</Button>
																		{selectedOption.setup_url && (
																			<Button
																				size="sm"
																				variant="outline"
																				className="h-7 text-[10px]"
																				onClick={() =>
																					window.open(
																						selectedOption.setup_url,
																						"_blank",
																						"noopener,noreferrer",
																					)
																				}
																			>
																				<ExternalLink className="w-3 h-3 mr-1" />
																				Open setup page
																			</Button>
																		)}
																	</div>
																</>
															) : (
																<>
																	{!authPrompt ? (
																		<div className="flex gap-2 flex-wrap">
																			<Button
																				size="sm"
																				className="h-7 text-[10px]"
																				disabled={busy}
																				onClick={() =>
																					void handleStartAuth(
																						group.profileId,
																						selectedOption,
																					)
																				}
																			>
																				{busy ? (
																					<Loader2 className="w-3 h-3 mr-1 animate-spin" />
																				) : null}
																				Start sign-in
																			</Button>
																		</div>
																	) : (
																		<div className="space-y-2 text-xs">
																			<div className="rounded border bg-muted/30 px-2 py-2 space-y-1">
																				<div className="font-medium">
																					Auth URL
																				</div>
																				<div className="break-all text-muted-foreground">
																					{authPrompt.auth_url}
																				</div>
																				{authPrompt.user_code && (
																					<div>
																						device code:{" "}
																						<span className="font-medium text-foreground">
																							{authPrompt.user_code}
																						</span>
																					</div>
																				)}
																			</div>
																			<div className="flex gap-2 flex-wrap">
																				<Button
																					size="sm"
																					variant="outline"
																					className="h-7 text-[10px]"
																					onClick={() =>
																						window.open(
																							authPrompt.auth_url,
																							"_blank",
																							"noopener,noreferrer",
																						)
																					}
																				>
																					<ExternalLink className="w-3 h-3 mr-1" />
																					Open auth page
																				</Button>
																			</div>
																			{authNeedsInput && (
																				<Input
																					placeholder={
																						authPrompt.input_kind ===
																						"auth_code"
																							? "Paste auth code"
																							: "Paste callback URL or query string"
																					}
																					value={draft.authInput || ""}
																					onChange={(event) =>
																						setDraftValue(
																							group.profileId,
																							"authInput",
																							event.target.value,
																						)
																					}
																				/>
																			)}
																			<div className="flex gap-2 flex-wrap">
																				<Button
																					size="sm"
																					className="h-7 text-[10px]"
																					disabled={busy}
																					onClick={() =>
																						void handleCompleteAuth(
																							group.profileId,
																						)
																					}
																				>
																					{busy ? (
																						<Loader2 className="w-3 h-3 mr-1 animate-spin" />
																					) : null}
																					{authPrompt.input_kind === "complete"
																						? "I completed sign-in"
																						: "Complete sign-in"}
																				</Button>
																			</div>
																		</div>
																	)}
																</>
															)}
														</div>
													)}

													{providerErrors[group.profileId] && (
														<div className="text-xs text-destructive">
															{providerErrors[group.profileId]}
														</div>
													)}
													{providerMessages[group.profileId] &&
														!providerErrors[group.profileId] && (
															<div className="text-xs text-muted-foreground">
																{providerMessages[group.profileId]}
															</div>
														)}
												</div>
											)}

									{!collapsed &&
										group.models.some((route) => route.available !== false) && (
										<div className="ml-3 border-l-2 border-muted pl-3 space-y-0.5">
											{group.models
												.filter((route) => route.available !== false)
												.map((route) => {
													const isCurrent =
														route.model === currentModel &&
														group.profileId === currentProfileId;
													return (
														<button
															key={`${group.profileId}:${route.model}`}
															type="button"
														onClick={() => {
															onSelectModel(route.model, group.profileId);
															if (closeOnSelect) onClose();
														}}
															className={cn(
																"w-full text-left px-3 py-2 rounded-xl text-[13px] flex items-center gap-3 transition-colors",
																isCurrent
																	? "bg-primary/10 text-primary"
																	: "text-foreground hover:bg-muted",
															)}
														>
															<span className="font-mono flex-1 truncate">
																{route.model}
															</span>
															{isCurrent && (
																<svg
																	viewBox="0 0 20 20"
																	fill="currentColor"
																	className="w-4 h-4 text-primary shrink-0"
																>
																	<path
																		fillRule="evenodd"
																		d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
																		clipRule="evenodd"
																	/>
																</svg>
															)}
														</button>
													);
												})}
										</div>
									)}
									</>
								)}
							</div>
						);
					})}

					{!loading &&
						fallbackFiltered.length === 0 &&
						filteredGroups.length === 0 && (
							<div className="text-center py-8 text-[12px] text-muted-foreground">
								No models match "{search}"
							</div>
						)}
				</div>

				{/* Footer hint */}
				<div className="px-5 py-3 border-t border-border text-[11px] text-muted-foreground shrink-0">
					Use{" "}
					<kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-foreground">
						/model &lt;name&gt;
					</kbd>{" "}
					in the chat to switch directly
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
	onRenameSession?: (sessionId: string, newName: string) => void;
	currentSessionId?: string | null;
	sessionTitle?: string | null;
	isSwarmRole?: boolean;
	totalTokens?: [number, number] | null;
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
	onRenameSession,
	currentSessionId,
	sessionTitle,
	isSwarmRole,
	totalTokens,
}: AgentSettingsPopoverProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [renameDraft, setRenameDraft] = useState(sessionTitle || "");

	useEffect(() => {
		setRenameDraft(sessionTitle || "");
	}, [sessionTitle, open]);

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
			className="absolute top-full right-0 mt-1 w-[300px] bg-card rounded-2xl shadow-xl border border-border overflow-hidden z-50"
		>
			{/* Rename session / role */}
			{onRenameSession && currentSessionId && (
				<div className="px-4 py-3 border-b border-border">
					<div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
						{isSwarmRole ? "Role Name" : "Session Title"}
					</div>
					<div className="flex gap-2">
						<input
							type="text"
							value={renameDraft}
							onChange={(e) => setRenameDraft(e.target.value)}
							placeholder={isSwarmRole ? "Role name" : "Session title"}
							className="flex-1 h-8 px-3 rounded-xl bg-muted/50 border border-border text-[12px] text-foreground placeholder-muted-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
						/>
						<button
							type="button"
							disabled={
								!renameDraft.trim() ||
								renameDraft.trim() === (sessionTitle || "")
							}
							onClick={() => {
								const trimmed = renameDraft.trim();
								if (trimmed && trimmed !== (sessionTitle || "")) {
									onRenameSession(currentSessionId, trimmed);
								}
							}}
							className="h-8 px-3 rounded-xl text-[12px] font-medium bg-primary text-white hover:bg-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
						>
							Save
						</button>
					</div>
				</div>
			)}
			{/* Model row */}
			<div className="px-4 py-3 border-b border-border">
				<div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
					Model
				</div>
				<button
					type="button"
					onClick={() => {
						onClose();
						onOpenModelPicker();
					}}
					className="w-full text-left px-3 py-2 rounded-xl bg-muted/50 border border-border hover:border-primary/50 hover:bg-primary/10 transition-all flex items-center gap-2 group"
				>
					<span className="flex-1 font-mono text-[12px] text-foreground truncate">
						{currentModel || "default"}
					</span>
					<svg
						viewBox="0 0 16 16"
						fill="currentColor"
						className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary shrink-0"
					>
						<path
							fillRule="evenodd"
							d="M6.22 4.22a.75.75 0 011.06 0l3.25 3.25a.75.75 0 010 1.06l-3.25 3.25a.75.75 0 01-1.06-1.06L9 8 6.22 5.28a.75.75 0 010-1.06z"
							clipRule="evenodd"
						/>
					</svg>
				</button>
			</div>

			{/* Reasoning effort */}
			<div className="px-4 py-3 border-b border-border">
				<div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
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
									? "bg-primary/10 border-primary/50 text-primary"
									: "bg-card border-border text-muted-foreground hover:border-muted-foreground/30",
							)}
						>
							<span className="text-base">{icon}</span>
							<span>{label}</span>
						</button>
					))}
				</div>
			</div>

			{/* Memory toggle */}
			<div className="px-4 py-3 border-b border-border">
				<div className="flex items-center justify-between">
					<div>
						<div className="text-[13px] font-semibold text-foreground">
							Memory
						</div>
						<div className="text-[11px] text-muted-foreground">
							Project-scoped long-term memory
						</div>
					</div>
					<button
						type="button"
						onClick={onToggleMemory}
						className={cn(
							"w-10 h-6 rounded-full transition-all relative",
							memoryEnabled ? "bg-primary" : "bg-muted-foreground/30",
						)}
					>
						<span
							className={cn(
								"absolute top-0.5 w-5 h-5 bg-card rounded-full shadow-sm transition-all",
								memoryEnabled ? "right-0.5" : "left-0.5",
							)}
						/>
					</button>
				</div>
			</div>

			{totalTokens && (
				<div className="px-4 py-3 border-b border-border">
					<div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
						Usage
					</div>
					<div className="flex items-center gap-3 text-[12px] text-foreground">
						<span className="flex items-center gap-1">
							<span className="w-1.5 h-1.5 rounded-full bg-primary/60" />↑{" "}
							{totalTokens[0].toLocaleString()}
						</span>
						<span className="flex items-center gap-1">
							<span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />↓{" "}
							{totalTokens[1].toLocaleString()}
						</span>
					</div>
				</div>
			)}
			{/* Actions */}
			<div className="px-4 py-3 flex flex-col gap-1.5">
				<div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
					Session Actions
				</div>
				<button
					type="button"
					onClick={() => {
						onClose();
						onCompact();
					}}
					className="w-full text-left px-3 py-2 rounded-xl text-[13px] text-foreground hover:bg-muted/50 transition-colors flex items-center gap-2"
				>
					<svg
						viewBox="0 0 20 20"
						fill="currentColor"
						className="w-4 h-4 text-muted-foreground"
					>
						<path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
					</svg>
					Compact context
					<span className="ml-auto text-[11px] font-mono text-muted-foreground">
						/compact
					</span>
				</button>
				<button
					type="button"
					onClick={() => {
						onClose();
						onClearChat();
					}}
					disabled={isProcessing}
					className="w-full text-left px-3 py-2 rounded-xl text-[13px] text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
				>
					<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
						<path
							fillRule="evenodd"
							d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
							clipRule="evenodd"
						/>
					</svg>
					Clear chat
					<span className="ml-auto text-[11px] font-mono text-muted-foreground">
						/clear
					</span>
				</button>
			</div>
		</div>
	);
}
