import { useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "@/types";
import { Users, LayoutList, GitPullRequest, Settings2, CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import type { RolePreset } from "@/types";
import { DEFAULT_ROLE_PRESETS, setRolePresetOverride, clearRolePresetOverride, getRolePresetWithOverrides, getCustomRolePresets, addCustomRolePreset, removeCustomRolePreset, updateCustomRolePreset } from "@/rolePresets";
import { ModelPickerModal } from "./SlashCommands";

interface TeamPageProps {
	sessions: SessionInfo[];
	/** Available model routes for the model picker */
	availableModels?: string[];
}

export function TeamPage({ sessions, availableModels = [] }: TeamPageProps) {
	const swarmSessions = useMemo(
		() => sessions.filter((s) => s.swarmEnabled || s.swarmRole),
		[sessions],
	);

	const coordinators = useMemo(
		() => swarmSessions.filter((s) => s.swarmRole === "coordinator"),
		[swarmSessions],
	);

	const agents = useMemo(
		() => swarmSessions.filter((s) => s.swarmRole === "agent"),
		[swarmSessions],
	);

	const plans = useMemo(() => {
		const map = new Map<string, NonNullable<SessionInfo["swarmPlan"]>>();
		for (const s of swarmSessions) {
			if (s.swarmPlan && !map.has(s.swarmPlan.swarmId)) {
				map.set(s.swarmPlan.swarmId, s.swarmPlan);
			}
		}
		return Array.from(map.values());
	}, [swarmSessions]);

	const proposals = useMemo(() => {
		const map = new Map<string, NonNullable<SessionInfo["swarmProposal"]>>();
		for (const s of swarmSessions) {
			if (s.swarmProposal && !map.has(s.swarmProposal.swarmId)) {
				map.set(s.swarmProposal.swarmId, s.swarmProposal);
			}
		}
		return Array.from(map.values());
	}, [swarmSessions]);

	// ── Role preset configuration ──
	const [presets, setPresets] = useState<RolePreset[]>(() => [
		...DEFAULT_ROLE_PRESETS.map((p) => getRolePresetWithOverrides(p.name) ?? p),
		...getCustomRolePresets(),
	]);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [editingPreset, setEditingPreset] = useState<string | null>(null);
	const [proposalAction, setProposalAction] = useState<
		{ key: string; kind: "approving" | "rejecting" } | null
	>(null);
	const [proposalError, setProposalError] = useState<string | null>(null);

	const refreshPresets = useCallback(() => {
		setPresets([
			...DEFAULT_ROLE_PRESETS.map((p) => getRolePresetWithOverrides(p.name) ?? p),
			...getCustomRolePresets(),
		]);
	}, []);

	const handleProposalAction = useCallback(
		async (proposal: SessionInfo["swarmProposal"], action: "approve" | "reject") => {
			if (!proposal) return;
			const coordinator = coordinators.find((c) => c.swarmId === proposal.swarmId);
			if (!coordinator) {
				setProposalError("No coordinator found for this swarm.");
				return;
			}
			setProposalAction({ key: proposal.proposalKey, kind: action === "approve" ? "approving" : "rejecting" });
			setProposalError(null);
			try {
				if (action === "approve") {
					await invoke("comm_approve_plan", {
						session_id: coordinator.sessionId,
						proposer_session: proposal.proposerSession,
					});
				} else {
					await invoke("comm_reject_plan", {
						session_id: coordinator.sessionId,
						proposer_session: proposal.proposerSession,
						reason: "Rejected from Team page",
					});
				}
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				setProposalError(message);
			} finally {
				setProposalAction(null);
			}
		},
		[coordinators],
	);

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

	// ── New role form ──
	const [showNewRoleForm, setShowNewRoleForm] = useState(false);
	const [newRoleName, setNewRoleName] = useState("");
	const [newRoleTag, setNewRoleTag] = useState("AGENT");
	const [newRoleTagColor, setNewRoleTagColor] = useState("#6B7280");
	const [newRoleDetail, setNewRoleDetail] = useState("");
	const [newRoleModel, setNewRoleModel] = useState("claude-sonnet-4-20250514");
	const [newRoleProfileId, setNewRoleProfileId] = useState<string | undefined>("anthropic");
	const [newRoleError, setNewRoleError] = useState<string | null>(null);

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
	}, [presets, editingPreset, newRoleName, newRoleModel, newRoleProfileId, newRoleDetail, newRoleTag, newRoleTagColor]);

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
				// Update custom preset model atomically
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
	}, [newRoleName, newRoleModel, newRoleProfileId, newRoleDetail, newRoleTag, newRoleTagColor, presets, refreshPresets]);

	const handleDeleteCustomRole = useCallback(
		(name: string) => {
			removeCustomRolePreset(name);
			refreshPresets();
		},
		[refreshPresets],
	);

	return (
		<>
			<div className="flex-1 flex flex-col min-w-0 bg-card overflow-hidden overflow-x-hidden">
			{/* Header */}
			<div className="px-4 md:px-6 py-3 md:py-4 border-b border-border flex items-center gap-2 md:gap-3 shrink-0">
				<div className="w-7 h-7 md:w-9 md:h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
					<Users className="w-4 h-4 md:w-5 md:h-5" />
				</div>
				<div className="min-w-0">
					<h1 className="text-[14px] md:text-[16px] font-semibold text-foreground">Team</h1>
					<p className="text-[11px] md:text-[12px] text-muted-foreground">
						{agents.length} agents · {coordinators.length} coordinator
						{coordinators.length !== 1 ? "s" : ""}
					</p>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 py-3 md:py-4 min-w-0">
				<div className="max-w-3xl mx-auto space-y-4">
					{/* Agents */}
					{agents.length > 0 && (
						<div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
							<div className="text-[13px] font-semibold text-foreground flex items-center gap-2">
								<Users className="w-4 h-4 text-primary" />
								Active Agents
							</div>
							<div className="space-y-2">
								{agents.map((agent) => (
									<div
										key={agent.sessionId}
										className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/30 border border-border"
									>
										<AgentAvatar name={agent.roleName || "Agent"} size="sm" />
										<div className="flex-1 min-w-0">
											<div className="text-[13px] font-medium text-foreground truncate">
												{agent.roleName}
											</div>
											<div className="text-[11px] text-muted-foreground truncate">
												{agent.model || "default"}
											</div>
										</div>
										<div className="flex items-center gap-1.5 shrink-0">
											<span
												className={cn(
													"w-2 h-2 rounded-full",
													agent.liveProcessing
														? "bg-primary animate-pulse"
														: "bg-emerald-500",
												)}
											/>
											<span className="text-[11px] text-muted-foreground">
												{agent.liveProcessing ? "Working" : "Ready"}
											</span>
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Coordinators */}
					{coordinators.length > 0 && (
						<div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
							<div className="text-[13px] font-semibold text-foreground flex items-center gap-2">
								<Users className="w-4 h-4 text-primary" />
								Active Coordinators
							</div>
							<div className="space-y-2">
								{coordinators.map((c) => (
									<div
										key={c.sessionId}
										className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/30 border border-border"
									>
										<AgentAvatar name={c.roleName || "Coordinator"} size="sm" />
										<div className="flex-1 min-w-0">
											<div className="text-[13px] font-medium text-foreground truncate">
												{c.roleName || "Coordinator"}
											</div>
											<div className="text-[11px] text-muted-foreground truncate">
												{c.model || "default"}
											</div>
										</div>
										<span className="text-[11px] text-emerald-500 shrink-0">Active</span>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Plans */}
					{plans.map((plan) => (
						<div
							key={plan.swarmId}
							className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3"
						>
							<div className="flex items-center gap-2">
								<LayoutList className="w-4 h-4 text-primary" />
								<span className="text-[13px] font-semibold text-foreground">
									Plan v{plan.version}
								</span>
								<span className="ml-auto text-[11px] text-muted-foreground">
									{plan.itemCount} items
								</span>
							</div>
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
								<MiniStat
									label="Ready"
									value={plan.readyCount}
									color="text-emerald-500"
								/>
								<MiniStat
									label="Active"
									value={plan.activeCount}
									color="text-primary"
								/>
								<MiniStat
									label="Blocked"
									value={plan.blockedCount}
									color="text-amber-500"
								/>
								<MiniStat
									label="Done"
									value={plan.completedCount}
									color="text-emerald-500/80"
								/>
							</div>
							{plan.reason && (
								<p className="text-[12px] text-muted-foreground">
									{plan.reason}
								</p>
							)}
						</div>
					))}

					{/* Proposals */}
					{proposalError && (
						<div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-[12px] text-destructive flex items-start gap-2">
							<AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
							{proposalError}
						</div>
					)}
					{proposals.map((proposal) => {
						const isActing =
							proposalAction?.key === proposal.proposalKey;
						return (
							<div
								key={proposal.swarmId}
								className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3"
							>
								<div className="flex items-center gap-2">
									<GitPullRequest className="w-4 h-4 text-primary" />
									<span className="text-[13px] font-semibold text-foreground">
										Proposal
									</span>
								</div>
								<p className="text-[13px] text-foreground leading-relaxed">
									{proposal.summary}
								</p>
								<div className="flex items-center justify-between gap-3">
									<div className="flex items-center gap-4 text-[11px] text-muted-foreground">
										<span>{proposal.itemCount} items</span>
										<span>By {proposal.proposerName || "Unknown"}</span>
									</div>
									<div className="flex items-center gap-2">
										<button
											type="button"
											disabled={isActing}
											onClick={() => handleProposalAction(proposal, "approve")}
											className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
										>
											{isActing && proposalAction?.kind === "approving" ? (
												<Loader2 className="w-3 h-3 animate-spin" />
											) : (
												<CheckCircle2 className="w-3 h-3" />
											)}
											Approve
										</button>
										<button
											type="button"
											disabled={isActing}
											onClick={() => handleProposalAction(proposal, "reject")}
											className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-colors"
										>
											{isActing && proposalAction?.kind === "rejecting" ? (
												<Loader2 className="w-3 h-3 animate-spin" />
											) : (
												<XCircle className="w-3 h-3" />
											)}
											Reject
										</button>
									</div>
								</div>
							</div>
						);
					})}

					{/* Preset Roles */}
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

						{/* New role form */}
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
							const isDefault = DEFAULT_ROLE_PRESETS.some((p) => p.name === preset.name);
							const defaultPreset = DEFAULT_ROLE_PRESETS.find((p) => p.name === preset.name);
							const hasOverride = isDefault && defaultPreset ? (
								preset.model !== defaultPreset.model ||
								preset.profileId !== defaultPreset.profileId ||
								preset.provider !== defaultPreset.provider
							) : false;
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

					{agents.length === 0 && plans.length === 0 && (
						<div className="flex flex-col items-center justify-center py-16 text-center">
							<Users className="w-10 h-10 text-muted-foreground/30 mb-3" />
							<p className="text-[14px] text-muted-foreground">
								No active swarm
							</p>
							<p className="text-[12px] text-muted-foreground/60 mt-1">
								Create a swarm session to see agent coordination here
							</p>
						</div>
					)}
				</div>
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

function MiniStat({
	label,
	value,
	color,
}: {
	label: string;
	value: number;
	color: string;
}) {
	return (
		<div className="rounded-lg bg-muted/30 border border-border p-2.5 text-center">
			<div className={cn("text-[16px] font-semibold", color)}>{value}</div>
			<div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
		</div>
	);
}
