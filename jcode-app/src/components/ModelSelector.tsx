import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
	ModelRoute,
	ProviderAuthPrompt,
	ProviderCatalogEntry,
	ProviderConfigOption,
} from "@/types";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
	Loader2,
	ChevronsUpDown,
	ChevronDown,
	ChevronRight,
	RefreshCw,
	ExternalLink,
	KeyRound,
	Link2,
} from "lucide-react";

interface ModelSelectorProps {
	currentModel: string | null;
	currentProvider?: string | null;
	onSelectModel: (model: string, profileId?: string) => void;
	disabled: boolean;
}

interface ModelCatalogResponse {
	routes: ModelRoute[];
	current: string;
	providers?: ProviderCatalogEntry[];
}

interface ProviderDraftState {
	apiKey?: string;
	authInput?: string;
	extras?: Record<string, string>;
}

function profileLabel(profileId: string): string {
	const labels: Record<string, string> = {
		openrouter: "OpenRouter",
		claude: "Claude",
		openai: "OpenAI",
		copilot: "GitHub Copilot",
		gemini: "Google Gemini",
		bedrock: "AWS Bedrock",
		antigravity: "Antigravity",
		cursor: "Cursor",
		jcode: "Jcode",
		opencode: "OpenCode Zen",
		"opencode-go": "OpenCode Go",
		zai: "Z.AI",
		kimi: "Kimi Code",
		"302ai": "302.AI",
		baseten: "Baseten",
		cortecs: "Cortecs",
		deepseek: "DeepSeek",
		comtegra: "Comtegra GPU Cloud",
		fpt: "FPT AI Marketplace",
		firmware: "Firmware",
		huggingface: "Hugging Face",
		moonshotai: "Moonshot AI",
		nebius: "Nebius Token Factory",
		scaleway: "Scaleway",
		stackit: "STACKIT",
		groq: "Groq",
		mistral: "Mistral",
		perplexity: "Perplexity",
		togetherai: "Together AI",
		deepinfra: "Deep Infra",
		fireworks: "Fireworks",
		minimax: "MiniMax",
		xai: "xAI",
		lmstudio: "LM Studio",
		ollama: "Ollama",
		chutes: "Chutes",
		cerebras: "Cerebras",
		"alibaba-coding-plan": "Alibaba Cloud Coding Plan",
		"openai-compatible": "OpenAI-compatible",
	};
	return labels[profileId] || profileId;
}

function currentLabel(
	currentProvider?: string | null,
	currentModel?: string | null,
): string {
	if (currentProvider && currentModel) {
		return `${profileLabel(currentProvider)} · ${currentModel}`;
	}
	return currentModel || "Select model";
}

/** Infer profile id from model name prefix when api_method lacks a suffix */
function profileIdFromModel(model: string): string | null {
	const m = model.toLowerCase();
	if (m.startsWith("deepseek")) return "deepseek";
	if (m.startsWith("claude") || m.startsWith("anthropic")) return "claude";
	if (m.startsWith("gemini") || m.startsWith("gemma")) return "gemini";
	if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3"))
		return "openai";
	if (m.startsWith("llama") || m.startsWith("codellama")) return "ollama";
	if (m.startsWith("qwen") || m.startsWith("qwq")) return "alibaba-coding-plan";
	return null;
}

/** Extract the profile ID used for grouping models */
function profileIdFromRoute(route: ModelRoute): string {
	if (route.api_method?.startsWith("openai-compatible:")) {
		return route.api_method.slice("openai-compatible:".length);
	}
	if (route.api_method === "openrouter") {
		return "openrouter";
	}
	// When api_method is bare "openai-compatible" without a suffix, infer
	// the actual provider from the model name rather than falling back to
	// the transport-level provider (which is always "OpenAI").
	if (route.api_method === "openai-compatible") {
		const inferred = profileIdFromModel(route.model);
		if (inferred) return inferred;
	}
	return route.provider.toLowerCase();
}

