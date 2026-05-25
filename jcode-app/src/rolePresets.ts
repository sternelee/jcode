import type { RolePreset } from "@/types";

export const ROLE_PRESETS: RolePreset[] = [
	{ name: "Atlas", model: "claude-sonnet-4-20250514", detail: "Deep research & analysis", tag: "RESEARCHER", tagColor: "#8B5CF6" },
	{ name: "Bram", model: "claude-sonnet-4-20250514", detail: "Code implementation & review", tag: "ENGINEER", tagColor: "#10B981" },
	{ name: "Nova", model: "gpt-4o", detail: "Planning & decision making", tag: "STRATEGIST", tagColor: "#3B82F6" },
	{ name: "Iris", model: "claude-sonnet-4-20250514", detail: "UI/UX & visual design", tag: "DESIGNER", tagColor: "#EC4899" },
	{ name: "Saga", model: "gpt-4o-mini", detail: "Quality assurance & feedback", tag: "CRITIC", tagColor: "#F59E0B" },
];

export function getMemberRole(
	name: string,
): { name: string; tag: string; tagColor: string } {
	const preset = ROLE_PRESETS.find((r) => r.name === name);
	if (preset) {
		return { name: preset.name, tag: preset.tag ?? "AGENT", tagColor: preset.tagColor ?? "#6B7280" };
	}
	return { name, tag: "AGENT", tagColor: "#6B7280" };
}
