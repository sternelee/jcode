import { useJcodeSession } from "@/hooks/useJcodeSession";
import { NavBar } from "@/components/NavBar";
import { ConversationsList } from "@/components/ConversationsList";
import { ChatArea } from "@/components/ChatArea";
import { CreateSessionDialog } from "@/components/CreateSessionDialog";
import { StdinInputModal } from "@/components/StdinInputModal";
import { SessionSwitcherDialog } from "@/components/SessionSwitcherDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsPage } from "@/components/SettingsPage";
import { ProviderConfigPage } from "@/components/ProviderConfigPage";
import { parseSlashCommand } from "@/components/SlashCommands";
import { useTheme } from "@/hooks/useTheme";
import type { SessionInfo } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect, useRef, useMemo } from "react";

const DEFAULT_WORKSPACE_ID = "default";

function workspaceIdFromDir(workingDir?: string | null): string {
	return workingDir || DEFAULT_WORKSPACE_ID;
}

function workingDirFromWorkspaceId(workspaceId: string): string | null {
	return workspaceId === DEFAULT_WORKSPACE_ID ? null : workspaceId;
}

function workspaceLabel(workspaceId: string): string {
	if (workspaceId === DEFAULT_WORKSPACE_ID) return "Default";
	return workspaceId.split("/").pop() || workspaceId;
}