/** Extract profile ID from a ProviderCatalogEntry */
function profileIdFromProvider(provider: ProviderCatalogEntry): string {
	return provider.auth_provider_id || provider.provider_key;
}

function dedupeRoutes(routes: ModelRoute[]): ModelRoute[] {
	const seen = new Set<string>();
	return routes.filter((route) => {
		const key = `${route.provider}:${route.model}:${route.api_method || ""}:${route.detail || ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function ensureCurrentRoute(
	routes: ModelRoute[],
	currentModel: string | null,
	currentProvider?: string | null,
): ModelRoute[] {
	if (!currentModel) return routes;
	if (routes.some((route) => route.model === currentModel)) return routes;
	return [
		{
			provider: currentProvider || "current",
			model: currentModel,
			available: true,
			api_method: "current model",
			detail: "active session model",
			display_name: currentModel,
		},
		...routes,
	];
}

function routeSearchValue(route: ModelRoute): string {
	return [
		route.model,
		route.display_name,
		route.provider,
		route.api_method,
		route.detail,
		route.cheapness?.relative_label,
		route.context_window ? `${route.context_window}` : "",
	]
		.filter(Boolean)
		.join(" ");
}

function contextLabel(contextWindow?: number): string | null {
	if (!contextWindow) return null;
	if (contextWindow >= 1_000_000)
		return `${Math.round(contextWindow / 1_000_000)}M ctx`;
	if (contextWindow >= 1_000) return `${Math.round(contextWindow / 1000)}k ctx`;
	return `${contextWindow} ctx`;
}

function cheapnessRank(route: ModelRoute): number {
	const label = route.cheapness?.relative_label?.toLowerCase() || "";
	if (label.includes("cheap")) return 0;
	if (label.includes("medium") || label.includes("balanced")) return 1;
	if (label.includes("expensive") || label.includes("premium")) return 2;
	return 3;
}

function compareRoutes(
	a: ModelRoute,
	b: ModelRoute,
	currentModel: string | null,
	currentProvider?: string | null,
): number {
	const aCurrentModel = a.model === currentModel ? 0 : 1;
	const bCurrentModel = b.model === currentModel ? 0 : 1;
	if (aCurrentModel !== bCurrentModel) return aCurrentModel - bCurrentModel;

	const aCurrentProvider = a.provider === currentProvider ? 0 : 1;
	const bCurrentProvider = b.provider === currentProvider ? 0 : 1;
	if (aCurrentProvider !== bCurrentProvider)
		return aCurrentProvider - bCurrentProvider;

	const aAvailable = a.available === false ? 1 : 0;
	const bAvailable = b.available === false ? 1 : 0;
	if (aAvailable !== bAvailable) return aAvailable - bAvailable;

	const aContext = a.context_window || 0;
	const bContext = b.context_window || 0;
	if (aContext !== bContext) return bContext - aContext;

	const aCheapness = cheapnessRank(a);
	const bCheapness = cheapnessRank(b);
	if (aCheapness !== bCheapness) return aCheapness - bCheapness;

	return a.model.localeCompare(b.model);
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

function optionKey(providerKey: string, option: ProviderConfigOption): string {
	return `${providerKey}:${option.provider_id}:${option.kind}`;
}

export function ModelSelector({
	currentModel,
	currentProvider,
	onSelectModel,
	disabled,
}: ModelSelectorProps) {
	const [open, setOpen] = useState(false);
	const [routes, setRoutes] = useState<ModelRoute[]>([]);
	const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [onlyAvailable, setOnlyAvailable] = useState(true);
	const [longContextOnly, setLongContextOnly] = useState(false);
	const [cheapOnly, setCheapOnly] = useState(false);
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
	const [search, setSearch] = useState("");

	const loadModels = useCallback(
		async (force = false) => {
			if (disabled) return;
			if (!force && routes.length > 0) return;
			setLoading(true);
			setError(null);
			try {
				const data = await invoke<ModelCatalogResponse>("get_models");
				setRoutes(dedupeRoutes(data.routes || []));
				setProviders(data.providers || []);
			} catch (err) {
				setError(String(err));
			} finally {
				setLoading(false);
			}
		},
		[disabled, routes.length],
	);

	useEffect(() => {
		if (open) {
			void loadModels();
		}
	}, [open, loadModels]);

	const visibleRoutes = useMemo(
		() => ensureCurrentRoute(routes, currentModel, currentProvider),
		[routes, currentModel, currentProvider],
	);

	// Map profile_id -> ProviderCatalogEntry
	const profileMap = useMemo(() => {
		const map = new Map<string, ProviderCatalogEntry>();
		for (const provider of providers) {
			const pid = profileIdFromProvider(provider);
			const existing = map.get(pid);
			if (!existing) {
				map.set(pid, provider);
				continue;
			}
			if (
				(provider.has_config_surface && !existing.has_config_surface) ||
				(provider.is_current_provider && !existing.is_current_provider) ||
				provider.route_count > existing.route_count
			) {
				map.set(pid, provider);
			}
		}
		return map;
	}, [providers]);

	// Derive current profile id from currentProvider
	const currentProfileId = useMemo(() => {
		if (!currentProvider) return null;
		return currentProvider.toLowerCase();
	}, [currentProvider]);

	const filteredRoutes = useMemo(
		() =>
			visibleRoutes.filter((route) => {
				const pid = profileIdFromRoute(route);
				const profile = profileMap.get(pid);
				if (profile && !profile.configured && route.model !== currentModel)
					return false;
				if (onlyAvailable && route.available === false) return false;
				if (
					longContextOnly &&
					!(route.context_window && route.context_window >= 100000)
				)
					return false;
				if (
					cheapOnly &&
					!route.cheapness?.relative_label?.toLowerCase().includes("cheap")
				)
					return false;
				if (search) {
					const q = search.toLowerCase();
					const hay = routeSearchValue(route).toLowerCase();
					if (!hay.includes(q)) return false;
				}
				return true;
			}),
		[
			visibleRoutes,
			profileMap,
			currentModel,
			onlyAvailable,
			longContextOnly,
			cheapOnly,
			search,
		],
	);

	const currentRoute = useMemo(
		() => visibleRoutes.find((route) => route.model === currentModel) || null,
		[visibleRoutes, currentModel],
	);

	const alternativeRoutes = useMemo(() => {
		if (!currentModel) return [] as ModelRoute[];
		return visibleRoutes
			.filter(
				(route) =>
					route.model === currentModel && route.provider !== currentProvider,
			)
			.sort((a, b) => compareRoutes(a, b, currentModel, currentProvider));
	}, [visibleRoutes, currentModel, currentProvider]);

	// Group routes by profile_id
	const groupedProfiles = useMemo(() => {
		const routeGroups = new Map<string, ModelRoute[]>();
		for (const route of filteredRoutes) {
			const pid = profileIdFromRoute(route);
			const bucket = routeGroups.get(pid) || [];
			bucket.push(route);
			routeGroups.set(pid, bucket);
		}

		const profileKeys = new Set<string>();
		profileMap.forEach((provider, pid) => {
			if (
				provider.has_config_surface ||
				provider.is_current_provider ||
				routeGroups.has(pid)
			) {
				profileKeys.add(pid);
			}
		});
		routeGroups.forEach((_, pid) => profileKeys.add(pid));
		if (currentProfileId) profileKeys.add(currentProfileId);

		const groups = Array.from(profileKeys)
			.map((pid) => {
				const provider = profileMap.get(pid) || null;
				const groupRoutes = [...(routeGroups.get(pid) || [])].sort((a, b) =>
					compareRoutes(a, b, currentModel, currentProvider),
				);
				return {
					profileId: pid,
					label: profileLabel(pid),
					provider,
					routes: groupRoutes,
					isCurrentProfile: pid === currentProfileId,
					configured: provider?.configured ?? true,
					hasConfigSurface: provider?.has_config_surface ?? false,
				};
			})
			.filter((group) => group.provider || group.routes.length > 0)
			.sort((a, b) => {
				if (a.isCurrentProfile !== b.isCurrentProfile)
					return a.isCurrentProfile ? -1 : 1;
				if (a.configured !== b.configured) return a.configured ? -1 : 1;
				return a.label.localeCompare(b.label);
			});

		return groups;
	}, [
		filteredRoutes,
		profileMap,
		currentModel,
		currentProvider,
		currentProfileId,
	]);

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

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				className="h-8 min-w-[260px] justify-between gap-2 text-xs"
				onClick={() => setOpen(true)}
				disabled={disabled}
				title={currentLabel(currentProvider, currentModel)}
			>
				<span className="truncate">
					{currentLabel(currentProvider, currentModel)}
				</span>
				<ChevronsUpDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
			</Button>

			<CommandDialog
				open={open}
				onOpenChange={(v) => {
					if (!v) setSearch("");
					setOpen(v);
				}}
				title="Model Picker"
				description="Search and switch models for the current session."
				className="sm:max-w-3xl max-h-[85vh]"
				showCloseButton={false}
			>
				<Command shouldFilter={false} className="h-full max-h-[85vh]">
					<div className="flex items-center gap-2 px-2 pt-2 flex-wrap">
						<div className="min-w-0 flex-1 text-xs text-muted-foreground">
							current: {currentLabel(currentProvider, currentModel)}
						</div>
						{visibleRoutes.some(
							(route) => route.context_window && route.context_window >= 100000,
						) && (
							<Badge variant="outline" className="text-[10px]">
								long-context
							</Badge>
						)}
						{visibleRoutes.some((route) => route.cheapness?.relative_label) && (
							<Badge variant="outline" className="text-[10px]">
								cost-aware
							</Badge>
						)}
						<Button
							variant={onlyAvailable ? "secondary" : "ghost"}
							size="sm"
							className="h-6 px-2 text-[10px]"
							onClick={() => setOnlyAvailable((value) => !value)}
						>
							available
						</Button>
						<Button
							variant={longContextOnly ? "secondary" : "ghost"}
							size="sm"
							className="h-6 px-2 text-[10px]"
							onClick={() => setLongContextOnly((value) => !value)}
						>
							long ctx
						</Button>
						<Button
							variant={cheapOnly ? "secondary" : "ghost"}
							size="sm"
							className="h-6 px-2 text-[10px]"
							onClick={() => setCheapOnly((value) => !value)}
						>
							cheap
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 shrink-0"
							onClick={() => void loadModels(true)}
							disabled={loading}
							title="Reload model catalog"
						>
							{loading ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<RefreshCw className="w-3.5 h-3.5" />
							)}
						</Button>
					</div>
					{currentRoute && (
						<div className="px-3 pt-1 pb-2 space-y-2 text-xs border-b">
							<div className="flex items-center gap-2 flex-wrap">
								<span className="font-medium">current route</span>
								{contextLabel(currentRoute.context_window) && (
									<Badge variant="outline" className="text-[10px]">
										{contextLabel(currentRoute.context_window)}
									</Badge>
								)}
								{currentRoute.cheapness?.relative_label && (
									<Badge variant="outline" className="text-[10px]">
										{currentRoute.cheapness.relative_label}
									</Badge>
								)}
								{alternativeRoutes.length > 0 && (
									<Badge variant="secondary" className="text-[10px]">
										{alternativeRoutes.length} alternatives
									</Badge>
								)}
							</div>
							<div className="text-muted-foreground break-words">
								{profileLabel(profileIdFromRoute(currentRoute))}
								{currentRoute.api_method ? ` · ${currentRoute.api_method}` : ""}
								{currentRoute.detail ? ` · ${currentRoute.detail}` : ""}
							</div>
							{alternativeRoutes.length > 0 && (
								<div className="space-y-1">
									<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
										alternatives
									</div>
									<div className="space-y-1">
										{alternativeRoutes.slice(0, 3).map((route) => (
											<div
												key={`${route.provider}-${route.model}-${route.api_method || ""}`}
												className="rounded border bg-muted/20 px-2 py-1.5 flex items-center gap-2 flex-wrap"
											>
												<Badge variant="outline" className="text-[10px]">
													{profileLabel(profileIdFromRoute(route))}
												</Badge>
												{route.api_method && (
													<Badge variant="outline" className="text-[10px]">
														{route.api_method}
													</Badge>
												)}
												{contextLabel(route.context_window) && (
													<Badge variant="outline" className="text-[10px]">
														{contextLabel(route.context_window)}
													</Badge>
												)}
												{route.cheapness?.relative_label && (
													<Badge variant="outline" className="text-[10px]">
														{route.cheapness.relative_label}
													</Badge>
												)}
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					)}
					<CommandInput
						placeholder={
							loading
								? "Loading models..."
								: "Search models, providers, methods..."
						}
						value={search}
						onValueChange={(v) => setSearch(v)}
					/>
					<CommandList className="min-h-0 flex-1 max-h-none">
						{error && (
							<div className="px-3 py-2 text-xs text-destructive">
								model picker error: {error}
							</div>
						)}
						{!loading && !error && groupedProfiles.length === 0 && (
							<CommandEmpty>No matching models.</CommandEmpty>
						)}
						{groupedProfiles.map(
							({
								profileId,
								label,
								provider,
								routes: groupRoutes,
								isCurrentProfile,
								configured,
								hasConfigSurface,
							}) => {
								const collapsed = collapsedProfiles[profileId] ?? false;
								const status = provider?.status || "unknown";
								const statusText =
									provider && hasConfigSurface ? statusLabel(status) : null;
								const selectedOptionKey = selectedOptionByProvider[profileId];
								const selectedOption =
									provider?.options.find(
										(option) =>
											optionKey(profileId, option) === selectedOptionKey,
									) || provider?.options[0];
								const draft = providerDrafts[profileId] || {};
								const authPrompt = authPrompts[profileId];
								const busy = providerBusy[profileId] || false;
								const authNeedsInput =
									authPrompt && authPrompt.input_kind !== "complete";

								return (
									<CommandGroup key={profileId}>
										<div className="px-2 py-1.5 sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
											<button
												type="button"
												className="w-full flex items-center gap-2 text-left"
												onClick={() =>
													setCollapsedProfiles((current) => ({
														...current,
														[profileId]: !collapsed,
													}))
												}
											>
												{collapsed ? (
													<ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
												) : (
													<ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
												)}
												<span className="text-xs font-medium">{label}</span>
												<Badge variant="outline" className="h-5 text-[10px]">
													{provider?.route_count ?? groupRoutes.length}
												</Badge>
												{isCurrentProfile && (
													<Badge
														variant="secondary"
														className="h-5 text-[10px]"
													>
														current provider
													</Badge>
												)}
												{statusText && (
													<Badge
														variant={statusBadgeVariant(status)}
														className="h-5 text-[10px] ml-auto"
													>
														{statusText}
													</Badge>
												)}
											</button>
										</div>

										{!collapsed &&
											provider &&
											hasConfigSurface &&
											(!configured ||
												(groupRoutes.length > 0 &&
													groupRoutes.every(
														(route) => route.available === false,
													))) && (
												<div className="px-3 py-3 border-b space-y-3 bg-muted/20">
													<div className="flex items-start gap-2 text-xs text-muted-foreground">
														<Link2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
														<div>
															<div className="font-medium text-foreground">
																{configured
																	? `${label} authentication expired`
																	: `${label} not configured`}
															</div>
															<div>{provider.method_detail}</div>
															<div className="mt-1">
																{configured
																	? "Credentials are no longer valid. Re-authenticate below."
																	: "Models stay hidden until credentials are available."}
															</div>
														</div>
													</div>

													{provider.options.length > 0 && (
														<div className="flex gap-2 flex-wrap">
															{provider.options.map((option) => {
																const key = optionKey(profileId, option);
																const active =
																	selectedOption &&
																	optionKey(profileId, selectedOption) === key;
																return (
																	<Button
																		key={key}
																		type="button"
																		size="sm"
																		variant={active ? "secondary" : "outline"}
																		className="h-7 text-[10px]"
																		onClick={() =>
																			selectProviderOption(profileId, option)
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
																				profileId,
																				"apiKey",
																				event.target.value,
																			)
																		}
																	/>
																	{(selectedOption.extra_fields || []).map(
																		(field) => (
																			<Input
																				key={`${profileId}-${field.key}`}
																				placeholder={
																					field.placeholder || field.label
																				}
																				value={draft.extras?.[field.key] || ""}
																				onChange={(event) =>
																					setDraftExtraValue(
																						profileId,
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
																					profileId,
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
																						profileId,
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
																							profileId,
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
																						void handleCompleteAuth(profileId)
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

													{providerErrors[profileId] && (
														<div className="text-xs text-destructive">
															{providerErrors[profileId]}
														</div>
													)}
													{providerMessages[profileId] &&
														!providerErrors[profileId] && (
															<div className="text-xs text-muted-foreground">
																{providerMessages[profileId]}
															</div>
														)}
												</div>
											)}

										{!collapsed &&
											groupRoutes.map((route) => {
												const value = routeSearchValue(route);
												const isCurrent = route.model === currentModel;
												const cheapnessLabel = route.cheapness?.relative_label;
												const context = contextLabel(route.context_window);
												const title =
													route.display_name &&
													route.display_name !== route.model
														? `${route.display_name} · ${route.model}`
														: route.model;
												return (
													<CommandItem
														key={`${route.provider}:${route.model}:${route.api_method || ""}:${route.detail || ""}`}
														value={value}
														onSelect={() => {
															onSelectModel(
																route.model,
																profileIdFromRoute(route),
															);
															setOpen(false);
														}}
														className="items-start py-2.5"
														disabled={route.available === false}
													>
														<div className="min-w-0 flex-1 space-y-1.5">
															<div className="flex items-center gap-2 min-w-0 flex-wrap">
																<span className="truncate font-medium">
																	{title}
																</span>
																{isCurrent && (
																	<Badge
																		variant="secondary"
																		className="h-5 text-[10px]"
																	>
																		current
																	</Badge>
																)}
																{route.available === false && (
																	<Badge
																		variant="outline"
																		className="h-5 text-[10px]"
																	>
																		unavailable
																	</Badge>
																)}
																{context && (
																	<Badge
																		variant="outline"
																		className="h-5 text-[10px]"
																	>
																		{context}
																	</Badge>
																)}
																{cheapnessLabel && (
																	<Badge
																		variant="outline"
																		className="h-5 text-[10px]"
																	>
																		{cheapnessLabel}
																	</Badge>
																)}
															</div>
															<div className="text-xs text-muted-foreground break-words">
																{route.api_method ? `${route.api_method}` : ""}
																{route.detail ? ` · ${route.detail}` : ""}
															</div>
														</div>
														<CommandShortcut>
															{isCurrent ? "active" : "switch"}
														</CommandShortcut>
													</CommandItem>
												);
											})}
									</CommandGroup>
								);
							},
						)}
					</CommandList>
				</Command>
			</CommandDialog>
		</>
	);
}
