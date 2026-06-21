import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { RolePreset } from "@/types";
import { AgentAvatar } from "./AgentAvatar";
import { ModelPickerModal } from "./SlashCommands";
import {
	DEFAULT_ROLE_PRESETS,
	setRolePresetOverride,
	clearRolePresetOverride,
	getRolePresetWithOverrides,
	getCustomRolePresets,
	addCustomRolePreset,
	removeCustomRolePreset,
	updateCustomRolePreset,
} from "@/rolePresets";
import { Settings2 } from "lucide-react";

interface RolePresetsPanelProps {
	availableModels?: string[];
}

export function RolePresetsPanel({
	availableModels = [],
}: RolePresetsPanelProps) {
	const [presets, setPresets] = useState<RolePreset[]>(() => [
		...DEFAULT_ROLE_PRESETS.map((p) => getRolePresetWithOverrides(p.name) ?? p),
		...getCustomRolePresets(),
	]);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [editingPreset, setEditingPreset] = useState<string | null>(null);

	const refreshPresets = useCallback(() => {
		setPresets([
			...DEFAULT_ROLE_PRESETS.map((p) => getRolePresetWithOverrides(p.name) ?? p),
			...getCustomRolePresets(),
		]);
	}, []);

	const [showNewRoleForm, setShowNewRoleForm] = useState(false);
	const [newRoleName, setNewRoleName] = useState("");
	const [newRoleTag, setNewRoleTag] = useState("AGENT");
	const [newRoleTagColor, setNewRoleTagColor] = useState("#6B7280");
	const [newRoleDetail, setNewRoleDetail] = useState("");
	const [newRoleModel, setNewRoleModel] = useState("claude-sonnet-4-20250514");
	const [newRoleProfileId, setNewRoleProfileId] = useState<string | undefined>("anthropic");
	const [newRoleError, setNewRoleError] = useState<string | null>(null);

	const handleOpenModelPicker = useCallback((presetName: string) => {
		setEditingPreset(presetName);
		setModelPickerOpen(true);
	}, []);

	const handleResetPreset = useCallback(
		(presetName: string) => {
			clearRolePresetOverride(presetName);
			refreshPresets();
		},
		[refreshPresets],
	);

	const currentEditingPreset = useMemo(() => {
		if (editingPreset === "__new_role__") {
			return {
				name: newRoleName,
				model: newRoleModel,
				profileId: newRoleProfileId,
				provider: newRoleProfileId,
				detail: newRoleDetail,
				tag: newRoleTag,
				tagColor: newRoleTagColor,
			} as RolePreset;
		}
		return presets.find((p) => p.name === editingPreset);
	}, [
		presets,
		editingPreset,
		newRoleName,
		newRoleModel,
		newRoleProfileId,
		newRoleDetail,
		newRoleTag,
		newRoleTagColor,
	]);

	const handleSelectModel = useCallback(
		(model: string, profileId?: string) => {
			if (!editingPreset) return;
			if (editingPreset === "__new_role__") {
				setNewRoleModel(model);
				setNewRoleProfileId(profileId);
				setEditingPreset(null);
				setModelPickerOpen(false);
				return;
			}
			const isDefault = DEFAULT_ROLE_PRESETS.some((p) => p.name === editingPreset);
			if (isDefault) {
				setRolePresetOverride(editingPreset, model, profileId, profileId);
			} else {
				updateCustomRolePreset(editingPreset, { model, profileId, provider: profileId });
			}
			refreshPresets();
			setModelPickerOpen(false);
			setEditingPreset(null);
		},
		[editingPreset, refreshPresets],
	);

	const handleAddNewRole = useCallback(() => {
		const name = newRoleName.trim();
		if (!name) {
			setNewRoleError("Role name is required");
			return;
		}
		if (presets.some((p) => p.name === name)) {
			setNewRoleError(`Role "${name}" already exists`);
			return;
		}
		try {
			addCustomRolePreset({
				name,
				model: newRoleModel,
				profileId: newRoleProfileId,
				provider: newRoleProfileId,
				detail: newRoleDetail.trim() || "Custom agent",
				tag: newRoleTag.trim() || "AGENT",
				tagColor: newRoleTagColor,
			});
			setNewRoleName("");
			setNewRoleTag("AGENT");
			setNewRoleTagColor("#6B7280");
			setNewRoleDetail("");
			setNewRoleModel("claude-sonnet-4-20250514");
			setNewRoleProfileId("anthropic");
			setNewRoleError(null);
			setShowNewRoleForm(false);
			refreshPresets();
		} catch (e) {
			setNewRoleError(String(e));
		}
	}, [
		newRoleName,
		newRoleModel,
		newRoleProfileId,
		newRoleDetail,
		newRoleTag,
		newRoleTagColor,
		presets,
		refreshPresets,
	]);

	const handleDeleteCustomRole = useCallback(
		(name: string) => {
			removeCustomRolePreset(name);
			refreshPresets();
		},
		[refreshPresets],
	);

	return (
		<>
			<div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
				<div className="text-[13px] font-semibold text-foreground flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Settings2 className="w-4 h-4 text-primary" />
						Preset Roles
					</div>
					<button
						type="button"
						onClick={() => setShowNewRoleForm((v) => !v)}
						className="text-[11px] text-primary hover:text-primary/80 px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary/15 transition-colors"
					>
						{showNewRoleForm ? "Cancel" : "+ New Role"}
					</button>
				</div>

				{showNewRoleForm && (
					<div className="space-y-2 p-3 rounded-lg bg-muted/30 border border-border">
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
							<input
								type="text"
								value={newRoleName}
								onChange={(e) => {
									setNewRoleName(e.target.value);
									setNewRoleError(null);
								}}
								placeholder="Role name..."
								className="h-8 px-2.5 rounded-lg border border-border text-[12px] outline-none focus:border-primary/50 bg-card"
							/>
							<input
								type="text"
								value={newRoleTag}
								onChange={(e) => setNewRoleTag(e.target.value)}
								placeholder="Tag..."
								className="h-8 px-2.5 rounded-lg border border-border text-[12px] outline-none focus:border-primary/50 bg-card"
							/>
						</div>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
							<input
								type="text"
								value={newRoleDetail}
								onChange={(e) => setNewRoleDetail(e.target.value)}
								placeholder="Description..."
								className="h-8 px-2.5 rounded-lg border border-border text-[12px] outline-none focus:border-primary/50 bg-card"
							/>
							<div className="flex items-center gap-2">
								<input
									type="color"
									value={newRoleTagColor}
									onChange={(e) => setNewRoleTagColor(e.target.value)}
									className="w-8 h-8 rounded-lg border border-border bg-card cursor-pointer"
									title="Tag color"
									aria-label="Tag color"
								/>
								<button
									type="button"
									onClick={() => {
										setEditingPreset("__new_role__");
										setModelPickerOpen(true);
									}}
									className="flex-1 h-8 px-2.5 rounded-lg border border-border text-[11px] text-left truncate hover:border-primary/50 bg-card transition-colors"
									title={`${newRoleProfileId ?? "auto"}: ${newRoleModel}`}
								>
									{newRoleModel}
								</button>
							</div>
						</div>
						{newRoleError && (
							<div className="text-[11px] text-destructive">{newRoleError}</div>
						)}
						<div className="flex justify-end">
							<button
								type="button"
								onClick={handleAddNewRole}
								disabled={!newRoleName.trim()}
								className={cn(
									"px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all",
									newRoleName.trim()
										? "bg-primary text-white hover:bg-primary/90"
										: "bg-muted/50 text-muted-foreground cursor-not-allowed",
								)}
							>
								Create Role
							</button>
						</div>
					</div>
				)}

				<div className="space-y-2">
					{presets.map((preset) => {
						const isDefault = DEFAULT_ROLE_PRESETS.some(
							(p) => p.name === preset.name,
						);
						const defaultPreset = DEFAULT_ROLE_PRESETS.find(
							(p) => p.name === preset.name,
						);
						const hasOverride =
							isDefault && defaultPreset
								? preset.model !== defaultPreset.model ||
								  preset.profileId !== defaultPreset.profileId ||
								  preset.provider !== defaultPreset.provider
								: false;
						return (
							<div
								key={preset.name}
								className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/30 border border-border"
							>
								<AgentAvatar name={preset.name} size="sm" />
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<div className="text-[13px] font-medium text-foreground truncate">
											{preset.name}
										</div>
										{preset.tag && (
											<span
												className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0"
												style={{
													backgroundColor: `${preset.tagColor}20`,
													color: preset.tagColor,
												}}
											>
												{preset.tag}
											</span>
										)}
										{!isDefault && (
											<span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium shrink-0">
												Custom
											</span>
										)}
									</div>
									<div className="text-[11px] text-muted-foreground truncate">
										{preset.model}
										{preset.provider && (
											<span className="ml-1 text-muted-foreground/60">
												({preset.provider})
											</span>
										)}
									</div>
								</div>
								<div className="flex items-center gap-1.5 shrink-0">
									{hasOverride && (
										<button
											type="button"
											onClick={() => handleResetPreset(preset.name)}
											className="text-[10px] text-muted-foreground hover:text-destructive px-1.5 py-0.5 rounded hover:bg-muted/50 transition-colors"
											title="Reset to default"
										>
											Reset
										</button>
									)}
									{!isDefault && (
										<button
											type="button"
											onClick={() => handleDeleteCustomRole(preset.name)}
											className="text-[10px] text-muted-foreground hover:text-destructive px-1.5 py-0.5 rounded hover:bg-muted/50 transition-colors"
											title="Delete custom role"
										>
											Delete
										</button>
									)}
									<button
										type="button"
										onClick={() => handleOpenModelPicker(preset.name)}
										className="text-[11px] text-primary hover:text-primary/80 px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary/15 transition-colors"
									>
										Configure
									</button>
								</div>
							</div>
						);
					})}
				</div>
			</div>

			<ModelPickerModal
				open={modelPickerOpen}
				onClose={() => {
					setModelPickerOpen(false);
					setEditingPreset(null);
				}}
				availableModels={availableModels}
				currentModel={currentEditingPreset?.model ?? null}
				currentProfileId={currentEditingPreset?.profileId ?? null}
				onSelectModel={handleSelectModel}
			/>
		</>
	);
}

