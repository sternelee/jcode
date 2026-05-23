import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { open as openDialog } from "@tauri-apps/plugin-dialog";



interface CreateSessionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Available workspace directories */
	workspaces: string[];
	currentWorkingDir: string | null;
	/** Available model routes for the model picker */
	availableModels?: string[];
	/** Initial mode when opening the dialog */
	initMode?: "normal" | "swarm";
	/** Callbacks */
	onCreateNormal: (workingDir: string | null, model: string) => void;
	onCreateSwarm: (workingDir: string | null, model: string) => void;
	onAddSwarmMember: (roleName: string, model: string) => void;
	onRemoveSwarmMember?: (roleName: string) => void;
	/** Current swarm members (role names) */
	swarmMembers?: string[];
}

const TOP_MODELS = [
	{ id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
	{ id: "claude-opus-4-20250514", label: "Claude Opus 4" },
	{ id: "gpt-4o", label: "GPT-4o" },
	{ id: "gpt-4o-mini", label: "GPT-4o mini" },
	{ id: "deepseek-chat", label: "DeepSeek V3" },
];

const ROLE_PRESETS = [
	{ name: "Researcher", model: "claude-sonnet-4-20250514", detail: "Deep research & analysis" },
	{ name: "Engineer", model: "claude-sonnet-4-20250514", detail: "Code implementation & review" },
	{ name: "Strategist", model: "gpt-4o", detail: "Planning & decision making" },
	{ name: "Designer", model: "claude-sonnet-4-20250514", detail: "UI/UX & visual design" },
	{ name: "Critic", model: "gpt-4o-mini", detail: "Quality assurance & feedback" },
];

export function CreateSessionDialog({
	open,
	onOpenChange,
	workspaces,
	currentWorkingDir,
	availableModels = [],
	initMode = "swarm",
	onCreateNormal,
	onCreateSwarm,
	onAddSwarmMember,
	onRemoveSwarmMember,
	swarmMembers = [],
}: CreateSessionDialogProps) {
	const [mode, setMode] = useState<"normal" | "swarm">(initMode);
	const [selectedWorkspace, setSelectedWorkspace] = useState<string>(
		currentWorkingDir || workspaces[0] || "",
	);
	const [useCustomWorkspace, setUseCustomWorkspace] = useState(
		workspaces.length === 0 ||
			(currentWorkingDir ? !workspaces.includes(currentWorkingDir) : false),
	);
	const [selectedModel, setSelectedModel] = useState(TOP_MODELS[0].id);
	const [customModel, setCustomModel] = useState("");
	const [swarmModel, setSwarmModel] = useState(TOP_MODELS[0].id);
	const [newRoleName, setNewRoleName] = useState("");
	const [newRoleModel] = useState(TOP_MODELS[1].id);

	useEffect(() => {
		if (!open) return;
		setMode(initMode);
		setSelectedWorkspace(currentWorkingDir || workspaces[0] || "");
		setUseCustomWorkspace(
			workspaces.length === 0 ||
				(currentWorkingDir ? !workspaces.includes(currentWorkingDir) : false),
		);
	}, [currentWorkingDir, open, workspaces]);

	const effectiveModel = customModel || selectedModel;

	if (!open) return null;

	const resolvedWorkspace = useCustomWorkspace
		? selectedWorkspace.trim() || null
		: selectedWorkspace || null;

	const handleStartNormal = () => {
		onCreateNormal(resolvedWorkspace, effectiveModel);
		onOpenChange(false);
	};

	const handleStartSwarm = () => {
		onCreateSwarm(resolvedWorkspace, swarmModel);
		onOpenChange(false);
	};

	const handleAddRole = () => {
		const name = newRoleName.trim();
		if (!name) return;
		onAddSwarmMember(name, newRoleModel);
		setNewRoleName("");
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0 bg-black/30" onClick={() => onOpenChange(false)} />
			<div className="relative w-[480px] bg-white rounded-2xl shadow-xl border border-[#E5E7EB] overflow-hidden">
				{/* Header */}
				<div className="px-6 pt-5 pb-3 border-b border-[#F3F4F6]">
					<div className="flex items-center justify-between">
						<h2 className="text-[17px] font-bold text-[#111827]">New Session</h2>
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className="w-7 h-7 rounded-lg flex items-center justify-center text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F3F4F6]"
						>
							<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
								<path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
							</svg>
						</button>
					</div>
				</div>

				<div className="px-6 py-4 space-y-5">
					{/* Mode selector */}
					<div className="flex rounded-xl bg-[#F3F4F6] p-1">
						<button
							type="button"
							onClick={() => setMode("normal")}
							className={cn(
								"flex-1 px-4 py-2 rounded-[10px] text-[13px] font-medium transition-all",
								mode === "normal"
									? "bg-white text-[#111827] shadow-sm"
									: "text-[#6B7280] hover:text-[#374151]",
							)}
						>
							<div className="flex items-center justify-center gap-2">
								<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
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
									? "bg-white text-[#111827] shadow-sm"
									: "text-[#6B7280] hover:text-[#374151]",
							)}
						>
							<div className="flex items-center justify-center gap-2">
								<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
									<path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
								</svg>
								Agent Team
							</div>
						</button>
					</div>

					{/* Workspace selection */}
					<div>
						<label className="block text-[12px] font-semibold text-[#374151] mb-1.5">
							Workspace
						</label>
						<div className="flex gap-2 flex-wrap">
								{(workspaces.length === 0 || useCustomWorkspace) && (
									<div className="flex-1 flex items-center gap-2 h-9 px-3 rounded-xl border border-[#E5E7EB] bg-white"
										title={selectedWorkspace || "No directory selected"}
									>
										<span className="flex-1 text-[13px] text-[#374151] truncate">
											{selectedWorkspace || "No directory selected"}
										</span>
										{selectedWorkspace && (
											<button
												type="button"
												onClick={() => setSelectedWorkspace("")}
												className="text-[#9CA3AF] hover:text-[#EF4444]"
											>
												<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
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
											? "bg-[#EFF6FF] border-[#3B82F6] text-[#2563EB]"
											: "bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]",
									)}
								>
									{ws === "default"
										? "Default"
										: ws.split("/").pop() || ws}
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
										? "bg-[#EFF6FF] border-[#3B82F6] text-[#2563EB]"
										: "bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]",
								)}
							>
								Browse...
							</button>
						</div>
					</div>

					{mode === "normal" ? (
						/* ── Normal mode: pick model ── */
						<div>
							<label className="block text-[12px] font-semibold text-[#374151] mb-1.5">
								Model
							</label>
							<div className="space-y-1.5">
								{TOP_MODELS.map((m) => (
									<button
										key={m.id}
										type="button"
										onClick={() => {
											setSelectedModel(m.id);
											setCustomModel("");
										}}
										className={cn(
											"w-full text-left px-3 py-2 rounded-xl text-[13px] font-medium border transition-all flex items-center justify-between",
											effectiveModel === m.id
												? "bg-[#EFF6FF] border-[#3B82F6] text-[#2563EB]"
												: "bg-white border-[#E5E7EB] text-[#374151] hover:border-[#D1D5DB]",
										)}
									>
										<span>{m.label}</span>
										{effectiveModel === m.id && (
											<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-[#3B82F6]">
												<path
													fillRule="evenodd"
													d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
													clipRule="evenodd"
												/>
											</svg>
										)}
									</button>
								))}
								{availableModels.length > 0 && (
									<>
										<div className="text-[10px] text-[#9CA3AF] font-medium uppercase pt-1">
											Available
										</div>
										{availableModels.slice(0, 4).map((m) => (
											<button
												key={m}
												type="button"
												onClick={() => {
													setSelectedModel(m);
													setCustomModel("");
												}}
												className={cn(
													"w-full text-left px-3 py-2 rounded-xl text-[12px] font-medium border transition-all font-mono",
													effectiveModel === m
														? "bg-[#EFF6FF] border-[#3B82F6] text-[#2563EB]"
														: "bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]",
												)}
											>
												{m}
											</button>
										))}
									</>
								)}
								<div className="pt-1">
									<input
										type="text"
										value={customModel}
										onChange={(e) => setCustomModel(e.target.value)}
										placeholder="Custom model ID..."
										className="w-full h-9 px-3 rounded-xl border border-[#E5E7EB] text-[13px] outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6]/20"
									/>
								</div>
							</div>
						</div>
					) : (
						/* ── Swarm mode: default model + add roles ── */
						<>
							<div>
								<label className="block text-[12px] font-semibold text-[#374151] mb-1.5">
									Orchestrator Model
								</label>
								<div className="flex gap-2">
									{TOP_MODELS.slice(0, 3).map((m) => (
										<button
											key={m.id}
											type="button"
											onClick={() => setSwarmModel(m.id)}
											className={cn(
												"px-3 py-1.5 rounded-xl text-[12px] font-medium border transition-all",
												swarmModel === m.id
													? "bg-[#EFF6FF] border-[#3B82F6] text-[#2563EB]"
													: "bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]",
											)}
										>
											{m.label}
										</button>
									))}
								</div>
							</div>

							{/* Role presets / current members */}
							<div>
								<div className="flex items-center justify-between mb-1.5">
									<label className="text-[12px] font-semibold text-[#374151]">
										Team Members
									</label>
									<span className="text-[11px] text-[#6B7280]">
										{swarmMembers.length} added
									</span>
								</div>

								{/* Current members */}
								{swarmMembers.length > 0 && (
									<div className="flex flex-wrap gap-2 mb-3">
										{swarmMembers.map((name) => (
											<span
												key={name}
												className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#EFF6FF] text-[#3B82F6] text-[12px] font-medium"
											>
												{name}
												<button
													type="button"
													onClick={() => onRemoveSwarmMember?.(name)}
													className="w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-[#DBEAFE]"
												>
													<svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
														<path d="M2.22 2.22a.75.75 0 011.06 0L6 4.94l2.72-2.72a.75.75 0 111.06 1.06L7.06 6l2.72 2.72a.75.75 0 11-1.06 1.06L6 7.06l-2.72 2.72a.75.75 0 01-1.06-1.06L4.94 6 2.22 3.28a.75.75 0 010-1.06z" />
													</svg>
												</button>
											</span>
										))}
									</div>
								)}

								{/* Role presets */}
								<div className="grid grid-cols-2 gap-2 mb-3">
									{ROLE_PRESETS.map((role) => {
										const alreadyAdded = swarmMembers.includes(role.name);
										return (
											<button
												key={role.name}
												type="button"
												disabled={alreadyAdded}
												onClick={() => onAddSwarmMember(role.name, role.model)}
												className={cn(
													"text-left px-3 py-2 rounded-xl border text-[12px] transition-all",
													alreadyAdded
														? "bg-[#F3F4F6] border-[#E5E7EB] text-[#9CA3AF] cursor-not-allowed"
														: "bg-white border-[#E5E7EB] hover:border-[#3B82F6] hover:bg-[#FAFBFC] text-[#374151]",
												)}
											>
												<div className="font-semibold">{role.name}</div>
												<div className="text-[10px] text-[#9CA3AF] mt-0.5">{role.detail}</div>
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
										className="flex-1 h-9 px-3 rounded-xl border border-[#E5E7EB] text-[13px] outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6]/20"
										onKeyDown={(e) => {
											if (e.key === "Enter") handleAddRole();
										}}
									/>
									<button
										type="button"
										onClick={handleAddRole}
										disabled={!newRoleName.trim()}
										className={cn(
											"px-3 py-1.5 rounded-xl text-[12px] font-medium transition-all",
											newRoleName.trim()
												? "bg-[#3B82F6] text-white hover:bg-[#2563EB]"
												: "bg-[#F3F4F6] text-[#9CA3AF] cursor-not-allowed",
										)}
									>
										Add
									</button>
								</div>
							</div>
						</>
					)}
				</div>

				{/* Footer */}
				<div className="px-6 py-4 border-t border-[#F3F4F6] flex items-center justify-end gap-2">
					<button
						type="button"
						onClick={() => onOpenChange(false)}
						className="px-4 py-2 rounded-xl text-[13px] font-medium text-[#6B7280] hover:text-[#374151] hover:bg-[#F3F4F6] transition-all"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={mode === "normal" ? handleStartNormal : handleStartSwarm}
						className={cn(
							"px-5 py-2 rounded-xl text-[13px] font-medium transition-all",
							mode === "normal"
								? "bg-[#3B82F6] text-white hover:bg-[#2563EB]"
								: "bg-[#8B5CF6] text-white hover:bg-[#7C3AED]",
						)}
					>
						{mode === "normal" ? "Start Session" : "Launch Agent Team"}
					</button>
				</div>
			</div>
		</div>
	);
}
