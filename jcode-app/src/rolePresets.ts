import type { RolePreset } from "@/types";

export const DEFAULT_ROLE_PRESETS: RolePreset[] = [
	{
		name: "Atlas",
		model: "claude-sonnet-4-20250514",
		profileId: "anthropic",
		provider: "anthropic",
		detail: "Deep research & analysis",
		tag: "RESEARCHER",
		tagColor: "#8B5CF6",
	},
	{
		name: "Bram",
		model: "claude-sonnet-4-20250514",
		profileId: "anthropic",
		provider: "anthropic",
		detail: "Code implementation & review",
		tag: "ENGINEER",
		tagColor: "#10B981",
	},
	{
		name: "Nova",
		model: "gpt-4o",
		profileId: "openai",
		provider: "openai",
		detail: "Planning & decision making",
		tag: "STRATEGIST",
		tagColor: "#3B82F6",
	},
	{
		name: "Iris",
		model: "claude-sonnet-4-20250514",
		profileId: "anthropic",
		provider: "anthropic",
		detail: "UI/UX & visual design",
		tag: "DESIGNER",
		tagColor: "#EC4899",
	},
	{
		name: "Saga",
		model: "gpt-4o-mini",
		profileId: "openai",
		provider: "openai",
		detail: "Quality assurance & feedback",
		tag: "CRITIC",
		tagColor: "#F59E0B",
	},
];

const ROLE_PRESET_OVERRIDES_KEY = "jcode_role_preset_overrides";

function loadOverrides(): Record<string, { model: string; profileId?: string; provider?: string }> {
	try {
		const raw = localStorage.getItem(ROLE_PRESET_OVERRIDES_KEY);
		if (raw) {
			return JSON.parse(raw) as Record<string, { model: string; profileId?: string; provider?: string }>;
		}
	} catch (e) {
		console.warn("Failed to parse role preset overrides:", e);
	}
	return {};
}

export function getRolePresetOverrides(): Record<string, { model: string; profileId?: string; provider?: string }> {
	return loadOverrides();
}

export function setRolePresetOverride(
	roleName: string,
	model: string,
	profileId?: string,
	provider?: string,
): void {
	const overrides = loadOverrides();
	overrides[roleName] = { model, profileId, provider };
	localStorage.setItem(ROLE_PRESET_OVERRIDES_KEY, JSON.stringify(overrides));
}

export function clearRolePresetOverride(roleName: string): void {
	const overrides = loadOverrides();
	delete overrides[roleName];
	localStorage.setItem(ROLE_PRESET_OVERRIDES_KEY, JSON.stringify(overrides));
}

export function getRolePresetWithOverrides(roleName: string): RolePreset | undefined {
	const preset = DEFAULT_ROLE_PRESETS.find((r) => r.name === roleName);
	if (!preset) return undefined;
	const overrides = loadOverrides();
	const override = overrides[roleName];
	if (override) {
		return {
			...preset,
			model: override.model,
			profileId: override.profileId ?? preset.profileId,
			provider: override.provider ?? preset.provider,
		};
	}
	return preset;
}

export function getAllRolePresets(): RolePreset[] {
	return DEFAULT_ROLE_PRESETS.map((preset) => {
		const override = loadOverrides()[preset.name];
		if (override) {
			return {
				...preset,
				model: override.model,
				profileId: override.profileId ?? preset.profileId,
				provider: override.provider ?? preset.provider,
			};
		}
		return preset;
	});
}

// ── Custom role presets (user-created) ─────────────────────────────────────

const CUSTOM_ROLE_PRESETS_KEY = "jcode_custom_role_presets";

function loadCustomPresets(): RolePreset[] {
	try {
		const raw = localStorage.getItem(CUSTOM_ROLE_PRESETS_KEY);
		if (raw) {
			return JSON.parse(raw) as RolePreset[];
		}
	} catch (e) {
		console.warn("Failed to parse custom role presets:", e);
	}
	return [];
}

export function getCustomRolePresets(): RolePreset[] {
	return loadCustomPresets();
}

export function addCustomRolePreset(preset: RolePreset): void {
	const customs = loadCustomPresets();
	// Prevent duplicate names
	if (customs.some((c) => c.name === preset.name)) {
		throw new Error(`Role preset "${preset.name}" already exists`);
	}
	customs.push(preset);
	localStorage.setItem(CUSTOM_ROLE_PRESETS_KEY, JSON.stringify(customs));
}

export function removeCustomRolePreset(name: string): void {
	const customs = loadCustomPresets().filter((c) => c.name !== name);
	localStorage.setItem(CUSTOM_ROLE_PRESETS_KEY, JSON.stringify(customs));
}

export function updateCustomRolePreset(
	name: string,
	updates: Partial<Omit<RolePreset, "name">>,
): void {
	const customs = loadCustomPresets();
	const idx = customs.findIndex((c) => c.name === name);
	if (idx === -1) return;
	customs[idx] = { ...customs[idx], ...updates };
	localStorage.setItem(CUSTOM_ROLE_PRESETS_KEY, JSON.stringify(customs));
}

// ── Combined getters ───────────────────────────────────────────────────────

export function getAllPresets(): RolePreset[] {
	return [...getAllRolePresets(), ...getCustomRolePresets()];
}

/** @deprecated Use `getAllPresets()` instead for fresh data after overrides. */
export const ROLE_PRESETS: RolePreset[] = DEFAULT_ROLE_PRESETS.map((preset) => {
	const override = loadOverrides()[preset.name];
	if (override) {
		return {
			...preset,
			model: override.model,
			profileId: override.profileId ?? preset.profileId,
			provider: override.provider ?? preset.provider,
		};
	}
	return preset;
});

export function getMemberRole(
	name: string,
): { name: string; tag: string; tagColor: string } {
	const preset = getAllPresets().find((r) => r.name === name);
	if (preset) {
		return { name, tag: preset.tag ?? "AGENT", tagColor: preset.tagColor ?? "#6B7280" };
	}
	return { name, tag: "AGENT", tagColor: "#6B7280" };
}

export function memberProvider(preset: { provider?: string; profileId?: string } | undefined): string | undefined {
	if (!preset) return undefined;
	return preset.provider ?? preset.profileId;
}