export default function App() {
	const {
		state,
		connect,
		resumeSession,
		switchSession,
		sendMessage,
		cancel,
		listSessions,
		sendStdinResponse,
		setWorkingDir,
		setActiveWorkspace,
		saveSessionState,
		getLastSessionState,
		setWorkspaceMode,
		loadWorkspaceThreadHistory,
		deleteSession,
		setModel,
		setReasoningEffort,
		setMemoryEnabled,
		clearChat,
		compactContext,
		rewindChat,
		gitStatus,
		toggleWorkspace,
		renameSession,

	} = useJcodeSession();

	const [activeNavTab, setActiveNavTab] = useState("chat");
	const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState<{ sessionId: string; name: string } | null>(null);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	// Pre-seed createDialog in swarm mode when adding an agent to existing workspace
	const [createDialogInitMode, setCreateDialogInitMode] = useState<
		"normal" | "swarm"
	>("swarm");
	const [preferredModel] = useState("");
	const [selectedConvId, setSelectedConvId] = useState<string | undefined>();
	const { effectiveTheme, setTheme } = useTheme();
	const [pendingSwarmMembers, setPendingSwarmMembers] = useState<
		Array<{ roleName: string; model: string; profileId?: string }>
	>([]);
	// Read cursor: track when each conversation was last viewed
	const [lastReadAt, setLastReadAt] = useState<Record<string, number>>({});

	const currentWorkspaceId = state.activeWorkspaceId || DEFAULT_WORKSPACE_ID;

	const getWorkspaceSessions = (workspaceId: string) =>
		state.sessions.filter(
			(session) => workspaceIdFromDir(session.workingDir) === workspaceId,
		);

	const findWorkspaceTargetSession = (
		workspaceId: string,
		requireCoordinator = false,
	) => {
		const sessions = getWorkspaceSessions(workspaceId);
		const coordinator = sessions.find(
			(session) => session.swarmRole === "coordinator",
		);
		if (coordinator) return coordinator;
		if (requireCoordinator) return undefined;
		return (
			sessions.find((session) => !session.roleName) || sessions[0]
		);
	};

	const openWorkspaceConversation = async (
		workspaceId: string,
		preferredSessionId?: string,
	) => {
		const workingDir = workingDirFromWorkspaceId(workspaceId);
		setActiveWorkspace(workspaceId);
		setWorkingDir(workingDir);
		const history = await loadWorkspaceThreadHistory(workingDir);
		setWorkspaceMode(workspaceId, "swarm", history);
		setSelectedConvId(`workspace:${workspaceId}`);

		const targetSessionId =
			preferredSessionId || findWorkspaceTargetSession(workspaceId)?.sessionId;
		if (!targetSessionId) return;

		const targetSession = state.sessions.find(
			(session) => session.sessionId === targetSessionId,
		);
		if (state.sessionData[targetSessionId]?.connectionPhase === "connected") {
			switchSession(targetSessionId);
			return;
		}
		if (targetSession) {
			void resumeSession(targetSessionId, targetSession.workingDir || null);
			return;
		}
		switchSession(targetSessionId);
	};

	const handleWorkspaceChange = async (workspaceId: string) => {
		const workingDir = workingDirFromWorkspaceId(workspaceId);
		setActiveWorkspace(workspaceId);
		setWorkingDir(workingDir);

		const sessions = getWorkspaceSessions(workspaceId);
		const hasSwarmThread =
			sessions.filter((session) => session.roleName).length >= 2;
		if (hasSwarmThread) {
			await openWorkspaceConversation(workspaceId);
			return;
		}

		const targetSession = findWorkspaceTargetSession(workspaceId);
		if (!targetSession) {
			setSelectedConvId(undefined);
			return;
		}
		setSelectedConvId(targetSession.sessionId);
		if (
			state.sessionData[targetSession.sessionId]?.connectionPhase ===
			"connected"
		) {
			switchSession(targetSession.sessionId);
		} else {
			void resumeSession(
				targetSession.sessionId,
				targetSession.workingDir || null,
			);
		}
	};

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
			setActiveWorkspace(workspaceIdFromDir(workingDir));
			setWorkingDir(workingDir);
			setSelectedConvId(sessionId);
			await resumeSession(sessionId, workingDir);
			await listSessions();
		})();
	}, [
		getLastSessionState,
		listSessions,
		resumeSession,
		setActiveWorkspace,
		setWorkingDir,
	]);

	// Save session state when active session changes
	useEffect(() => {
		if (state.sessionId) {
			void saveSessionState(state.sessionId, state.workingDir);
		}
	}, [state.sessionId, state.workingDir, saveSessionState]);

	// Poll sessions on connect
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

	// Cmd+P keyboard shortcut
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
	}, [listSessions]);

	const handleNewSession = async () => {
		setCreateDialogOpen(true);
	};

	const handleCreateNormal = async (
		workingDir: string | null,
		model: string,
		profileId?: string,
	) => {
		const workspaceId = workspaceIdFromDir(workingDir);
		setActiveWorkspace(workspaceId);
		setWorkingDir(workingDir);
		const sessionId = await connect(workingDir, model || undefined, true, undefined, profileId);
		if (sessionId) {
			switchSession(sessionId);
			setSelectedConvId(sessionId);
		}
		await listSessions();
	};

	const handleCreateSwarm = async (
		workingDir: string | null,
		model: string,
		profileId?: string,
	) => {
		const workspaceId = workspaceIdFromDir(workingDir);
		setActiveWorkspace(workspaceId);
		setWorkingDir(workingDir);

		let createdSessionIds: string[] = [];
		try {
			createdSessionIds = (await invoke<string[]>("begin_swarm", {
				workingDir,
				coordinatorModel: model || null,
				coordinatorProfileId: profileId || null,
				memoryEnabled: true,
				members: pendingSwarmMembers.map((m) => ({
					roleName: m.roleName,
					model: m.model || null,
					profileId: m.profileId || null,
				})),
			})) ?? [];

			if (createdSessionIds.length > 0) {
				switchSession(createdSessionIds[0]);
			}
		} catch (e) {
			console.error("Swarm creation failed:", e);
			alert(`Failed to create agent team: ${String(e)}`);
			return;
		}
		await listSessions();
		await openWorkspaceConversation(
			workspaceId,
			createdSessionIds[0] || undefined,
		);
		setPendingSwarmMembers([]);
	};

	const handleAddSwarmMember = (roleName: string, model: string, profileId?: string) => {
		setPendingSwarmMembers((prev) => {
			if (prev.some((member) => member.roleName === roleName)) return prev;
			return [...prev, { roleName, model, profileId }];
		});
	};

	const handleRemoveSwarmMember = (roleName: string) => {
		setPendingSwarmMembers((prev) =>
			prev.filter((member) => member.roleName !== roleName),
		);
	};

	/** Open the create dialog pre-set to swarm mode for the current workspace. */
	const handleAddAgentToWorkspace = () => {
		setCreateDialogInitMode("swarm");
		setCreateDialogOpen(true);
	};

	/** Remove an individual agent session from the workspace after confirmation. */
	const handleRemoveAgentSession = (sessionId: string) => {
		const session = state.sessions.find((s) => s.sessionId === sessionId);
		const name = session?.roleName || session?.title || sessionId.slice(0, 8);
		setConfirmRemove({ sessionId, name });
	};

	const handleConfirmRemove = async () => {
		if (!confirmRemove) return;
		const { sessionId } = confirmRemove;
		setConfirmRemove(null);
		await deleteSession(sessionId);
		if (selectedConvId === sessionId) {
			const session = state.sessions.find((s) => s.sessionId === sessionId);
			const wsid = workspaceIdFromDir(session?.workingDir);
			void openWorkspaceConversation(wsid);
		}
		await listSessions();
	};

	const resolveTargetSessionId = () => {
		if (selectedConvId?.startsWith("workspace:")) {
			const workspaceId = selectedConvId.slice("workspace:".length);
			return findWorkspaceTargetSession(
				workspaceId,
				state.workspaceModes[workspaceId] === "swarm",
			)?.sessionId;
		}
		if (selectedConvId) {
			const session = state.sessions.find(
				(s) => s.sessionId === selectedConvId,
			);
			const wsId = workspaceIdFromDir(session?.workingDir);
			if (state.workspaceModes[wsId] === "swarm") {
				return findWorkspaceTargetSession(wsId, true)?.sessionId;
			}
			return selectedConvId;
		}
		return (
			state.sessionId ||
			findWorkspaceTargetSession(
				currentWorkspaceId,
				state.workspaceModes[currentWorkspaceId] === "swarm",
			)?.sessionId
		);
	};

	const handleSendMessage = async (
		content: string,
		images?: [string, string][],
	) => {
		let targetSessionId: string | undefined =
			resolveTargetSessionId() || undefined;

		// ── Slash command interceptor ─────────────────────────────────────────
		const slashCmd = parseSlashCommand(content);
		if (slashCmd) {
			const { cmd, args } = slashCmd;
			if (cmd === "/model") {
				if (args) {
					await setModel(args, undefined, targetSessionId);
				}
				return;
			}
			if (cmd === "/effort") {
				const effort = args || "medium";
				await setReasoningEffort(effort, targetSessionId);
				return;
			}
			if (cmd === "/memory") {
				const current = state.memoryEnabled;
				await setMemoryEnabled(!current, targetSessionId);
				return;
			}
			if (cmd === "/clear") {
				await clearChat(targetSessionId);
				return;
			}
			if (cmd === "/compact") {
				await compactContext(targetSessionId);
				return;
			}
			if (cmd === "/rewind") {
				const n = parseInt(args, 10);
				if (!isNaN(n)) {
					await rewindChat(n, targetSessionId);
					return;
				}
				// /rewind undo — pass to backend
			}
			if (cmd === "/stop" || cmd === "/cancel") {
				await cancel(targetSessionId);
				return;
			}
			if (cmd === "/rename") {
				if (args && targetSessionId) {
					await renameSession(targetSessionId, args);
				}
				return;
			}
			if (cmd === "/git") {
				await gitStatus(state.workingDir);
				// Display git output as a system message by sending to backend
				if (targetSessionId) {
					await sendMessage(
						`/git${args ? " " + args : ""}`,
						images,
						targetSessionId,
					);
				}
				return;
			}
			if (cmd === "/help" || cmd === "/?" || cmd === "/commands") {
				// Pass to backend for help text
				if (targetSessionId)
					await sendMessage(content, images, targetSessionId);
				return;
			}
			// All other commands pass through to backend
		}
		// ── End slash command interceptor ─────────────────────────────────────

		// @AgentName routing: in swarm-mode workspace, @mention is preserved
		// and sent through the coordinator so it stays aware of all delegations.
		// The coordinator decides whether to use swarm tools (assign_task / dm)
		// to forward the request. Direct DM bypass is blocked.
		const currentWsId = currentWorkspaceId;
		if (
			targetSessionId &&
			state.workspaceModes[currentWsId] === "swarm"
		) {
			// Allow hyphens, underscores and alphanumerics in role names
			const mentionMatch = content.match(
				/^@([a-zA-Z0-9_-]+)(?:\s|$)/,
			);
			if (mentionMatch) {
				const mentionedName = mentionMatch[1].toLowerCase();
				const wsSessions = getWorkspaceSessions(currentWsId);
				const agentSession = wsSessions.find(
					(s) => s.roleName?.toLowerCase() === mentionedName,
				);
				if (agentSession) {
					// Ensure the agent session is connected so coordinator can
					// delegate to it, but do NOT switch targetSessionId — the
					// message still goes to coordinator.
					if (
						state.sessionData[agentSession.sessionId]
							?.connectionPhase !== "connected"
					) {
						await resumeSession(
							agentSession.sessionId,
							agentSession.workingDir || null,
						);
					}
					// Keep @mention prefix so coordinator sees the delegation
					// target and can use swarm dm / assign_task accordingly.
				}
			}
		}

		if (!targetSessionId) {
			const workingDir = workingDirFromWorkspaceId(currentWorkspaceId);
			setActiveWorkspace(currentWorkspaceId);
			setWorkingDir(workingDir);
			targetSessionId =
				(await connect(workingDir, preferredModel || undefined, true)) ||
				undefined;
			if (!targetSessionId) return;
			switchSession(targetSessionId);
			setSelectedConvId(targetSessionId);
			await listSessions();
		}
		await sendMessage(content, images, targetSessionId);
	};

	const handleResume = (session: SessionInfo) => {
		setActiveWorkspace(workspaceIdFromDir(session.workingDir));
		setWorkingDir(session.workingDir || null);
		setSelectedConvId(session.sessionId);
		// Mark conversation as read
		setLastReadAt((prev) => ({ ...prev, [session.sessionId]: Date.now() }));
		if (state.sessionId === session.sessionId) return;
		const sessionData = state.sessionData[session.sessionId];
		if (sessionData?.connectionPhase === "connected") {
			switchSession(session.sessionId);
		} else {
			void resumeSession(session.sessionId, session.workingDir || null);
		}
	};

	const handleSelectConversation = (convId: string) => {
		setSelectedConvId(convId);
		// Mark as read immediately
		setLastReadAt((prev) => ({ ...prev, [convId]: Date.now() }));
		if (convId.startsWith("workspace:")) {
			const workspaceId = convId.slice("workspace:".length);
			void openWorkspaceConversation(workspaceId);
		}
	};

	const workspaces = useMemo(() => {
		const ids = new Set<string>([DEFAULT_WORKSPACE_ID]);
		for (const session of state.sessions) {
			ids.add(workspaceIdFromDir(session.workingDir));
		}
		return Array.from(ids).sort((left, right) => {
			if (left === DEFAULT_WORKSPACE_ID) return -1;
			if (right === DEFAULT_WORKSPACE_ID) return 1;
			return workspaceLabel(left).localeCompare(workspaceLabel(right));
		});
	}, [state.sessions]);

	const workspaceSessions = useMemo(
		() => getWorkspaceSessions(currentWorkspaceId),
		[currentWorkspaceId, state.sessions],
	);

	const respondingRoles = workspaceSessions
		.filter(
			(session) =>
				state.sessionData[session.sessionId]?.isProcessing ||
				session.liveProcessing,
		)
		.map((session) => session.roleName)
		.filter((role): role is string => Boolean(role));

	// Compute last-message preview + unread count per session for ConversationsList
	const sessionPreviewMap = useMemo(() => {
		const map: Record<
			string,
			{ text: string; timestamp: number; unread: number }
		> = {};
		for (const [sessionId, data] of Object.entries(state.sessionData)) {
			const msgs = data.messages.filter(
				(m) => m.role === "user" || m.role === "assistant",
			);
			const last = msgs[msgs.length - 1];
			if (last) {
				const lastRead = lastReadAt[sessionId] ?? 0;
				const unread = msgs.filter(
					(m) => m.role === "assistant" && (m.timestamp ?? 0) > lastRead,
				).length;
				map[sessionId] = {
					text: last.content.replace(/\n/g, " ").slice(0, 80),
					timestamp: last.timestamp ?? Date.now(),
					unread,
				};
			}
		}
		return map;
	}, [state.sessionData, lastReadAt]);

	const displayMessages = useMemo(() => {
		if (!selectedConvId) return state.messages;
		if (selectedConvId.startsWith("workspace:")) {
			const workspaceId = selectedConvId.slice("workspace:".length);
			const virtualSessionId = `workspace:${workspaceId}`;
			return state.sessionData[virtualSessionId]?.messages || [];
		}
		const data = state.sessionData[selectedConvId];
		if (data) return data.messages;
		return state.messages;
	}, [selectedConvId, state.messages, state.sessionData]);

	const displayIsProcessing = useMemo(() => {
		if (!selectedConvId) return state.isProcessing;
		if (selectedConvId.startsWith("workspace:")) {
			return respondingRoles.length > 0;
		}
		const data = state.sessionData[selectedConvId];
		if (typeof data?.isProcessing === "boolean") return data.isProcessing;
		return (
			workspaceSessions.find((session) => session.sessionId === selectedConvId)
				?.liveProcessing ?? false
		);
	}, [
		respondingRoles,
		selectedConvId,
		state.isProcessing,
		state.sessionData,
		workspaceSessions,
	]);

	// True while a DM session is in the process of loading its history
	const displayIsLoading = useMemo(() => {
		if (!selectedConvId || selectedConvId.startsWith("workspace:"))
			return false;
		const phase = state.sessionData[selectedConvId]?.connectionPhase;
		return phase === "initializing" || phase === "connecting";
	}, [selectedConvId, state.sessionData]);

	const selectedSession = useMemo(
		() =>
			selectedConvId && !selectedConvId.startsWith("workspace:")
				? state.sessions.find((session) => session.sessionId === selectedConvId)
				: undefined,
		[selectedConvId, state.sessions],
	);

	const channelName = selectedConvId?.startsWith("workspace:")
		? "Everyone"
		: selectedSession?.roleName || selectedSession?.title || "Conversation";
	const channelMembers = selectedConvId?.startsWith("workspace:")
		? workspaceSessions
				.map((session) => session.roleName)
				.filter((role): role is string => Boolean(role))
		: selectedSession?.roleName
			? [selectedSession.roleName]
			: undefined;

	const isChatTab = activeNavTab === "chat";

	return (
		<div className="h-screen bg-background flex flex-col overflow-hidden">
			<div className="flex flex-1 overflow-hidden">
				<NavBar
					activeTab={activeNavTab}
					onTabChange={setActiveNavTab}
					unreadCount={Object.values(sessionPreviewMap).reduce(
						(sum, p) => sum + (p.unread > 0 ? 1 : 0),
						0,
					)}
				/>

				{isChatTab ? (
					<>
						<ConversationsList
							workspaces={workspaces}
							sessions={state.sessions}
							activeWorkspaceId={currentWorkspaceId}
							expandedWorkspaces={state.expandedWorkspaces}
							selectedConvId={selectedConvId}
							sessionPreviewMap={sessionPreviewMap}
							onToggleWorkspace={toggleWorkspace}
							onSelectWorkspace={handleWorkspaceChange}
							onSelectConversation={handleSelectConversation}
							onSelectSession={handleResume}
							onCreateSession={handleNewSession}
							onRemoveSession={handleRemoveAgentSession}
						/>

						<ChatArea
							messages={displayMessages}
							isProcessing={displayIsProcessing}
							isLoading={displayIsLoading}
							onSend={handleSendMessage}
							onCancel={() => cancel(resolveTargetSessionId() || undefined)}
							channelName={channelName}
						channelMembers={channelMembers}
						onRenameSession={renameSession}
						currentSessionId={selectedConvId?.startsWith("workspace:") ? undefined : selectedConvId}
							respondingRoles={respondingRoles}
							workspaceSessions={workspaceSessions}
							onAddAgent={handleAddAgentToWorkspace}
							lastReadTimestamp={
								selectedConvId ? lastReadAt[selectedConvId] : undefined
							}
							onConvene={() => {
								void handleSendMessage("/convene");
							}}
							currentModel={state.providerModel}
							currentProfileId={state.providerName}
							reasoningEffort={state.reasoningEffort}
							memoryEnabled={state.memoryEnabled}
							availableModels={state.availableModels}
							onSetModel={(m, pid) =>
								void setModel(
									m,
									pid,
									resolveTargetSessionId() || undefined,
								)
							}
							onSetEffort={(e) =>
								void setReasoningEffort(
									e,
									resolveTargetSessionId() || undefined,
								)
							}
							onToggleMemory={() =>
								void setMemoryEnabled(
									!state.memoryEnabled,
									resolveTargetSessionId() || undefined,
								)
							}
							onCompact={() =>
								void compactContext(resolveTargetSessionId() || undefined)
							}
							onClearChat={() =>
								void clearChat(resolveTargetSessionId() || undefined)
							}
							/>
					</>
				) : (
					<div key={activeNavTab} className="animate-fade-in flex-1 flex">
						{activeNavTab === "settings" ? (
							<SettingsPage theme={effectiveTheme} onThemeChange={setTheme} />
						) : activeNavTab === "network" ? (
							<ProviderConfigPage onAuthStatusChange={() => listSessions()} />
						) : (
							<PlaceholderPage key={activeNavTab} icon={activeNavTab} title={placeholderTitle(activeNavTab)} description={placeholderDesc(activeNavTab)} />
						)}
					</div>
				)}
			</div>

			<CreateSessionDialog
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
				workspaces={workspaces}
				currentWorkingDir={state.workingDir}
				availableModels={state.availableModels}
				onCreateNormal={handleCreateNormal}
				onCreateSwarm={handleCreateSwarm}
				onAddSwarmMember={handleAddSwarmMember}
				onRemoveSwarmMember={handleRemoveSwarmMember}
				swarmMembers={pendingSwarmMembers.map((member) => member.roleName)}
				initMode={createDialogInitMode}
			/>

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
			<ConfirmDialog
				open={confirmRemove !== null}
				title="Remove Agent"
				message={`Remove agent "${confirmRemove?.name}" from this workspace?`}
				confirmLabel="Remove"
				variant="destructive"
				onConfirm={handleConfirmRemove}
				onCancel={() => setConfirmRemove(null)}
			/>
		</div>
	);
}

