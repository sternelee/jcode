import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import type {
	AuthStatus,
	VersionInfo,
	MemoryEntry,
	MemoryStats,
	MemoryGraphSnapshot,
	WorkspaceMemoryPreferences,
} from "@/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MemoryGraph } from "@/components/MemoryGraph";
import { ModelPickerModal } from "./SlashCommands";
import {
	Moon,
	Sun,
	Key,
	Cpu,
	Brain,
	Download,
	Upload,
	CheckCircle2,
	Search,
	X,
	Tag,
	Database,
	BarChart3,
	FolderOpen,
	ToggleLeft,
	ToggleRight,
	Network,
	ChevronDown,
	ChevronRight,
	Bot,
	FileKey,
} from "lucide-react";
import { EnvVariablesCard } from "./EnvVariablesCard";

interface SettingsPageProps {
	theme: "light" | "dark";
	onThemeChange: (theme: "light" | "dark") => void;
	onExportMemories?: (path: string) => Promise<void>;
	onImportMemories?: (
		path: string,
	) => Promise<{ project_count: number; global_count: number }>;
	onSearchMemories?: (
		query: string,
		semantic: boolean,
	) => Promise<MemoryEntry[]>;
	onGetMemoryList?: (
		scope: "all" | "project" | "global",
		tag?: string,
	) => Promise<MemoryEntry[]>;
	onGetMemoryStats?: () => Promise<MemoryStats | null>;
	onGetMemoryGraph?: () => Promise<MemoryGraphSnapshot | null>;
	onGetWorkspaceMemoryPreferences?: () => Promise<WorkspaceMemoryPreferences | null>;
	onSetWorkspaceMemoryPreference?: (
		workingDir: string | null,
		enabled: boolean,
	) => Promise<void>;
	availableModels?: string[];
	currentModel?: string;
	currentProfileId?: string;
	onSetModel?: (model: string, profileId?: string) => void;
}


