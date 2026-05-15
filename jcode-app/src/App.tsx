import { invoke } from "@tauri-apps/api/core";
import { useJcodeSession } from "@/hooks/useJcodeSession";
import { ChatView } from "@/components/ChatView";
import { SessionSidebar } from "@/components/SessionSidebar";
import { ModelSelector } from "@/components/ModelSelector";
import { StdinInputModal } from "@/components/StdinInputModal";
import { SessionSwitcherDialog } from "@/components/SessionSwitcherDialog";
import { ActivityPanel } from "@/components/ActivityPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/hooks/useTheme";
import type { SessionInfo } from "@/types";
import {
	FolderOpen,
	Zap,
	ZapOff,
	Loader2,
	AlertCircle,
	Search,
	Brain,
	Wrench,
	Sun,
	Moon,
} from "lucide-react";

export default function App() {
	const {
		state,
		connect,
		createRoleSession,
		resumeSession,
		switchSession,
		sendMessage,
		cancel,
		sendSoftInterrupt,
		setModel,
		listSessions,
		sendStdinResponse,
		setWorkingDir,
		clearChat,
		rewindChat,
		setReasoningEffort,
		setMemoryEnabled,
		compactContext,
		deleteSession,
		deleteWorkspaceSessions,
		setActiveWorkspace,
		toggleWorkspace,
		setWorkspaceMode,
		exportMemories,
		importMemories,
		listBackgroundTasks,
		cancelBackgroundTask,
		runAuthDoctor,
		getPermissionRequests,
		respondToPermission,
		triggerAmbient,
		stopAmbient,
		addProviderProfile,
		sendTranscript,
		getBrowserStatus,
		setupBrowser,
		runDictation,
		saveSessionState,
		getLastSessionState,
		setError,
	} = useJcodeSession();
	const { toggleTheme, effectiveTheme } = useTheme();
	const [preferredModel, setPreferredModel] = useState("");
	const [preferredProfileId, setPreferredProfileId] = useState<
		string | undefined
	>();
	const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
	const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
		null,
	);
	const [workspaceMemoryPrefs, setWorkspaceMemoryPrefs] = useState<
		Record<string, boolean>
	>({});
	const [defaultWorkspaceMemoryEnabled, setDefaultWorkspaceMemoryEnabled] =
		useState(true);

	const hasPolledOnConnect = useRef(false);
	useEffect(() => {
		if (state.connected && !hasPolledOnConnect.current) {
			hasPolledOnConnect.current = true;
			listSessions();
		}
		if (!state.connected) {
			hasPolledOnConnect.current = false;
		}
	}, [state.connected, listSessions]);

	// Restore last session on startup
	const hasRestored = useRef(false);
	useEffect(() => {
		if (hasRestored.current) return;
		hasRestored.current = true;
		void (async () => {
			const saved = await getLastSessionState();
			if (!saved) return;
			const sessionId = (saved as { session_id?: string }).session_id;
			const workingDir =
				(saved as { working_dir?: string | null }).working_dir ?? null;
			if (!sessionId) return;
			const confirmed = window.confirm(
				`Resume previous session "${sessionId.slice(-8)}"?`,
			);
			if (confirmed) {
				setActiveWorkspace(workingDir || "default");
				setWorkingDir(workingDir);
				await resumeSession(sessionId, workingDir);
				await listSessions();
			}
		})();
	}, [
		getLastSessionState,
		resumeSession,
		listSessions,
		setActiveWorkspace,
		setWorkingDir,
	]);

	// Save session state when active session changes
	useEffect(() => {
		if (state.sessionId) {
			void saveSessionState(state.sessionId, state.workingDir);
		}
	}, [state.sessionId, state.workingDir, saveSessionState]);

	useEffect(() => {
		const loadMemoryPreferences = async () => {
			try {
				const prefs = await invoke<{
					default_enabled: boolean;
					workspaces: Record<string, boolean>;
				}>("get_workspace_memory_preferences");
				setDefaultWorkspaceMemoryEnabled(prefs.default_enabled);
				setWorkspaceMemoryPrefs(prefs.workspaces || {});
			} catch {
				// ignore; UI will fall back to in-memory defaults
			}
		};
		void loadMemoryPreferences();
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const tagName = target?.tagName;
			const isEditable =
				target?.isContentEditable ||
				tagName === "INPUT" ||
				tagName === "TEXTAREA" ||
				tagName === "SELECT";

			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
				event.preventDefault();
				if (!sessionSwitcherOpen) {
					listSessions();
				}
				setSessionSwitcherOpen((open) => !open);
				return;
			}

			if (isEditable) return;
			if (
				event.key === "/" &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey
			) {
				event.preventDefault();
				listSessions();
				setSessionSwitcherOpen(true);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [listSessions, sessionSwitcherOpen]);

	const pickWorkspace = async () => {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const selected = await open({
				directory: true,
				multiple: false,
				title: "Select workspace folder",
			});
			if (selected)
				setWorkingDir(typeof selected === "string" ? selected : selected[0]);
		} catch {
			// Dialog cancelled or unavailable — no action needed
		}
	};

	const handleCreateWorkspace = () => {
		pickWorkspace();
	};

	const handleCreateSession = async (workspaceId: string) => {
		const workingDir = workspaceId === "default" ? null : workspaceId;
		setActiveWorkspace(workspaceId);
		setWorkingDir(workingDir);
		await connect(
			workingDir,
			preferredModel || undefined,
			workspaceId === "default"
				? defaultWorkspaceMemoryEnabled
				: (workspaceMemoryPrefs[workspaceId] ?? defaultWorkspaceMemoryEnabled),
		);
		await listSessions();
	};

	const handleCreateRole = async (workspaceId: string) => {
		const roleName = window.prompt(
			"Enter character name (e.g., 'Coder', 'Reviewer'):",
		);
		if (!roleName || !roleName.trim()) return;
		const model = window.prompt("Model (optional, leave empty for default):");
		const workingDir = workspaceId === "default" ? null : workspaceId;
		setActiveWorkspace(workspaceId);
		setWorkingDir(workingDir);
		await createRoleSession(
			workingDir,
			roleName.trim(),
			model?.trim() || preferredModel || undefined,
			workspaceId === "default"
				? defaultWorkspaceMemoryEnabled
				: (workspaceMemoryPrefs[workspaceId] ?? defaultWorkspaceMemoryEnabled),
		);
		await listSessions();
	};

	const handleToggleSlackMode = (workspaceId: string) => {
		const nextMode =
			state.workspaceModes[workspaceId] === "slack" ? "normal" : "slack";
		if (nextMode === "slack") {
			// 合并该 workspace 下所有 session 的历史消息，按时间戳地回填到虚拟 session
			const wsSessionInfos = state.sessions.filter(
				(s) => (s.workingDir || "default") === workspaceId,
			);
			const merged: import("@/types").ChatMessage[] = [];
			for (const sessionInfo of wsSessionInfos) {
				const sessionData = state.sessionData[sessionInfo.sessionId];
				if (!sessionData?.messages) continue;
				for (const msg of sessionData.messages) {
					merged.push({
						...msg,
						// 不覆盖已有的 roleName，对没有的添加对应 session 的 roleName
						roleName: msg.roleName ?? sessionInfo.roleName ?? undefined,
						roleSessionId: msg.roleSessionId ?? sessionInfo.sessionId,
					});
				}
			}
			// 按时间戳排序（无时间戳的大于 0）
			merged.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
			setWorkspaceMode(workspaceId, "slack", merged);
		} else {
			setWorkspaceMode(workspaceId, "normal");
		}
	};

	const handleRenameSession = async (sessionId: string, newTitle: string) => {
		try {
			await invoke("rename_session", {
				sessionId,
				title: newTitle,
			});
			await listSessions();
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error("Failed to rename session:", err);
		}
	};

	const handleDeleteSession = async (session: SessionInfo) => {
		const confirmed = window.confirm(
			`Delete session "${session.title}"? This cannot be undone.`,
		);
		if (!confirmed) return;
		await deleteSession(session.sessionId);
	};

	const handleDeleteWorkspace = async (workspaceId: string) => {
		const label = workspaceId === "default" ? "Default" : workspaceId;
		const confirmed = window.confirm(
			`Delete all sessions in workspace "${label}"? This cannot be undone.`,
		);
		if (!confirmed) return;
		await deleteWorkspaceSessions(
			workspaceId === "default" ? null : workspaceId,
		);
	};

	const currentWorkspaceKey =
		state.workingDir || state.activeWorkspaceId || "default";
	const effectiveMemoryEnabled = state.connected
		? state.memoryEnabled
		: (workspaceMemoryPrefs[currentWorkspaceKey] ??
			defaultWorkspaceMemoryEnabled);

	// Slack mode state
	const isSlackMode = state.workspaceModes[currentWorkspaceKey] === "slack";
	const workspaceSessions = state.sessions.filter(
		(s) => (s.workingDir || "default") === currentWorkspaceKey,
	);
	const workspaceRoleNames = workspaceSessions
		.map((s) => s.roleName)
		.filter(Boolean) as string[];
	const virtualSessionId = `workspace:${currentWorkspaceKey}`;
	const slackMessages = isSlackMode
		? (state.sessionData[virtualSessionId]?.messages ?? [])
		: [];
	const slackIsProcessing = isSlackMode
		? workspaceSessions.some(
				(s) => state.sessionData[s.sessionId]?.isProcessing,
			) ||
			(state.sessionData[virtualSessionId]?.isProcessing ?? false)
		: false;
	// Slack 模式：哪些角色正在生成回复（用于骨架屏）
	const respondingRoles = isSlackMode
		? workspaceSessions
				.filter((s) => state.sessionData[s.sessionId]?.isProcessing)
				.map((s) => s.roleName)
				.filter((r): r is string => Boolean(r))
		: [];
	// roleName → model 映射（用于 mention 下拉和模型切换）
	const roleModels: Record<string, string> = {};
	for (const s of workspaceSessions) {
		if (s.roleName && s.model) {
			roleModels[s.roleName] = s.model;
		}
	}
	const visibleConversationCount = (
		isSlackMode ? slackMessages : state.messages
	).filter(
		(message) => message.role === "user" || message.role === "assistant",
	).length;

	const findSessionIdByRoleName = (roleName: string): string | undefined => {
		return workspaceSessions.find((s) => s.roleName === roleName)?.sessionId;
	};

	const getDefaultRoleSessionId = (): string | undefined => {
		// Prefer the currently active session if it belongs to this workspace and has a role name
		if (state.sessionId) {
			const active = workspaceSessions.find(
				(s) => s.sessionId === state.sessionId,
			);
			if (active?.roleName) return active.sessionId;
		}
		// Fall back to the first role in the workspace
		return (
			workspaceSessions.find((s) => s.roleName)?.sessionId ||
			workspaceSessions[0]?.sessionId
		);
	};

	const updateWorkspaceMemoryPreference = async (
		workspaceKey: string,
		enabled: boolean,
	) => {
		if (workspaceKey === "default") {
			setDefaultWorkspaceMemoryEnabled(enabled);
		} else {
			setWorkspaceMemoryPrefs((current) => ({
				...current,
				[workspaceKey]: enabled,
			}));
		}
		try {
			await invoke("set_workspace_memory_preference", {
				workingDir: workspaceKey === "default" ? null : workspaceKey,
				enabled,
			});
		} catch {
			// keep optimistic UI state; session toggle still applies immediately
		}
	};

	const handleSetMemoryEnabled = async (enabled: boolean) => {
		await updateWorkspaceMemoryPreference(currentWorkspaceKey, enabled);
		if (state.connected) {
			await setMemoryEnabled(enabled, state.sessionId || undefined);
		}
	};

	// 自动连接：用户发送第一条消息时若未连接，先创建会话再发送
	const pendingAutoSend = useRef<{
		content: string;
		images?: [string, string][];
	} | null>(null);
	useEffect(() => {
		if (state.connected && state.sessionId && pendingAutoSend.current) {
			const { content, images } = pendingAutoSend.current;
			pendingAutoSend.current = null;
			sendMessage(content, images, state.sessionId);
		}
	}, [state.connected, state.sessionId]);

	const handleResume = (session: SessionInfo) => {
		setActiveWorkspace(session.workingDir || "default");
		setWorkingDir(session.workingDir || null);
		setSessionSwitcherOpen(false);
		// If session is already active, just switch view without re-invoking backend
		if (state.sessionId === session.sessionId) {
			return;
		}
		// Check if session is already connected in our state
		const sessionData = state.sessionData[session.sessionId];
		if (sessionData?.connectionPhase === "connected") {
			switchSession(session.sessionId);
		} else {
			resumeSession(session.sessionId, session.workingDir || null);
		}
	};

	const openSessionSwitcher = () => {
		listSessions();
		setSessionSwitcherOpen(true);
	};

	return (
		<div className="flex flex-col h-screen bg-background">
			{state.stdinPrompt && (
				<StdinInputModal
					prompt={state.stdinPrompt}
					onSubmit={(requestId, input) =>
						sendStdinResponse(requestId, input, state.sessionId || undefined)
					}
				/>
			)}
			<SessionSwitcherDialog
				open={sessionSwitcherOpen}
				sessions={state.sessions}
				activeSessionId={state.sessionId}
				onOpenChange={setSessionSwitcherOpen}
				onSelectSession={handleResume}
			/>

			<header className="flex items-center justify-between px-4 py-2 bg-card border-b min-h-12 gap-3">
				<div className="flex items-center gap-3">
					{state.connected && (
						<Badge variant="default" className="h-5 text-[10px] gap-1">
							<Zap className="w-2.5 h-2.5" />
							connected
						</Badge>
					)}
					{state.connecting && (
						<Badge variant="secondary" className="h-5 text-[10px] gap-1">
							<Loader2 className="w-2.5 h-2.5 animate-spin" />
							connecting
						</Badge>
					)}
					{!state.connected && !state.connecting && (
						<Badge variant="outline" className="h-5 text-[10px] gap-1">
							<ZapOff className="w-2.5 h-2.5" />
							disconnected
						</Badge>
					)}
					{state.workingDir && (
						<span
							className="text-[11px] text-muted-foreground font-mono bg-secondary px-2 py-0.5 rounded truncate max-w-[220px]"
							title={state.workingDir}
						>
							{state.workingDir.length > 30
								? "..." + state.workingDir.slice(-27)
								: state.workingDir}
						</span>
					)}
				</div>

				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={pickWorkspace}
						className="gap-1.5 h-8 text-xs"
					>
						<FolderOpen className="w-3.5 h-3.5" />
						{state.workingDir ? "Change" : "Select Workspace"}
					</Button>
					<Button
						variant={effectiveMemoryEnabled ? "secondary" : "outline"}
						size="sm"
						onClick={() => void handleSetMemoryEnabled(!effectiveMemoryEnabled)}
						className="h-8 text-xs gap-1.5"
					>
						<Brain className="w-3.5 h-3.5" />
						Memory default {effectiveMemoryEnabled ? "on" : "off"}
					</Button>
					<ModelSelector
						currentModel={state.providerModel || preferredModel || null}
						currentProvider={state.providerName || preferredProfileId || null}
						onSelectModel={(model, profileId) => {
							setPreferredModel(model);
							setPreferredProfileId(profileId);
							if (state.sessionId) {
								setModel(model, profileId, state.sessionId);
							}
						}}
						disabled={false}
					/>
					{(state.providerName || preferredProfileId) && (
						<Badge variant="outline" className="h-5 text-[10px] gap-1">
							<Brain className="w-2.5 h-2.5" />
							{state.providerName ||
								(preferredProfileId
									? preferredProfileId[0].toUpperCase() +
										preferredProfileId.slice(1)
									: "")}
						</Badge>
					)}
					{state.availableModelRoutes.length > 0 && (
						<Badge variant="secondary" className="h-5 text-[10px]">
							{state.availableModelRoutes.length} routes
						</Badge>
					)}
					{state.isProcessing && (
						<Badge variant="default" className="h-5 text-[10px] gap-1">
							<Wrench className="w-2.5 h-2.5" />
							running
						</Badge>
					)}
				</div>

				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						onClick={toggleTheme}
						title={
							effectiveTheme === "dark" ? "Switch to light" : "Switch to dark"
						}
					>
						{effectiveTheme === "dark" ? (
							<Sun className="w-4 h-4" />
						) : (
							<Moon className="w-4 h-4" />
						)}
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-8 text-xs gap-1.5"
						onClick={openSessionSwitcher}
					>
						<Search className="w-3.5 h-3.5" />
						Sessions
					</Button>
					{state.totalTokens && (
						<span className="text-[10px] text-muted-foreground font-mono">
							↑{state.totalTokens[0]} ↓{state.totalTokens[1]}
						</span>
					)}
					{state.error && (
						<Badge
							variant="destructive"
							className="h-5 text-[10px] gap-1 max-w-[200px] truncate"
							title={state.error}
						>
							<AlertCircle className="w-2.5 h-2.5" />
							{state.error.length > 30
								? state.error.slice(0, 30) + "..."
								: state.error}
						</Badge>
					)}
				</div>
			</header>

			<div className="flex flex-1 overflow-hidden">
				<SessionSidebar
					sessions={state.sessions}
					activeSessionId={state.sessionId}
					expandedWorkspaces={state.expandedWorkspaces}
					activeWorkspaceId={state.activeWorkspaceId}
					activeMessages={state.messages}
					activeError={state.error}
					isProcessing={state.isProcessing}
					queuedDraftCount={state.queuedDrafts.length}
					stdinPromptActive={Boolean(state.stdinPrompt)}
					availableRouteCount={state.availableModelRoutes.length}
					workspaceModes={state.workspaceModes}
					onSelectSession={handleResume}
					onRefresh={listSessions}
					onToggleWorkspace={toggleWorkspace}
					onSelectWorkspace={(id) => {
						setActiveWorkspace(id);
						setWorkingDir(id === "default" ? null : id);
					}}
					onCreateWorkspace={handleCreateWorkspace}
					onCreateSession={handleCreateSession}
					onCreateRole={handleCreateRole}
					onToggleSlackMode={handleToggleSlackMode}
					onRenameSession={handleRenameSession}
					onDeleteSession={(session) => {
						void handleDeleteSession(session);
					}}
					onDeleteWorkspace={(workspaceId) => {
						void handleDeleteWorkspace(workspaceId);
					}}
				/>
				<Separator orientation="vertical" />
				<ChatView
					messages={isSlackMode ? slackMessages : state.messages}
					isProcessing={isSlackMode ? slackIsProcessing : state.isProcessing}
					isSlackMode={isSlackMode}
					respondingRoles={respondingRoles}
					reasoningEffort={state.reasoningEffort}
					memoryEnabled={effectiveMemoryEnabled}
					connectionType={state.connectionType}
					statusDetail={state.statusDetail}
					queuedDraftCount={state.queuedDrafts.length}
					stdinPromptActive={Boolean(state.stdinPrompt)}
					selectedMessageId={selectedMessageId}
					availableRoles={workspaceRoleNames}
					roleModels={roleModels}
					onSend={(content, images, targetRole) => {
						if (isSlackMode) {
							const targetSessionId = targetRole
								? findSessionIdByRoleName(targetRole)
								: getDefaultRoleSessionId();
							if (!targetSessionId) {
								setError(
									"No target session found. Create a role session first.",
								);
								return;
							}
							// 如果 preferredModel 有值且目标角色模型不同，先切换
							void (async () => {
								const targetSession = workspaceSessions.find(
									(s) => s.sessionId === targetSessionId,
								);
								if (preferredModel && targetSession?.model !== preferredModel) {
									await setModel(preferredModel, undefined, targetSessionId);
								}
								sendMessage(content, images, targetSessionId);
							})();
						} else {
							// 普通模式：没有会话时自动创建
							if (!state.connected && !state.connecting) {
								pendingAutoSend.current = { content, images };
								void connect(
									state.workingDir,
									preferredModel || undefined,
									effectiveMemoryEnabled,
									undefined,
									preferredProfileId || undefined,
								);
								return;
							}
							sendMessage(content, images, state.sessionId || undefined);
						}
					}}
					onQueueSend={(content, images, targetRole) => {
						if (isSlackMode) {
							const targetSessionId = targetRole
								? findSessionIdByRoleName(targetRole)
								: getDefaultRoleSessionId();
							if (!targetSessionId) {
								setError(
									"No target session found. Create a role session first.",
								);
								return;
							}
							void (async () => {
								const targetSession = workspaceSessions.find(
									(s) => s.sessionId === targetSessionId,
								);
								if (preferredModel && targetSession?.model !== preferredModel) {
									await setModel(preferredModel, undefined, targetSessionId);
								}
								sendMessage(content, images, targetSessionId);
							})();
						} else {
							// 普通模式：没有会话时自动创建
							if (!state.connected && !state.connecting) {
								pendingAutoSend.current = { content, images };
								void connect(
									state.workingDir,
									preferredModel || undefined,
									effectiveMemoryEnabled,
									undefined,
									preferredProfileId || undefined,
								);
								return;
							}
							sendMessage(content, images, state.sessionId || undefined);
						}
					}}
					onCancel={() => {
						if (isSlackMode) {
							// Slack 模式：取消 workspace 内所有正在处理的 session
							workspaceSessions
								.filter((s) => state.sessionData[s.sessionId]?.isProcessing)
								.forEach((s) => void cancel(s.sessionId));
						} else {
							void cancel(state.sessionId || undefined);
						}
					}}
					onSoftInterrupt={(content) => {
						if (isSlackMode) {
							workspaceSessions
								.filter((s) => state.sessionData[s.sessionId]?.isProcessing)
								.forEach((s) => void sendSoftInterrupt(content, s.sessionId));
						} else {
							void sendSoftInterrupt(content, state.sessionId || undefined);
						}
					}}
					onClearChat={() => clearChat(state.sessionId || undefined)}
					onRewindChat={() => {
						if (visibleConversationCount > 0) {
							rewindChat(
								visibleConversationCount,
								state.sessionId || undefined,
							);
						}
					}}
					onSetReasoningEffort={(effort) =>
						setReasoningEffort(effort, state.sessionId || undefined)
					}
					onSetMemoryEnabled={handleSetMemoryEnabled}
					onCompactContext={() => compactContext(state.sessionId || undefined)}
					onDictate={runDictation}
				/>
				<Separator orientation="vertical" className="hidden xl:flex" />
				<ActivityPanel
					messages={state.messages}
					isProcessing={state.isProcessing}
					queuedDraftCount={state.queuedDrafts.length}
					stdinPrompt={state.stdinPrompt}
					providerName={state.providerName}
					providerModel={state.providerModel}
					availableModels={state.availableModels}
					availableModelRoutes={state.availableModelRoutes}
					sessionId={state.sessionId}
					reasoningEffort={state.reasoningEffort}
					connectionType={state.connectionType}
					statusDetail={state.statusDetail}
					totalTokens={state.totalTokens}
					sessions={state.sessions}
					activeWorkspaceId={state.activeWorkspaceId}
					activeSessionId={state.sessionId}
					onSelectSession={(sessionId) => {
						const session = state.sessions.find(
							(item) => item.sessionId === sessionId,
						);
						if (session) handleResume(session);
					}}
					selectedMessageId={selectedMessageId}
					onSelectMessage={setSelectedMessageId}
					exportMemories={exportMemories}
					importMemories={importMemories}
					listBackgroundTasks={listBackgroundTasks}
					cancelBackgroundTask={cancelBackgroundTask}
					runAuthDoctor={runAuthDoctor}
					getPermissionRequests={getPermissionRequests}
					respondToPermission={respondToPermission}
					triggerAmbient={triggerAmbient}
					stopAmbient={stopAmbient}
					addProviderProfile={addProviderProfile}
					sendTranscript={sendTranscript}
					getBrowserStatus={getBrowserStatus}
					setupBrowser={setupBrowser}
				/>
			</div>
		</div>
	);
}
