import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ModelPickerModal } from "@/components/SlashCommands";
import { getAllPresets, memberProvider } from "@/rolePresets";

const DEFAULT_MODEL = getAllPresets()[0]?.model || "claude-sonnet-4-20250514";
const DEFAULT_PROVIDER = memberProvider(getAllPresets()[0]) ?? "anthropic";

interface CreateSessionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Available workspace directories */
	workspaces: string[];
	currentWorkingDir: string | null;
	/** Available model routes for the model picker */
	availableModels?: string[];
	/** Initial mode when opening the dialog */
	initMode?: "normal" | "swarm" | "addMember";
	/** Pre-seeded list of swarm members to display in the dialog. When
	 * `initMode === "addMember"`, the dialog operates in "add to existing
	 * swarm" mode and shows the existing team as read-only chips. */
	existingSwarmMembers?: Array<{
		roleName: string;
		model?: string | null;
		providerKey?: string | null;
	}>;
	/** Callbacks */
	onCreateNormal: (
		workingDir: string | null,
		model: string,
		profileId?: string,
	) => void;
	onCreateSwarm: (
		workingDir: string | null,
		model: string,
		profileId?: string,
	) => void;
	onAddSwarmMember: (
		roleName: string,
		model: string,
		profileId?: string,
		providerKey?: string,
	) => void;
	onRemoveSwarmMember?: (roleName: string) => void;
	/** Commit a single new member to an existing workspace. Used when
	 * `initMode === "addMember"`. Returns the new session id on success. */
	onCommitAddMember?: (
		workingDir: string | null,
		roleName: string,
		model: string,
		providerKey?: string,
	) => Promise<string | null> | string | null;
	/** Current swarm members (role names) */
	swarmMembers?: string[];
}