export function SettingsPage({
	theme,
	onThemeChange,
	onExportMemories,
	onImportMemories,
	onSearchMemories,
	onGetMemoryList,
	onGetMemoryStats,
	onGetMemoryGraph,
	onGetWorkspaceMemoryPreferences,
	onSetWorkspaceMemoryPreference,
	availableModels,
	currentModel,
	currentProfileId,
	onSetModel,
}: SettingsPageProps) {
	const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
	const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
	const [copiedText, setCopiedText] = useState<string | null>(null);
	const [exportPath, setExportPath] = useState("");
	const [importPath, setImportPath] = useState("");
	const [memoryAction, setMemoryAction] = useState<{
		type: "export" | "import";
		status: string;
	} | null>(null);
	const [memorySearchQuery, setMemorySearchQuery] = useState("");
	const [memorySearchSemantic, setMemorySearchSemantic] = useState(false);
	const [memoryResults, setMemoryResults] = useState<MemoryEntry[]>([]);
	const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
	const [memoryScope, setMemoryScope] = useState<"all" | "project" | "global">(
		"all",
	);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [memoryTag, setMemoryTag] = useState("");
	const [memoryLoading, setMemoryLoading] = useState(false);
	const [expandedMemoryId, setExpandedMemoryId] = useState<string | null>(null);
	const [memoryGraph, setMemoryGraph] = useState<MemoryGraphSnapshot | null>(
		null,
	);
	const [memoryGraphLoading, setMemoryGraphLoading] = useState(false);
	const [graphViewOpen, setGraphViewOpen] = useState(false);
	const [workspaceMemPrefs, setWorkspaceMemPrefs] =
		useState<WorkspaceMemoryPreferences | null>(null);
	const [workspaceMemLoading, setWorkspaceMemLoading] = useState(false);
	const [configPath, setConfigPath] = useState<string>("");
	const [configData, setConfigData] = useState<Record<string, unknown> | null>(null);
	const [configLoading, setConfigLoading] = useState(false);


	useEffect(() => {
		if (!onGetMemoryStats) return;
		onGetMemoryStats()
			.then(setMemoryStats)
			.catch(() => {});
	}, [onGetMemoryStats]);

	const loadMemoryGraph = useCallback(async () => {
		if (!onGetMemoryGraph) return;
		setMemoryGraphLoading(true);
		try {
			const snapshot = await onGetMemoryGraph();
			setMemoryGraph(snapshot);
		} catch {
			setMemoryGraph(null);
		} finally {
			setMemoryGraphLoading(false);
		}
	}, [onGetMemoryGraph]);

	useEffect(() => {
		if (graphViewOpen) {
			void loadMemoryGraph();
		}
	}, [graphViewOpen, loadMemoryGraph]);

	useEffect(() => {
		if (!onGetWorkspaceMemoryPreferences) return;
		onGetWorkspaceMemoryPreferences()
			.then(setWorkspaceMemPrefs)
			.catch(() => {});
	}, [onGetWorkspaceMemoryPreferences]);

	const handleMemorySearch = useCallback(async () => {
		if (!onSearchMemories) return;
		setMemoryLoading(true);
		const results = await onSearchMemories(
			memorySearchQuery,
			memorySearchSemantic,
		);
		setMemoryResults(results);
		setMemoryLoading(false);
	}, [onSearchMemories, memorySearchQuery, memorySearchSemantic]);

	const handleMemoryList = useCallback(async () => {
		if (!onGetMemoryList) return;
		setMemoryLoading(true);
		const results = await onGetMemoryList(memoryScope, memoryTag || undefined);
		setMemoryResults(results);
		setMemoryLoading(false);
	}, [onGetMemoryList, memoryScope, memoryTag]);

	useEffect(() => {
		if (onGetMemoryList && !memorySearchQuery) {
			handleMemoryList();
		}
	}, [
		memoryScope,
		memoryTag,
		onGetMemoryList,
		handleMemoryList,
		memorySearchQuery,
	]);

	useEffect(() => {
		void invoke<VersionInfo>("get_version_info")
			.then(setVersionInfo)
			.catch(() => {});
	}, []);

	useEffect(() => {
		void invoke<AuthStatus>("get_auth_status")
			.then(setAuthStatus)
			.catch(() => {});
	}, []);

	useEffect(() => {
		invoke<string>("get_config_path")
			.then(setConfigPath)
			.catch(() => {});
		loadConfig();
	}, []);

	const loadConfig = useCallback(async () => {
		try {
			const cfg = await invoke<Record<string, unknown>>("get_config");
			setConfigData(cfg);
		} catch {
			/* ignore */
		}
	}, []);

	const toggleConfigFeature = useCallback(
		async (key: string, currentValue: boolean) => {
			setConfigLoading(true);
			try {
				await invoke("set_config_value", { key, value: !currentValue });
				await loadConfig();
			} catch {
				/* ignore */
			} finally {
				setConfigLoading(false);
			}
		},
		[loadConfig],
	);


	const copyToClipboard = useCallback(async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedText(label);
			setTimeout(() => setCopiedText(null), 2000);
		} catch {
			/* ignore */
		}
	}, []);

	return (
		<div className="flex flex-col min-w-0 min-h-0 flex-1 w-full bg-background overflow-x-hidden">
			<div className="flex items-center gap-2 md:gap-3 px-4 md:px-6 py-3 md:py-4 border-b border-border shrink-0">
				<div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
					<svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 md:w-4 md:h-4">
						<path d="M8 1.5c.35 0 .65.23.73.57l.5 2.19a.9.9 0 00.58.65l2.14.75c.42.15.6.62.44 1.05l-1 2.02a.9.9 0 00.08.86l1.33 1.96c.32.47.17 1.1-.33 1.37l-1.73 1a.9.9 0 01-.98-.27l-1.3-1.6a.9.9 0 00-.98-.27l-2.14.75a.9.9 0 01-1.05-.44l-1-2.02a.9.9 0 01.44-1.2l2.14-.75a.9.9 0 00.58-.65l.5-2.19A.75.75 0 018 1.5z" />
					</svg>
				</div>
				<div>								<h1 className="text-[13px] md:text-[15px] font-semibold text-foreground">
									Settings
								</h1>
								<p className="text-[11px] md:text-[12px] text-muted-foreground hidden sm:block">
						Appearance, authentication, memory, version info
					</p>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 min-w-0">
				<div className="p-4 md:p-6 max-w-xl mx-auto space-y-4 md:space-y-6">
					{/* Theme */}
					<SettingsCard
						icon={<Sun className="w-4 h-4" />}
						title="Theme"
						action={
							<div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-muted/30">
								<button
									type="button"
									onClick={() => onThemeChange("light")}
									className={cn(
										"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-150",
										theme === "light"
											? "bg-card text-foreground shadow-sm"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									<Sun className="w-3.5 h-3.5" /> Light
								</button>
								<button
									type="button"
									onClick={() => onThemeChange("dark")}
									className={cn(
										"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-150",
										theme === "dark"
											? "bg-card text-foreground shadow-sm"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									<Moon className="w-3.5 h-3.5" /> Dark
								</button>
							</div>
						}
					>
						<p className="text-[12px] text-muted-foreground">
							Switch between light and dark mode
						</p>
					</SettingsCard>

					{/* Auth */}
					<SettingsCard
						icon={<Key className="w-4 h-4" />}
						title="Authentication"
						action={
							<Badge
								variant={authStatus?.any_available ? "default" : "outline"}
								className="text-[10px]"
							>
								{authStatus?.any_available ? "Available" : "Not configured"}
							</Badge>
						}
					>
						<div className="text-[12px] text-muted-foreground mb-3">
							{authStatus?.any_available
								? "At least one provider is authenticated"
								: "No providers configured yet"}
						</div>
						{authStatus?.providers && authStatus.providers.length > 0 && (
							<div className="space-y-1.5">
								{authStatus.providers.map((p) => (
									<div
										key={p.id}
										className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2"
									>
										<div className="flex items-center gap-2">
											<span className="text-[13px] font-medium text-foreground">
												{p.display_name}
											</span>
											<Badge
												variant={p.configured ? "secondary" : "outline"}
												className="text-[9px] h-[18px]"
											>
												{p.configured ? "configured" : p.status}
											</Badge>
										</div>
										<span className="text-[11px] text-muted-foreground">
											{p.method}
										</span>
									</div>
								))}
							</div>
						)}
					</SettingsCard>

				{/* Memory */}
				{(onExportMemories || onImportMemories) && (
					<SettingsCard icon={<Brain className="w-4 h-4" />} title="Memory">
						<div className="space-y-3">
							{onExportMemories && (
								<div className="flex items-center gap-2 flex-wrap">
									<input
										type="text"
										value={exportPath}
										readOnly
										placeholder="Export path (e.g. ~/memories.json)"
										className="flex-1 h-8 px-3 rounded-lg bg-muted/30 border border-border text-[12px] md:text-[13px] text-foreground placeholder-muted-foreground outline-none focus:border-primary/50 min-w-0"
									/>
									<button
										type="button"
										onClick={async () => {
											try {
												const path = await save({
													filters: [{ name: "JSON", extensions: ["json"] }],
													defaultPath: "jflow-memories.json",
												});
												if (path) setExportPath(path);
											} catch {
												// ignore cancel
											}
										}}
										className="shrink-0 h-8 px-3 rounded-lg border border-border bg-background text-foreground text-[12px] font-medium hover:bg-muted transition-all flex items-center gap-1.5"
									>
										<FolderOpen className="w-3.5 h-3.5" />
										Browse
									</button>
									<button
										type="button"
										onClick={async () => {
											if (!exportPath.trim()) return;
											setMemoryAction({
												type: "export",
												status: "Exporting…",
											});
											try {
												await onExportMemories(exportPath.trim());
												setMemoryAction({
													type: "export",
													status: "Exported successfully",
												});
											} catch {
												setMemoryAction({
													type: "export",
													status: "Export failed",
												});
											}
											setTimeout(() => setMemoryAction(null), 3000);
										}}
										disabled={!exportPath.trim()}
										className="shrink-0 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
									>
										<Download className="w-3.5 h-3.5" />
										Export
									</button>
								</div>
							)}
							{onImportMemories && (
								<div className="flex items-center gap-2 flex-wrap">
									<input
										type="text"
										value={importPath}
										readOnly
										placeholder="Import path (e.g. ~/memories.json)"
										className="flex-1 h-8 px-3 rounded-lg bg-muted/30 border border-border text-[12px] md:text-[13px] text-foreground placeholder-muted-foreground outline-none focus:border-primary/50 min-w-0"
									/>
									<button
										type="button"
										onClick={async () => {
											try {
												const selected = await open({
													filters: [{ name: "JSON", extensions: ["json"] }],
													multiple: false,
												});
												if (selected && typeof selected === "string") {
													setImportPath(selected);
												}
											} catch {
												// ignore cancel
											}
										}}
										className="shrink-0 h-8 px-3 rounded-lg border border-border bg-background text-foreground text-[12px] font-medium hover:bg-muted transition-all flex items-center gap-1.5"
									>
										<FolderOpen className="w-3.5 h-3.5" />
										Browse
									</button>
									<button
										type="button"
										onClick={async () => {
											if (!importPath.trim()) return;
											setMemoryAction({
												type: "import",
												status: "Importing…",
											});
											try {
												const result = await onImportMemories(
													importPath.trim(),
												);
												setMemoryAction({
													type: "import",
													status: `Imported ${result.project_count} project + ${result.global_count} global memories`,
												});
											} catch {
												setMemoryAction({
													type: "import",
													status: "Import failed",
												});
											}
											setTimeout(() => setMemoryAction(null), 3000);
										}}
										disabled={!importPath.trim()}
										className="shrink-0 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
									>
										<Upload className="w-3.5 h-3.5" />
										Import
									</button>
								</div>
							)}
							{memoryAction && (
								<div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
									<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
									{memoryAction.status}
								</div>
							)}
						</div>
					</SettingsCard>
				)}

					{/* Memory Browser */}
					{(onSearchMemories || onGetMemoryList) && (
						<SettingsCard
							icon={<Database className="w-4 h-4" />}
							title="Memory Browser"
							action={
								memoryStats && (
									<div className="flex items-center gap-2">
										<Badge variant="secondary" className="text-[9px] h-[18px]">
											{memoryStats.total} total
										</Badge>
										<Badge variant="outline" className="text-[9px] h-[18px]">
											{memoryStats.unique_tags} tags
										</Badge>
									</div>
								)
							}
						>
							<div className="space-y-3">
								{/* Search bar */}
								<div className="flex items-center gap-2 flex-wrap">
									<div className="relative flex-1">
										<Search className="w-3.5 h-3.5 text-muted-foreground/40 absolute left-2.5 top-1/2 -translate-y-1/2" />
										<input
											type="text"
											value={memorySearchQuery}
											onChange={(e) => setMemorySearchQuery(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter") {
													e.preventDefault();
													handleMemorySearch();
												}
											}}
											placeholder="Search memories…"
											className="w-full h-8 pl-8 pr-3 rounded-lg bg-muted/30 border border-border text-[13px] text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
										/>
									</div>
									<button
										type="button"
										onClick={() => setMemorySearchSemantic((s) => !s)}
										className={cn(
											"h-8 px-2.5 rounded-lg text-[11px] font-medium transition-all border",
											memorySearchSemantic
												? "bg-primary/10 text-primary border-primary/30"
												: "bg-muted/30 text-muted-foreground border-border hover:text-foreground",
										)}
										title="Toggle semantic search"
									>
										Semantic
									</button>
									<button
										type="button"
										onClick={handleMemorySearch}
										disabled={memoryLoading || !memorySearchQuery.trim()}
										className="shrink-0 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 disabled:opacity-40 transition-all"
									>
										{memoryLoading ? "…" : "Search"}
									</button>
								</div>

								{/* Scope filter */}
								<div className="flex items-center gap-2 flex-wrap">
									{(["all", "project", "global"] as const).map((scope) => (
										<button
											key={scope}
											type="button"
											onClick={() => setMemoryScope(scope)}
											className={cn(
												"px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all capitalize",
												memoryScope === scope
													? "bg-primary/10 text-primary"
													: "text-muted-foreground hover:text-foreground hover:bg-muted",
											)}
										>
											{scope}
										</button>
									))}
									<div className="relative flex-1">
										<Tag className="w-3 h-3 text-muted-foreground/40 absolute left-2 top-1/2 -translate-y-1/2" />
										<input
											type="text"
											value={memoryTag}
											onChange={(e) => setMemoryTag(e.target.value)}
											placeholder="Filter by tag"
											className="w-full h-7 pl-6 pr-2 rounded-lg bg-muted/30 border border-border text-[12px] text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
										/>
									</div>
								</div>

								{/* Stats */}
								{memoryStats && (
									<div className="flex items-center gap-3 py-1 flex-wrap">
										<StatPill
											label="Project"
											value={memoryStats.project_count}
										/>
										<StatPill label="Global" value={memoryStats.global_count} />
										{Object.entries(memoryStats.categories).map(
											([cat, count]) => (
												<StatPill key={cat} label={cat} value={count} />
											),
										)}
									</div>
								)}

								{/* Results */}
								<div className="max-h-[320px] overflow-y-auto space-y-1.5 pr-1">
									{memoryLoading && memoryResults.length === 0 && (
										<div className="flex items-center justify-center py-8 text-muted-foreground text-[13px]">
											<BarChart3 className="w-4 h-4 animate-pulse mr-2" />
											Loading…
										</div>
									)}
									{!memoryLoading && memoryResults.length === 0 && (
										<div className="text-center py-6 text-muted-foreground text-[13px]">
											No memories found
										</div>
									)}
									{memoryResults.map((m) => {
										const isExpanded = expandedMemoryId === m.id;
										return (
											<div
												key={m.id}
												className="rounded-lg border border-border bg-muted/20 overflow-hidden"
											>
												<button
													type="button"
													onClick={() =>
														setExpandedMemoryId((prev) =>
															prev === m.id ? null : m.id,
														)
													}
													className="w-full text-left px-3 py-2 flex items-start gap-2"
												>
													<div className="flex-1 min-w-0">
														<div className="flex items-center gap-2 mb-0.5">
															<span className="text-[12px] font-medium text-foreground truncate">
																{m.content.slice(0, 80)}
																{m.content.length > 80 && "…"}
															</span>
														</div>
														<div className="flex items-center gap-1.5 flex-wrap">
															<Badge
																variant="outline"
																className="text-[9px] h-[16px] capitalize"
															>
																{m.category}
															</Badge>
															{m.tags.slice(0, 3).map((tag) => (
																<Badge
																	key={tag}
																	variant="secondary"
																	className="text-[9px] h-[16px]"
																>
																	{tag}
																</Badge>
															))}
															{m.score !== undefined && (
																<span className="text-[10px] text-muted-foreground ml-auto">
																	score: {m.score.toFixed(3)}
																</span>
															)}
														</div>
													</div>
													{isExpanded ? (
														<X className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
													) : (
														<Search className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
													)}
												</button>
												{isExpanded && (
													<div className="px-3 pb-3 pt-1 border-t border-border/50">
														<p className="text-[12px] text-foreground whitespace-pre-wrap leading-relaxed">
															{m.content}
														</p>
														<div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
															<span>
																Trust: {m.trust} | Strength: {m.strength}
															</span>
															<span className="ml-auto">
																{new Date(m.updated_at).toLocaleDateString()}
															</span>
														</div>
													</div>
												)}
											</div>
										);
									})}
								</div>

								{/* Graph view toggle */}
								{onGetMemoryGraph && (
									<div className="pt-2 border-t border-border">
										<button
											type="button"
											onClick={() => setGraphViewOpen((v) => !v)}
											className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
										>
											{graphViewOpen ? (
												<ChevronDown className="w-3.5 h-3.5" />
											) : (
												<ChevronRight className="w-3.5 h-3.5" />
											)}
											<Network className="w-3.5 h-3.5" />
											<span>Graph view</span>
											{memoryGraph && (
												<Badge
													variant="outline"
													className="text-[9px] h-[16px] ml-1"
												>
													{memoryGraph.nodes.length} nodes
												</Badge>
											)}
										</button>
										{graphViewOpen && (
											<div className="mt-3">
												<MemoryGraph
													nodes={memoryGraph?.nodes ?? []}
													edges={memoryGraph?.edges ?? []}
													loading={memoryGraphLoading}
												/>
											</div>
										)}
									</div>
								)}
							</div>
						</SettingsCard>
					)}

					{/* Workspace Memory Preferences */}
					{onGetWorkspaceMemoryPreferences && (
						<SettingsCard
							icon={<FolderOpen className="w-4 h-4" />}
							title="Workspace Memory"
						>
							<div className="space-y-3">
								<div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
									<span className="text-[13px] text-foreground">
										Default enabled
									</span>
									<button
										type="button"
										onClick={async () => {
											if (!workspaceMemPrefs || !onSetWorkspaceMemoryPreference)
												return;
											setWorkspaceMemLoading(true);
											await onSetWorkspaceMemoryPreference(
												null,
												!workspaceMemPrefs.default_enabled,
											);
											const updated = await onGetWorkspaceMemoryPreferences();
											if (updated) setWorkspaceMemPrefs(updated);
											setWorkspaceMemLoading(false);
										}}
										disabled={workspaceMemLoading}
										className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
									>
										{workspaceMemPrefs?.default_enabled ? (
											<ToggleRight className="w-5 h-5 text-primary" />
										) : (
											<ToggleLeft className="w-5 h-5" />
										)}
									</button>
								</div>
								{workspaceMemPrefs &&
									Object.keys(workspaceMemPrefs.workspaces).length > 0 && (
										<div className="space-y-1">
											{Object.entries(workspaceMemPrefs.workspaces).map(
												([wd, enabled]) => (
													<div
														key={wd}
														className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2"
													>
														<span className="text-[12px] text-foreground truncate max-w-[200px]">
															{wd.split("/").pop() || wd}
														</span>
														<button
															type="button"
															onClick={async () => {
																if (
																	!onSetWorkspaceMemoryPreference ||
																	!onGetWorkspaceMemoryPreferences
																)
																	return;
																setWorkspaceMemLoading(true);
																await onSetWorkspaceMemoryPreference(
																	wd,
																	!enabled,
																);
																const updated =
																	await onGetWorkspaceMemoryPreferences();
																if (updated) setWorkspaceMemPrefs(updated);
																setWorkspaceMemLoading(false);
															}}
															disabled={workspaceMemLoading}
															className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
														>
															{enabled ? (
																<ToggleRight className="w-4 h-4 text-primary" />
													) : (
														<ToggleLeft className="w-4 h-4" />
													)}
												</button>
											</div>
										),
									)}
								</div>
							)}
						</div>
					</SettingsCard>
				)}

				{onSetModel && (
					<SettingsCard
						icon={<Bot className="w-4 h-4" />}
						title="Default Model"
						action={
							<button
								type="button"
								onClick={() => setModelPickerOpen(true)}
								className="text-[11px] px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
							>
								Change
							</button>
						}
					>
						<div className="flex items-center justify-between">
							<div className="min-w-0">
								<div className="text-[13px] font-medium text-foreground truncate">
									{currentModel || "No model selected"}
								</div>
								{currentProfileId && (
									<div className="text-[11px] text-muted-foreground truncate">
										Profile: {currentProfileId}
									</div>
								)}
							</div>
						</div>
					</SettingsCard>
				)}

				<ModelPickerModal
					open={modelPickerOpen}
					onClose={() => setModelPickerOpen(false)}
					availableModels={availableModels || []}
					currentModel={currentModel || null}
					currentProfileId={currentProfileId || null}
					onSelectModel={(m, pid) => {
						setModelPickerOpen(false);
						onSetModel?.(m, pid);
					}}
				/>


				{/* Config */}
				<SettingsCard
					icon={<Database className="w-4 h-4" />}
					title="Config"
				>
					<div className="space-y-3">
						{configPath && (
							<div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
								<span className="text-[12px] text-muted-foreground truncate max-w-[300px]">
									{configPath}
								</span>
								<button
									type="button"
									onClick={() => copyToClipboard(configPath, "config-path")}
									className="text-[11px] px-2 py-0.5 rounded-md bg-muted/50 text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2"
								>
									{copiedText === "config-path" ? "Copied ✓" : "Copy path"}
								</button>
							</div>
						)}
						{configData && (
							<div className="space-y-1">
								{([
									["features.memory", "Memory"],
									["features.swarm", "Swarm"],
									["features.message_timestamps", "Timestamps"],
									["features.persist_memory_injections", "Persist memory injections"],
								] as const).map(([key, label]) => {
									const parts = key.split(".");
									let val: unknown = configData;
									for (const p of parts) {
										if (val && typeof val === "object") {
											val = (val as Record<string, unknown>)[p];
										} else {
											val = undefined;
											break;
										}
									}
									const enabled = Boolean(val);
									return (
										<div
											key={key}
											className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2"
										>
											<span className="text-[12px] text-foreground">{label}</span>
											<button
												type="button"
												onClick={() => toggleConfigFeature(key, enabled)}
												disabled={configLoading}
												className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
											>
												{enabled ? (
													<ToggleRight className="w-5 h-5 text-primary" />
												) : (
													<ToggleLeft className="w-5 h-5" />
												)}
											</button>
										</div>
									);
								})}
							</div>
						)}
					</div>
				</SettingsCard>

				{/* Environment variables */}
				<SettingsCard icon={<FileKey className="w-4 h-4" />} title="Environment variables">
					<EnvVariablesCard />
				</SettingsCard>

				{/* Version */}
				<SettingsCard icon={<Cpu className="w-4 h-4" />} title="Version">
					{versionInfo ? (
							<div className="space-y-1.5">
								{(
									[
										["Version", versionInfo.version],
										["Semver", versionInfo.semver],
										["Git Hash", versionInfo.git_hash],
										["Git Tag", versionInfo.git_tag],
										["Git Date", versionInfo.git_date],
										["Build", versionInfo.release_build ? "Release" : "Debug"],
									] as const
								).map(([label, value]) => (
									<div
										key={label}
										className="flex items-center justify-between py-0.5"
									>
										<span className="text-[12px] text-muted-foreground">
											{label}
										</span>
										<button
											type="button"
											onClick={() => copyToClipboard(value, label)}
											className={cn(
												"font-mono text-[12px] px-2 py-0.5 rounded-md hover:bg-muted transition-colors",
												copiedText === label
													? "text-emerald-500"
													: "text-foreground",
											)}
										>
											{value}
											{copiedText === label && (
												<span className="ml-1.5 text-emerald-500">✓</span>
											)}
										</button>
									</div>
								))}
							</div>
						) : (
							<div className="text-[13px] text-muted-foreground animate-pulse">
								Loading…
							</div>
						)}
					</SettingsCard>

					<div className="h-8" />
				</div>
			</div>
		</div>
	);
}

function SettingsCard({
	icon,
	title,
	action,
	children,
}: {
	icon: React.ReactNode;
	title: string;
	action?: React.ReactNode;
	children?: React.ReactNode;
}) {
	return (
		<div className="rounded-xl border border-border bg-card overflow-hidden">
			<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
				<div className="flex items-center gap-2.5">
					<span className="text-muted-foreground shrink-0">{icon}</span>
					<h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
				</div>
				{action}
			</div>
			{children && <div className="px-4 py-3">{children}</div>}
		</div>
	);
}

function StatPill({ label, value }: { label: string; value: number }) {
	return (
		<div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 text-[11px]">
			<span className="text-muted-foreground capitalize">{label}</span>
			<span className="font-semibold text-foreground">{value}</span>
		</div>
	);
}
