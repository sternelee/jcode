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
  onSelectModel: (model: string) => void;
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

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    gemini: "Google Gemini",
    copilot: "GitHub Copilot",
    openrouter: "OpenRouter",
    bedrock: "AWS Bedrock",
    antigravity: "Antigravity",
    cursor: "Cursor",
    claude: "Claude",
    jcode: "Jcode",
  };
  return labels[provider] || provider;
}

function currentLabel(currentProvider?: string | null, currentModel?: string | null): string {
  if (currentProvider && currentModel) {
    return `${providerLabel(currentProvider)} · ${currentModel}`;
  }
  return currentModel || "Select model";
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
  if (contextWindow >= 1_000_000) return `${Math.round(contextWindow / 1_000_000)}M ctx`;
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
  if (aCurrentProvider !== bCurrentProvider) return aCurrentProvider - bCurrentProvider;

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

function statusBadgeVariant(status: ProviderCatalogEntry["status"]): "secondary" | "outline" | "destructive" {
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
  const [collapsedProviders, setCollapsedProviders] = useState<Record<string, boolean>>({});
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraftState>>({});
  const [selectedOptionByProvider, setSelectedOptionByProvider] = useState<Record<string, string>>({});
  const [providerBusy, setProviderBusy] = useState<Record<string, boolean>>({});
  const [providerMessages, setProviderMessages] = useState<Record<string, string | null>>({});
  const [providerErrors, setProviderErrors] = useState<Record<string, string | null>>({});
  const [authPrompts, setAuthPrompts] = useState<Record<string, ProviderAuthPrompt | null>>({});

  const loadModels = useCallback(async () => {
    if (disabled) return;
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
  }, [disabled]);

  useEffect(() => {
    if (open) {
      void loadModels();
    }
  }, [open, loadModels]);

  const visibleRoutes = useMemo(
    () => ensureCurrentRoute(routes, currentModel, currentProvider),
    [routes, currentModel, currentProvider],
  );

  const providerMap = useMemo(
    () => new Map(providers.map((provider) => [provider.provider_key, provider])),
    [providers],
  );

  const ownerKeyForProvider = useCallback(
    (providerKey: string) => providerMap.get(providerKey)?.auth_provider_id || providerKey,
    [providerMap],
  );

  const groupedProviderMap = useMemo(() => {
    const map = new Map<string, ProviderCatalogEntry>();
    for (const provider of providers) {
      const groupKey = provider.auth_provider_id || provider.provider_key;
      const existing = map.get(groupKey);
      if (!existing) {
        map.set(groupKey, provider);
        continue;
      }
      if ((provider.has_config_surface && !existing.has_config_surface)
        || (provider.is_current_provider && !existing.is_current_provider)
        || (provider.route_count > existing.route_count)) {
        map.set(groupKey, provider);
      }
    }
    return map;
  }, [providers]);

  const filteredRoutes = useMemo(
    () =>
      visibleRoutes.filter((route) => {
        const ownerProvider = providerMap.get(ownerKeyForProvider(route.provider));
        if (ownerProvider && !ownerProvider.configured && route.model !== currentModel) return false;
        if (onlyAvailable && route.available === false) return false;
        if (longContextOnly && !(route.context_window && route.context_window >= 100000)) return false;
        if (cheapOnly && !route.cheapness?.relative_label?.toLowerCase().includes("cheap")) return false;
        return true;
      }),
    [visibleRoutes, providerMap, ownerKeyForProvider, currentModel, onlyAvailable, longContextOnly, cheapOnly],
  );

  const currentRoute = useMemo(
    () => visibleRoutes.find((route) => route.model === currentModel) || null,
    [visibleRoutes, currentModel],
  );

  const alternativeRoutes = useMemo(() => {
    if (!currentModel) return [] as ModelRoute[];
    return visibleRoutes
      .filter((route) => route.model === currentModel && route.provider !== currentProvider)
      .sort((a, b) => compareRoutes(a, b, currentModel, currentProvider));
  }, [visibleRoutes, currentModel, currentProvider]);

  const groupedProviders = useMemo(() => {
    const routeGroups = new Map<string, ModelRoute[]>();
    for (const route of filteredRoutes) {
      const ownerKey = ownerKeyForProvider(route.provider);
      const bucket = routeGroups.get(ownerKey) || [];
      bucket.push(route);
      routeGroups.set(ownerKey, bucket);
    }

    const currentOwnerKey = currentProvider ? ownerKeyForProvider(currentProvider) : null;
    const providerKeys = new Set<string>();
    groupedProviderMap.forEach((provider, groupKey) => {
      if (provider.has_config_surface || provider.is_current_provider || routeGroups.has(groupKey)) {
        providerKeys.add(groupKey);
      }
    });
    routeGroups.forEach((_, ownerKey) => providerKeys.add(ownerKey));
    if (currentOwnerKey) providerKeys.add(currentOwnerKey);

    const rawGroups = Array.from(providerKeys)
      .map((providerKey) => {
        const provider = groupedProviderMap.get(providerKey) || null;
        const groupRoutes = [...(routeGroups.get(providerKey) || [])].sort((a, b) =>
          compareRoutes(a, b, currentModel, currentProvider),
        );
        const canonicalLabel = providerLabel(providerKey);
        const resolvedLabel =
          provider && provider.provider_key === providerKey
            ? provider.display_name || canonicalLabel
            : canonicalLabel;
        return {
          providerKey,
          label: resolvedLabel,
          provider,
          routes: groupRoutes,
          isCurrentProvider:
            provider?.is_current_provider || (currentOwnerKey ? providerKey === currentOwnerKey : false),
          configured: provider?.configured ?? true,
          hasConfigSurface: provider?.has_config_surface ?? false,
        };
      })
      .filter((group) => group.provider || group.routes.length > 0);

    const mergedByLabel = new Map<string, (typeof rawGroups)[number]>();
    for (const group of rawGroups) {
      const labelKey = group.label.trim().toLowerCase();
      const existing = mergedByLabel.get(labelKey);
      if (!existing) {
        mergedByLabel.set(labelKey, group);
        continue;
      }

      const preferred =
        (group.hasConfigSurface && !existing.hasConfigSurface)
        || (group.isCurrentProvider && !existing.isCurrentProvider)
        || (group.routes.length > existing.routes.length);

      const primary = preferred ? group : existing;
      const secondary = preferred ? existing : group;
      const mergedRoutes = dedupeRoutes([...primary.routes, ...secondary.routes]).sort((a, b) =>
        compareRoutes(a, b, currentModel, currentProvider),
      );

      mergedByLabel.set(labelKey, {
        ...primary,
        routes: mergedRoutes,
        isCurrentProvider: primary.isCurrentProvider || secondary.isCurrentProvider,
        configured: primary.configured || secondary.configured,
        hasConfigSurface: primary.hasConfigSurface || secondary.hasConfigSurface,
      });
    }

    return Array.from(mergedByLabel.values()).sort((a, b) => {
      if (a.isCurrentProvider !== b.isCurrentProvider) return a.isCurrentProvider ? -1 : 1;
      if (a.configured !== b.configured) return a.configured ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [filteredRoutes, groupedProviderMap, ownerKeyForProvider, currentModel, currentProvider]);

  useEffect(() => {
    setCollapsedProviders((current) => {
      let changed = false;
      const next = { ...current };
      for (const group of groupedProviders) {
        if (!(group.providerKey in next)) {
          next[group.providerKey] = group.provider ? !group.provider.configured : false;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [groupedProviders]);

  const setDraftValue = useCallback(
    (providerKey: string, field: keyof ProviderDraftState, value: string) => {
      setProviderDrafts((current) => ({
        ...current,
        [providerKey]: {
          ...current[providerKey],
          [field]: value,
        },
      }));
    },
    [],
  );

  const setDraftExtraValue = useCallback((providerKey: string, extraKey: string, value: string) => {
    setProviderDrafts((current) => ({
      ...current,
      [providerKey]: {
        ...current[providerKey],
        extras: {
          ...(current[providerKey]?.extras || {}),
          [extraKey]: value,
        },
      },
    }));
  }, []);

  const selectProviderOption = useCallback((providerKey: string, option: ProviderConfigOption) => {
    const key = optionKey(providerKey, option);
    setSelectedOptionByProvider((current) => ({ ...current, [providerKey]: key }));
    setProviderErrors((current) => ({ ...current, [providerKey]: null }));
    setProviderMessages((current) => ({ ...current, [providerKey]: null }));
    setCollapsedProviders((current) => ({ ...current, [providerKey]: false }));
    setProviderDrafts((current) => {
      if (current[providerKey]) return current;
      const extras = Object.fromEntries(
        (option.extra_fields || []).map((field) => [field.key, field.default_value || ""]),
      );
      return {
        ...current,
        [providerKey]: { extras },
      };
    });
  }, []);

  const withProviderBusy = useCallback(async (providerKey: string, fn: () => Promise<void>) => {
    setProviderBusy((current) => ({ ...current, [providerKey]: true }));
    setProviderErrors((current) => ({ ...current, [providerKey]: null }));
    try {
      await fn();
    } catch (err) {
      setProviderErrors((current) => ({ ...current, [providerKey]: String(err) }));
    } finally {
      setProviderBusy((current) => ({ ...current, [providerKey]: false }));
    }
  }, []);

  const handleSaveApiKey = useCallback(
    async (providerKey: string, option: ProviderConfigOption) => {
      const draft = providerDrafts[providerKey];
      const apiKey = draft?.apiKey?.trim() || "";
      await withProviderBusy(providerKey, async () => {
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
          [providerKey]: `${option.label} saved. Model catalog refreshed.`,
        }));
        setProviderDrafts((current) => ({
          ...current,
          [providerKey]: {
            ...current[providerKey],
            apiKey: "",
          },
        }));
        await loadModels();
      });
    },
    [loadModels, providerDrafts, withProviderBusy],
  );

  const handleStartAuth = useCallback(
    async (providerKey: string, option: ProviderConfigOption) => {
      await withProviderBusy(providerKey, async () => {
        const prompt = await invoke<ProviderAuthPrompt>("start_provider_auth_flow", {
          providerId: option.provider_id,
        });
        setAuthPrompts((current) => ({ ...current, [providerKey]: prompt }));
        setProviderMessages((current) => ({
          ...current,
          [providerKey]: "Sign-in flow started. Open the auth URL below, then complete the flow here.",
        }));
      });
    },
    [withProviderBusy],
  );

  const handleCompleteAuth = useCallback(
    async (providerKey: string) => {
      const prompt = authPrompts[providerKey];
      const input = providerDrafts[providerKey]?.authInput?.trim() || "";
      await withProviderBusy(providerKey, async () => {
        if (!prompt) {
          throw new Error("Start the auth flow first.");
        }
        const result = await invoke<{ email?: string | null; account_label?: string | null }>(
          "complete_provider_auth_flow",
          {
            providerId: prompt.provider,
            inputKind: prompt.input_kind,
            input: prompt.input_kind === "complete" ? null : input,
          },
        );
        const suffix = result?.email || result?.account_label ? ` (${result.email || result.account_label})` : "";
        setProviderMessages((current) => ({
          ...current,
          [providerKey]: `Authentication completed${suffix}.`,
        }));
        setAuthPrompts((current) => ({ ...current, [providerKey]: null }));
        setProviderDrafts((current) => ({
          ...current,
          [providerKey]: {
            ...current[providerKey],
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
        <span className="truncate">{currentLabel(currentProvider, currentModel)}</span>
        <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Model Picker"
        description="Search and switch models for the current session."
        className="sm:max-w-3xl max-h-[85vh]"
        showCloseButton={false}
      >
        <Command shouldFilter className="h-full max-h-[85vh]">
          <div className="flex items-center gap-2 px-2 pt-2 flex-wrap">
            <div className="min-w-0 flex-1 text-xs text-muted-foreground">
              current: {currentLabel(currentProvider, currentModel)}
            </div>
            {visibleRoutes.some((route) => route.context_window && route.context_window >= 100000) && (
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
              onClick={() => void loadModels()}
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
                {providerLabel(currentRoute.provider)}
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
                          {providerLabel(route.provider)}
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
          <CommandInput placeholder={loading ? "Loading models..." : "Search models, providers, methods..."} />
          <CommandList className="min-h-0 flex-1 max-h-none">
            {error && <div className="px-3 py-2 text-xs text-destructive">model picker error: {error}</div>}
            {!loading && !error && groupedProviders.length === 0 && <CommandEmpty>No matching models.</CommandEmpty>}
            {groupedProviders.map(({ providerKey, label, provider, routes: groupRoutes, isCurrentProvider, configured, hasConfigSurface }) => {
              const collapsed = collapsedProviders[providerKey] ?? false;
              const status = provider?.status || "unknown";
              const statusText = provider && hasConfigSurface ? statusLabel(status) : null;
              const selectedOptionKey = selectedOptionByProvider[providerKey];
              const selectedOption = provider?.options.find(
                (option) => optionKey(providerKey, option) === selectedOptionKey,
              ) || provider?.options[0];
              const draft = providerDrafts[providerKey] || {};
              const authPrompt = authPrompts[providerKey];
              const busy = providerBusy[providerKey] || false;
              const authNeedsInput =
                authPrompt && authPrompt.input_kind !== "complete";

              return (
                <CommandGroup key={providerKey}>
                  <div className="px-2 py-1.5 sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 text-left"
                      onClick={() =>
                        setCollapsedProviders((current) => ({
                          ...current,
                          [providerKey]: !collapsed,
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
                      {isCurrentProvider && (
                        <Badge variant="secondary" className="h-5 text-[10px]">
                          current provider
                        </Badge>
                      )}
                      {statusText && (
                        <Badge variant={statusBadgeVariant(status)} className="h-5 text-[10px] ml-auto">
                          {statusText}
                        </Badge>
                      )}
                    </button>
                  </div>

                  {!collapsed && provider && hasConfigSurface && !configured && (
                    <div className="px-3 py-3 border-b space-y-3 bg-muted/20">
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Link2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <div>
                          <div className="font-medium text-foreground">{label} not configured</div>
                          <div>{provider.method_detail}</div>
                          <div className="mt-1">Models stay hidden until credentials are available.</div>
                        </div>
                      </div>

                      {provider.options.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          {provider.options.map((option) => {
                            const key = optionKey(providerKey, option);
                            const active = selectedOption && optionKey(providerKey, selectedOption) === key;
                            return (
                              <Button
                                key={key}
                                type="button"
                                size="sm"
                                variant={active ? "secondary" : "outline"}
                                className="h-7 text-[10px]"
                                onClick={() => selectProviderOption(providerKey, option)}
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
                          <div className="text-xs font-medium">{selectedOption.label}</div>
                          {selectedOption.detail && (
                            <div className="text-xs text-muted-foreground">{selectedOption.detail}</div>
                          )}

                          {selectedOption.kind === "api_key" ? (
                            <>
                              <Input
                                type="password"
                                placeholder={selectedOption.input_placeholder || "Paste API key"}
                                value={draft.apiKey || ""}
                                onChange={(event) => setDraftValue(providerKey, "apiKey", event.target.value)}
                              />
                              {(selectedOption.extra_fields || []).map((field) => (
                                <Input
                                  key={`${providerKey}-${field.key}`}
                                  placeholder={field.placeholder || field.label}
                                  value={draft.extras?.[field.key] || ""}
                                  onChange={(event) =>
                                    setDraftExtraValue(providerKey, field.key, event.target.value)
                                  }
                                />
                              ))}
                              <div className="flex gap-2 flex-wrap">
                                <Button
                                  size="sm"
                                  className="h-7 text-[10px]"
                                  disabled={busy}
                                  onClick={() => void handleSaveApiKey(providerKey, selectedOption)}
                                >
                                  {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                                  Save credentials
                                </Button>
                                {selectedOption.setup_url && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[10px]"
                                    onClick={() => window.open(selectedOption.setup_url, "_blank", "noopener,noreferrer")}
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
                                    onClick={() => void handleStartAuth(providerKey, selectedOption)}
                                  >
                                    {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                                    Start sign-in
                                  </Button>
                                </div>
                              ) : (
                                <div className="space-y-2 text-xs">
                                  <div className="rounded border bg-muted/30 px-2 py-2 space-y-1">
                                    <div className="font-medium">Auth URL</div>
                                    <div className="break-all text-muted-foreground">{authPrompt.auth_url}</div>
                                    {authPrompt.user_code && (
                                      <div>
                                        device code: <span className="font-medium text-foreground">{authPrompt.user_code}</span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex gap-2 flex-wrap">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-[10px]"
                                      onClick={() => window.open(authPrompt.auth_url, "_blank", "noopener,noreferrer")}
                                    >
                                      <ExternalLink className="w-3 h-3 mr-1" />
                                      Open auth page
                                    </Button>
                                  </div>
                                  {authNeedsInput && (
                                    <Input
                                      placeholder={
                                        authPrompt.input_kind === "auth_code"
                                          ? "Paste auth code"
                                          : "Paste callback URL or query string"
                                      }
                                      value={draft.authInput || ""}
                                      onChange={(event) =>
                                        setDraftValue(providerKey, "authInput", event.target.value)
                                      }
                                    />
                                  )}
                                  <div className="flex gap-2 flex-wrap">
                                    <Button
                                      size="sm"
                                      className="h-7 text-[10px]"
                                      disabled={busy}
                                      onClick={() => void handleCompleteAuth(providerKey)}
                                    >
                                      {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
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

                      {providerErrors[providerKey] && (
                        <div className="text-xs text-destructive">{providerErrors[providerKey]}</div>
                      )}
                      {providerMessages[providerKey] && !providerErrors[providerKey] && (
                        <div className="text-xs text-muted-foreground">{providerMessages[providerKey]}</div>
                      )}
                    </div>
                  )}

                  {!collapsed && groupRoutes.map((route) => {
                    const value = routeSearchValue(route);
                    const isCurrent = route.model === currentModel;
                    const cheapnessLabel = route.cheapness?.relative_label;
                    const context = contextLabel(route.context_window);
                    const title =
                      route.display_name && route.display_name !== route.model
                        ? `${route.display_name} · ${route.model}`
                        : route.model;
                    return (
                      <CommandItem
                        key={`${route.provider}:${route.model}:${route.api_method || ""}:${route.detail || ""}`}
                        value={value}
                        onSelect={() => {
                          onSelectModel(route.model);
                          setOpen(false);
                        }}
                        className="items-start py-2.5"
                        disabled={route.available === false}
                      >
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-center gap-2 min-w-0 flex-wrap">
                            <span className="truncate font-medium">{title}</span>
                            {isCurrent && (
                              <Badge variant="secondary" className="h-5 text-[10px]">
                                current
                              </Badge>
                            )}
                            {route.available === false && (
                              <Badge variant="outline" className="h-5 text-[10px]">
                                unavailable
                              </Badge>
                            )}
                            {context && (
                              <Badge variant="outline" className="h-5 text-[10px]">
                                {context}
                              </Badge>
                            )}
                            {cheapnessLabel && (
                              <Badge variant="outline" className="h-5 text-[10px]">
                                {cheapnessLabel}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground break-words">
                            provider {providerLabel(route.provider)}
                            {route.api_method ? ` · ${route.api_method}` : ""}
                            {route.detail ? ` · ${route.detail}` : ""}
                          </div>
                        </div>
                        <CommandShortcut>{isCurrent ? "active" : "switch"}</CommandShortcut>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