function placeholderTitle(icon: string): string {
	const map: Record<string, string> = {
		media: "Media",
		tasks: "Tasks",
		monitor: "Monitor",
		team: "Swarm",
	};
	return map[icon] || icon;
}

function placeholderDesc(icon: string): string {
	const map: Record<string, string> = {
		media: "Multimedia and image generation history",
		tasks: "Background tasks and job queue",
		monitor: "System monitoring and diagnostics",
		team: "Multi-agent collaboration and orchestration",
	};
	return map[icon] || "";
}

function PlaceholderPage({
	icon,
	title,
	description,
}: {
	icon: string;
	title: string;
	description: string;
}) {
	const IconComponent =
		icon === "media"
			? MediaIcon
			: icon === "tasks"
				? TasksIcon
				: icon === "monitor"
					? MonitorIcon
					: icon === "team"
						? TeamIcon
						: null;

	return (
		<div className="flex-1 flex flex-col items-center justify-center bg-background">
			<div className="flex flex-col items-center gap-4 max-w-md text-center px-6">
				<div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center">
					{IconComponent && (
						<IconComponent className="w-8 h-8 text-muted-foreground" />
					)}
				</div>
				<h1 className="text-xl font-semibold text-foreground">{title}</h1>
				<p className="text-sm text-muted-foreground">{description}</p>
				<p className="text-xs text-muted-foreground/60">
					This feature is coming soon. Switch to the Chat tab to continue
					working with AI agents.
				</p>
			</div>
		</div>
	);
}

function TasksIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
			<path d="M9 12l2 2 4-4" />
		</svg>
	);
}

function MediaIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<polygon points="5 3 19 12 5 21 5 3" />
		</svg>
	);
}

function MonitorIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	);
}

function TeamIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
			<circle cx="9" cy="7" r="4" />
			<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
			<path d="M16 3.13a4 4 0 0 1 0 7.75" />
		</svg>
	);
}