export function CreateSessionDialog({
	open,
	onOpenChange,
	workspaces,
	currentWorkingDir,
	availableModels = [],
	initMode = "swarm",
	existingSwarmMembers = [],
	onCreateNormal,
	onCreateSwarm,
	onAddSwarmMember,
	onRemoveSwarmMember,
	onCommitAddMember,
	swarmMembers = [],
}: CreateSessionDialogProps) {
	const [mode, setMode] = useState<"normal" | "swarm" | "addMember">(initMode);
	const [selectedWorkspace, setSelectedWorkspace] = useState<string>(
		currentWorkingDir || workspaces[0] || "",
	);
	const [useCustomWorkspace, setUseCustomWorkspace] = useState(
		workspaces.length === 0 ||
			(currentWorkingDir ? !workspaces.includes(currentWorkingDir) : false),
	);
	const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
	const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
		null,
	);
	const [customModel, setCustomModel] = useState("");
	const [swarmModel, setSwarmModel] = useState(DEFAULT_MODEL);
	const [swarmProfileId, setSwarmProfileId] = useState<string | null>(
		DEFAULT_PROVIDER,
	);
	const [newRoleName, setNewRoleName] = useState("");
	const [newRoleModel, setNewRoleModel] = useState(DEFAULT_MODEL);
	const [newRoleProfileId, setNewRoleProfileId] = useState<string | null>(
		DEFAULT_PROVIDER,
	);
	const [addMemberBusy, setAddMemberBusy] = useState(false);
	const [addMemberError, setAddMemberError] = useState<string | null>(null);

	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [modelPickerTarget, setModelPickerTarget] = useState<
		"normal" | "swarm" | "role" | null
	>(null);

	useEffect(() => {
		if (!open) return;
		setMode(initMode);
		setSelectedWorkspace(currentWorkingDir || workspaces[0] || "");
		setUseCustomWorkspace(
			workspaces.length === 0 ||
				(currentWorkingDir ? !workspaces.includes(currentWorkingDir) : false),
		);
		setAddMemberError(null);
	}, [currentWorkingDir, open, workspaces, initMode]);

	const effectiveModel = customModel || selectedModel;
	const effectiveProfileId = customModel ? null : selectedProfileId;

	if (!open) return null;

	const resolvedWorkspace = useCustomWorkspace
		? selectedWorkspace.trim() || null
		: selectedWorkspace || null;

	const handleStartNormal = () => {
		onCreateNormal(
			resolvedWorkspace,
			effectiveModel,
			effectiveProfileId ?? undefined,
		);
		onOpenChange(false);
	};

	const handleStartSwarm = () => {
		onCreateSwarm(resolvedWorkspace, swarmModel, swarmProfileId ?? undefined);
		onOpenChange(false);
	};

	const handleAddRole = () => {
		const name = newRoleName.trim();
		if (!name) return;
		const providerKey = newRoleProfileId ?? undefined;
		onAddSwarmMember(
			name,
			newRoleModel,
			newRoleProfileId ?? undefined,
			providerKey,
		);
		setNewRoleName("");
	};

	const handleCommitAddMember = async () => {
		const name = newRoleName.trim();
		if (!name || !onCommitAddMember) return;
		setAddMemberBusy(true);
		setAddMemberError(null);
		try {
			const newId = await onCommitAddMember(
				resolvedWorkspace,
				name,
				newRoleModel,
				newRoleProfileId ?? undefined,
			);
			if (newId) {
				setNewRoleName("");
				onOpenChange(false);
			} else {
				setAddMemberError("Failed to add member: server returned no id.");
			}
		} catch (e) {
			setAddMemberError(String(e));
		} finally {
			setAddMemberBusy(false);
		}
	};

	const openModelPicker = (target: "normal" | "swarm" | "role") => {
		setModelPickerTarget(target);
		setModelPickerOpen(true);
	};

	const handleSelectModelFromPicker = (model: string, profileId?: string) => {
		if (modelPickerTarget === "normal") {
			setSelectedModel(model);
			setSelectedProfileId(profileId || null);
			setCustomModel("");
		} else if (modelPickerTarget === "swarm") {
			setSwarmModel(model);
			setSwarmProfileId(profileId || null);
		} else if (modelPickerTarget === "role") {
			setNewRoleModel(model);
			setNewRoleProfileId(profileId || null);
		}
		setModelPickerOpen(false);
	};

	const pickerCurrentModel =
		modelPickerTarget === "normal"
			? effectiveModel
			: modelPickerTarget === "swarm"
				? swarmModel
				: modelPickerTarget === "role"
					? newRoleModel
					: null;

	const pickerCurrentProfileId =
		modelPickerTarget === "normal"
			? selectedProfileId
			: modelPickerTarget === "swarm"
				? swarmProfileId
				: modelPickerTarget === "role"
					? newRoleProfileId
					: null;

	return (
		<>
			<div className="fixed inset-0 z-50 flex items-center justify-center">
				<div
					className="absolute inset-0 bg-black/30"
					onClick={() => onOpenChange(false)}
				/>
				<div className="relative w-[480px] bg-card rounded-2xl shadow-xl border border-border overflow-hidden">
					{/* Header */}
					<div className="px-6 pt-5 pb-3 border-b border-border">
						<div className="flex items-center justify-between">
							<h2 className="text-[17px] font-bold text-foreground">
								New Session
							</h2>
							<button
								type="button"
								onClick={() => onOpenChange(false)}
								className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-muted-foreground hover:bg-muted/50"
							>
								<svg
									viewBox="0 0 20 20"
									fill="currentColor"
									className="w-4 h-4"
								>
									<path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
								</svg>
							</button>
						</div>
					</div>

					<div className="px-6 py-4 space-y-5">
						{/* Mode selector */}
						<div className="flex rounded-xl bg-muted/50 p-1">
							<button
								type="button"
								onClick={() => setMode("normal")}
								className={cn(
									"flex-1 px-4 py-2 rounded-[10px] text-[13px] font-medium transition-all",
									mode === "normal"
										? "bg-card text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<div className="flex items-center justify-center gap-2">
									<svg
										viewBox="0 0 20 20"
										fill="currentColor"
										className="w-4 h-4"
									>
										<path d="M10 2a.75.75 0 01.75.75v6.5h6.5a.75.75 0 010 1.5h-6.5v6.5a.75.75 0 01-1.5 0v-6.5h-6.5a.75.75 0 010-1.5h6.5v-6.5A.75.75 0 0110 2z" />
									</svg>
									Single Agent
								</div>
							</button>
							<button
								type="button"
								onClick={() => setMode("swarm")}
								className={cn(
									"flex-1 px-4 py-2 rounded-[10px] text-[13px] font-medium transition-all",
									mode === "swarm"
										? "bg-card text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<div className="flex items-center justify-center gap-2">
									<svg
										viewBox="0 0 20 20"
										fill="currentColor"
										className="w-4 h-4"
									>
										<path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
									</svg>
									Agent Team
								</div>
							</button>
						</div>

						{/* Workspace selection */}
						<div>
							<label className="block text-[12px] font-semibold text-foreground mb-1.5">
								Workspace
							</label>
							<div className="flex gap-2 flex-wrap">
								{(workspaces.length === 0 || useCustomWorkspace) && (
									<div
										className="flex-1 flex items-center gap-2 h-9 px-3 rounded-xl border border-border bg-card"
										title={selectedWorkspace || "No directory selected"}
									>
										<span className="flex-1 text-[13px] text-foreground truncate">
											{selectedWorkspace || "No directory selected"}
										</span>
										{selectedWorkspace && (
											<button
												type="button"
												onClick={() => setSelectedWorkspace("")}
												className="text-muted-foreground hover:text-destructive"
											>
												<svg
													viewBox="0 0 20 20"
													fill="currentColor"
													className="w-4 h-4"
												>
													<path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
												</svg>
											</button>
										)}
									</div>
								)}

								{workspaces.map((ws) => (
									<button
										key={ws}
										type="button"
										onClick={() => {
											setUseCustomWorkspace(false);
											setSelectedWorkspace(ws);
										}}
										className={cn(
											"px-3 py-1.5 rounded-xl text-[12px] font-medium border transition-all",
											selectedWorkspace === ws
												? "bg-primary/10 border-primary/50 text-primary"
												: "bg-card border-border text-muted-foreground hover:border-muted-foreground/30",
										)}
									>
										{ws === "default" ? "Default" : ws.split("/").pop() || ws}
									</button>
								))}
								<button
									type="button"
									onClick={async () => {
										try {
											const selected = await openDialog({
												directory: true,
												multiple: false,
											});
											if (selected && typeof selected === "string") {
												setUseCustomWorkspace(true);
												setSelectedWorkspace(selected);
											}
										} catch {
											// user cancelled
										}
									}}
									className={cn(
										"px-3 py-1.5 rounded-xl text-[12px] font-medium border transition-all",
										useCustomWorkspace
											? "bg-primary/10 border-primary/50 text-primary"
											: "bg-card border-border text-muted-foreground hover:border-muted-foreground/30",
									)}
								>
									Browse...
								</button>
							</div>
						</div>

						{mode === "normal" ? (
							/* ── Normal mode: pick model ── */
							<div>
								<label className="block text-[12px] font-semibold text-foreground mb-1.5">
									Model
								</label>
								<button
									type="button"
									onClick={() => openModelPicker("normal")}
									className="w-full text-left px-3 py-2 rounded-xl text-[13px] font-medium border transition-all flex items-center justify-between bg-card border-border hover:border-muted-foreground/30"
								>
									<span className="truncate">
										{customModel || selectedModel}
									</span>
									<span className="text-[11px] text-muted-foreground shrink-0 ml-2">
										Change
									</span>
								</button>
								<div className="pt-1">
									<input
										type="text"
										value={customModel}
										onChange={(e) => {
											setCustomModel(e.target.value);
											setSelectedProfileId(null);
										}}
										placeholder="Or enter custom model ID..."
										className="w-full h-9 px-3 rounded-xl border border-border text-[13px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
									/>
								</div>
							</div>
						) : (
							/* ── Swarm mode: default model + add roles ── */
							<>
								<div>
									<label className="block text-[12px] font-semibold text-foreground mb-1.5">
										Orchestrator Model
									</label>
									<button
										type="button"
										onClick={() => openModelPicker("swarm")}
										className="w-full text-left px-3 py-2 rounded-xl text-[13px] font-medium border transition-all flex items-center justify-between bg-card border-border hover:border-muted-foreground/30"
									>
										<span className="truncate">{swarmModel}</span>
										<span className="text-[11px] text-muted-foreground shrink-0 ml-2">
											Change
										</span>
									</button>
								</div>

								{/* Role presets / current members */}
								<div>
									<div className="flex items-center justify-between mb-1.5">
										<label className="text-[12px] font-semibold text-foreground">
											Team Members
										</label>
										<span className="text-[11px] text-muted-foreground">
											{swarmMembers.length} added
										</span>
									</div>

									{/* Current members */}
									{swarmMembers.length > 0 && (
										<div className="flex flex-wrap gap-2 mb-3">
											{swarmMembers.map((name) => (
												<span
													key={name}
													className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-[12px] font-medium"
												>
													{name}
													<button
														type="button"
														onClick={() => onRemoveSwarmMember?.(name)}
														className="w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-primary/10"
													>
														<svg
															viewBox="0 0 12 12"
															fill="currentColor"
															className="w-3 h-3"
														>
															<path d="M2.22 2.22a.75.75 0 011.06 0L6 4.94l2.72-2.72a.75.75 0 111.06 1.06L7.06 6l2.72 2.72a.75.75 0 11-1.06 1.06L6 7.06l-2.72 2.72a.75.75 0 01-1.06-1.06L4.94 6 2.22 3.28a.75.75 0 010-1.06z" />
														</svg>
													</button>
												</span>
											))}
										</div>
									)}

									{/* Role presets */}
									<div className="grid grid-cols-2 gap-2 mb-3">
										{getAllPresets().map((role) => {
											const alreadyAdded = swarmMembers.includes(role.name);
											const provider = memberProvider(role);
											return (
												<button
													key={role.name}
													type="button"
													disabled={alreadyAdded}
													onClick={() =>
														onAddSwarmMember(
															role.name,
															role.model,
															role.profileId,
															provider,
														)
													}
													className={cn(
														"text-left px-3 py-2 rounded-xl border text-[12px] transition-all",
														alreadyAdded
															? "bg-muted/50 border-border text-muted-foreground cursor-not-allowed"
															: "bg-card border-border hover:border-primary/50 hover:bg-muted/80 text-foreground",
													)}
												>
													<div className="flex items-baseline justify-between gap-1">
														<span className="font-semibold">{role.name}</span>
														{provider && (
														<span className="text-[9px] uppercase tracking-wide text-muted-foreground/80">
															{provider}
														</span>
														)}
													</div>
													<div className="text-[10px] text-muted-foreground mt-0.5">
														{role.detail}
													</div>
												</button>
											);
										})}
									</div>

									{/* Custom role */}
									<div className="flex gap-2">
										<input
											type="text"
											value={newRoleName}
											onChange={(e) => setNewRoleName(e.target.value)}
											placeholder="Custom role name..."
											className="flex-1 h-9 px-3 rounded-xl border border-border text-[13px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
											onKeyDown={(e) => {
												if (e.key === "Enter") handleAddRole();
											}}
										/>
										<button
											type="button"
											onClick={() => openModelPicker("role")}
											className="px-3 py-1.5 rounded-xl text-[12px] font-medium border bg-card border-border hover:border-muted-foreground/30 truncate max-w-[120px] flex flex-col items-start leading-tight"
											title={`${newRoleProfileId ?? "auto"}: ${newRoleModel}`}
										>
											<span className="truncate w-full text-left">
												{newRoleModel}
											</span>
											{newRoleProfileId && (
												<span className="text-[9px] uppercase tracking-wide text-muted-foreground">
													{newRoleProfileId}
												</span>
											)}
										</button>
										<button
											type="button"
											onClick={handleAddRole}
											disabled={!newRoleName.trim()}
											className={cn(
												"px-3 py-1.5 rounded-xl text-[12px] font-medium transition-all",
												newRoleName.trim()
													? "bg-primary text-white hover:bg-primary"
													: "bg-muted/50 text-muted-foreground cursor-not-allowed",
											)}
										>
											Add
										</button>
									</div>
								</div>
							</>
						)}

						{mode === "addMember" && (
							/* ── Add-member mode: list existing team, then add one new role ── */
							<div className="space-y-3">
								{existingSwarmMembers.length > 0 && (
									<div>
										<label className="block text-[12px] font-semibold text-foreground mb-1.5">
											Current team
										</label>
										<div className="flex flex-wrap gap-2">
											{existingSwarmMembers.map((member) => (
												<span
													key={member.roleName}
													className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted text-muted-foreground text-[12px] font-medium"
												>
													{member.roleName}
													{member.providerKey && (
														<span className="text-[9px] uppercase tracking-wide text-muted-foreground/80">
															{member.providerKey}
														</span>
													)}
												</span>
											))}
										</div>
									</div>
								)}
								<div>
									<label className="block text-[12px] font-semibold text-foreground mb-1.5">
										New member name
									</label>
									<input
										type="text"
										value={newRoleName}
										onChange={(e) => setNewRoleName(e.target.value)}
										placeholder="e.g. Tester, Reviewer, Atlas-2..."
										className="w-full h-9 px-3 rounded-xl border border-border text-[13px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
									/>
								</div>
								<div>
									<label className="block text-[12px] font-semibold text-foreground mb-1.5">
										Model
									</label>
									<button
										type="button"
										onClick={() => openModelPicker("role")}
										className="w-full text-left px-3 py-2 rounded-xl text-[13px] font-medium border transition-all flex items-center justify-between bg-card border-border hover:border-muted-foreground/30"
									>
										<span className="flex flex-col items-start leading-tight truncate">
											<span className="truncate w-full text-left">
												{newRoleModel}
											</span>
											{newRoleProfileId && (
												<span className="text-[9px] uppercase tracking-wide text-muted-foreground">
													{newRoleProfileId}
												</span>
											)}
										</span>
										<span className="text-[11px] text-muted-foreground shrink-0 ml-2">
											Change
										</span>
									</button>
								</div>
								{addMemberError && (
									<div className="text-[11px] text-destructive">
										{addMemberError}
									</div>
								)}
							</div>
						)}
					</div>

					{/* Footer */}
					<div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className="px-4 py-2 rounded-xl text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={
								mode === "normal"
									? handleStartNormal
									: mode === "addMember"
										? handleCommitAddMember
										: handleStartSwarm
							}
							disabled={mode === "addMember" && (addMemberBusy || !newRoleName.trim())}
							className={cn(
								"px-5 py-2 rounded-xl text-[13px] font-medium transition-all",
								mode === "addMember" && (addMemberBusy || !newRoleName.trim())
									? "bg-muted/50 text-muted-foreground cursor-not-allowed"
									: "bg-primary text-primary-foreground hover:bg-primary/90",
							)}
						>
							{mode === "normal"
								? "Start Session"
								: mode === "addMember"
									? addMemberBusy
										? "Adding..."
										: "Add Member"
									: "Launch Agent Team"}
						</button>
					</div>
				</div>
			</div>

			<ModelPickerModal
				open={modelPickerOpen}
				onClose={() => setModelPickerOpen(false)}
				availableModels={availableModels}
				currentModel={pickerCurrentModel}
				currentProfileId={pickerCurrentProfileId}
				onSelectModel={handleSelectModelFromPicker}
			/>
		</>
	);
}
