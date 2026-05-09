import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { Loader2 } from "lucide-react";

interface ModelRoute {
  provider: string;
  model: string;
  available: boolean;
}

interface ModelGroup {
  value: string;
  items: ModelRoute[];
}

interface ModelSelectorProps {
  currentModel: string | null;
  onSelectModel: (model: string) => void;
  disabled: boolean;
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
  };
  return labels[provider] || provider;
}

export function ModelSelector({
  currentModel,
  onSelectModel,
  disabled,
}: ModelSelectorProps) {
  const [routes, setRoutes] = useState<ModelRoute[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (disabled) return;
    setLoading(true);
    invoke<{ routes: ModelRoute[]; current: string }>("get_models")
      .then((data) => setRoutes(data.routes))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [disabled]);

  // Deduplicate routes by provider + model, keep first occurrence
  const uniqueRoutes = useMemo(() => {
    const seen = new Set<string>();
    return routes.filter((r) => {
      const key = `${r.provider}:${r.model}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [routes]);

  const groups = useMemo(() => {
    const grouped = new Map<string, ModelRoute[]>();
    for (const r of uniqueRoutes) {
      const key = r.provider || "default";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    }
    return Array.from(grouped.entries()).map(
      ([provider, items]): ModelGroup => ({
        value: provider,
        items,
      })
    );
  }, [uniqueRoutes]);

  if (routes.length === 0 && currentModel) {
    return (
      <span className="text-sm text-muted-foreground font-mono truncate max-w-[200px]">
        {currentModel}
      </span>
    );
  }
  if (routes.length === 0) return null;

  return (
    <Combobox
      value={currentModel || ""}
      onValueChange={(v) => v && onSelectModel(v)}
      disabled={disabled}
    >
      <ComboboxInput
        showTrigger
        showClear={false}
        placeholder={loading ? "Loading models..." : "Search models..."}
        className="w-[260px]"
        disabled={disabled || loading}
      >
        {loading && (
          <Loader2 className="absolute right-8 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
        )}
      </ComboboxInput>
      <ComboboxContent>
        <ComboboxList>
          {groups.map((group) => (
            <ComboboxGroup key={group.value}>
              <ComboboxLabel>{providerLabel(group.value)}</ComboboxLabel>
              {group.items.map((r) => (
                <ComboboxItem key={`${r.provider}:${r.model}`} value={r.model}>
                  {r.model}
                </ComboboxItem>
              ))}
            </ComboboxGroup>
          ))}
          <ComboboxEmpty>No models found</ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
