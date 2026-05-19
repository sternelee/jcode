import { useJcodeSession } from "@/hooks/useJcodeSession";
import { NavBar } from "@/components/NavBar";
import { ConversationsList } from "@/components/ConversationsList";
import { ChatArea } from "@/components/ChatArea";
import { CreateSessionDialog } from "@/components/CreateSessionDialog";
import { StdinInputModal } from "@/components/StdinInputModal";
import { SessionSwitcherDialog } from "@/components/SessionSwitcherDialog";
import { parseSlashCommand } from "@/components/SlashCommands";
import type { SessionInfo } from "@/types";
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
		createRoleSession,
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
	} = useJcodeSession();

	const [activeNavTab, setActiveNavTab] = useState("chat");
	const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	// Pre-seed createDialog in swarm mode when adding an agent to existing workspace
	const [createDialogInitMode, setCreateDialogInitMode] = useState<"normal" | "swarm">("swarm");
	const [preferredModel] = useState("");
	const [selectedConvId, setSelectedConvId] = useState<string | undefined>();
	const [pendingSwarmMembers, setPendingSwarmMembers] = useState<
		Array<{ roleName: string; model: string }>
	>([]);
	// Read cursor: track when each conversation was last viewed
	const [lastReadAt, setLastReadAt] = useState<Record<string, number>>({});

	const currentWorkspaceId = state.activeWorkspaceId || DEFAULT_WORKSPACE_ID;

	const getWorkspaceSessions = (workspaceId: string) =>
		state.sessions.filter(
			(session) => workspaceIdFromDir(session.workingDir) === workspaceId,
		);

	const findWorkspaceTargetSession = (workspaceId: string) => {
		const sessions = getWorkspaceSessions(workspaceId);
		return (
			sessions.find((session) => session.swarmRole === "coordinator") ||
			sessions.find((session) => !session.roleName) ||
			sessions[0]
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
		const hasSwarmThread = sessions.filter((session) => session.roleName).length >= 2;
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
		if (state.sessionData[targetSession.sessionId]?.connectionPhase === "connected") {
			switchSession(targetSession.sessionId);
		} else {
			void resumeSession(targetSession.sessionId, targetSession.workingDir || null);
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
	}, [getLastSessionState, listSessions, resumeSession, setActiveWorkspace, setWorkingDir]);

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

	const handleCreateNormal = async (workingDir: string | null, model: string) => {
		const workspaceId = workspaceIdFromDir(workingDir);
		setActiveWorkspace(workspaceId);
		setWorkingDir(workingDir);
		const sessionId = await connect(workingDir, model || undefined, true);
		if (sessionId) {
			switchSession(sessionId);
			setSelectedConvId(sessionId);
		}
		await listSessions();
	};

	const handleCreateSwarm = async (workingDir: string | null, model: string) => {
		const workspaceId = workspaceIdFromDir(workingDir);
		setActiveWorkspace(workspaceId);
		setWorkingDir(workingDir);

		const coordinatorSessionId = await connect(
			workingDir,
			model || undefined,
			true,
		);
		for (const member of pendingSwarmMembers) {
			await createRoleSession(workingDir, member.roleName, member.model, true);
		}
		if (coordinatorSessionId) {
			switchSession(coordinatorSessionId);
		}
		await listSessions();
		await openWorkspaceConversation(workspaceId, coordinatorSessionId || undefined);
		setPendingSwarmMembers([]);
	};

	const handleAddSwarmMember = (roleName: string, model: string) => {
		setPendingSwarmMembers((prev) => {
			if (prev.some((member) => member.roleName === roleName)) return prev;
			return [...prev, { roleName, model }];
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
	const handleRemoveAgentSession = async (sessionId: string) => {
		const session = state.sessions.find((s) => s.sessionId === sessionId);
		const name = session?.roleName || session?.title || sessionId.slice(0, 8);
		const confirmed = window.confirm(`Remove agent "${name}" from this workspace?`);
		if (!confirmed) return;
		await deleteSession(sessionId);
		// If we were viewing that DM, switch back to workspace thread
		if (selectedConvId === sessionId) {
			const wsid = workspaceIdFromDir(session?.workingDir);
			void openWorkspaceConversation(wsid);
		}
		await listSessions();
	};

	const resolveTargetSessionId = () => {
		if (selectedConvId?.startsWith("workspace:")) {
			const workspaceId = selectedConvId.slice("workspace:".length);
			return findWorkspaceTargetSession(workspaceId)?.sessionId;
		}
		if (selectedConvId) return selectedConvId;
		return state.sessionId || findWorkspaceTargetSession(currentWorkspaceId)?.sessionId;
	};

	const handleSendMessage = async (content: string, images?: [string, string][]) => {
		let targetSessionId: string | undefined = resolveTargetSessionId() || undefined;

		// ── Slash command interceptor ─────────────────────────────────────────
		const slashCmd = parseSlashCommand(content);
		if (slashCmd) {
			const { cmd, args } = slashCmd;
			if (cmd === "/model" || cmd === "/models") {
				// Switch model directly if name given, otherwise let backend handle
				if (args) {
					await setModel(args, undefined, targetSessionId);
				}
				// If no args, still pass to backend so it shows the model list as a message
				if (!args) {
					if (targetSessionId) await sendMessage(content, images, targetSessionId);
					return;
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
			if (cmd === "/git") {
				await gitStatus(state.workingDir);
				// Display git output as a system message by sending to backend
				if (targetSessionId) {
					await sendMessage(`/git${args ? " " + args : ""}`, images, targetSessionId);
				}
				return;
			}
			if (cmd === "/help" || cmd === "/?" || cmd === "/commands") {
				// Pass to backend for help text
				if (targetSessionId) await sendMessage(content, images, targetSessionId);
				return;
			}
			// All other commands pass through to backend
		}
		// ── End slash command interceptor ─────────────────────────────────────

		// @AgentName routing: if in workspace thread and message starts with @Name,
		// route directly to that agent's DM session
		if (targetSessionId && selectedConvId?.startsWith("workspace:")) {
			const mentionMatch = content.match(/^@(\w+)(?:\s|$)/);
			if (mentionMatch) {
				const mentionedName = mentionMatch[1].toLowerCase();
				const agentSession = workspaceSessions.find(
					(s) => s.roleName?.toLowerCase() === mentionedName,
				);
				if (agentSession) {
					// Ensure the agent session is connected before sending
					if (
						state.sessionData[agentSession.sessionId]?.connectionPhase !== "connected"
					) {
						await resumeSession(
							agentSession.sessionId,
							agentSession.workingDir || null,
						);
					}
					targetSessionId = agentSession.sessionId;
				}
			}
		}

		if (!targetSessionId) {
			const workingDir = workingDirFromWorkspaceId(currentWorkspaceId);
			setActiveWorkspace(currentWorkspaceId);
			setWorkingDir(workingDir);
			targetSessionId =
				(await connect(workingDir, preferredModel || undefined, true)) || undefined;
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
				state.sessionData[session.sessionId]?.isProcessing || session.liveProcessing,
		)
		.map((session) => session.roleName)
		.filter((role): role is string => Boolean(role));

	// Compute last-message preview + unread count per session for ConversationsList
	const sessionPreviewMap = useMemo(() => {
		const map: Record<string, { text: string; timestamp: number; unread: number }> = {};
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
	}, [respondingRoles, selectedConvId, state.isProcessing, state.sessionData, workspaceSessions]);

	// True while a DM session is in the process of loading its history
	const displayIsLoading = useMemo(() => {
		if (!selectedConvId || selectedConvId.startsWith("workspace:")) return false;
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

	return (
		<div className="h-screen bg-white flex flex-col overflow-hidden">
			<div className="h-[38px] min-h-[38px] bg-[#F6F6F6] border-b border-[#E5E5E5] flex items-center justify-between px-4 select-none">
				<div className="flex items-center gap-[6px]">
					<div className="w-3 h-3 rounded-full bg-[#FF5F57]" />
					<div className="w-3 h-3 rounded-full bg-[#FEBC2E]" />
					<div className="w-3 h-3 rounded-full bg-[#28C840]" />
				</div>

				<div className="flex items-center gap-2 text-[11px] text-[#6B7280] font-medium">
					<svg
						viewBox="0 0 16 16"
						fill="currentColor"
						className="w-3.5 h-3.5 text-[#9CA3AF]"
					>
						<path d="M8 1a.75.75 0 01.75.75v5.5h5.5a.75.75 0 010 1.5h-5.5v5.5a.75.75 0 01-1.5 0v-5.5h-5.5a.75.75 0 010-1.5h5.5v-5.5A.75.75 0 018 1z" />
					</svg>
					Cumora — where agent teams gather
				</div>

				<label className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-white border border-[#E5E7EB] text-[11px] text-[#374151] font-medium hover:bg-[#F9FAFB] transition-colors">
					<svg
						viewBox="0 0 16 16"
						fill="currentColor"
						className="w-3.5 h-3.5 text-[#9CA3AF]"
					>
						<path
							fillRule="evenodd"
							d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.22.972a7.857 7.857 0 004.189 4.19l.972-1.22a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V12.5a3 3 0 01-3 3h-1.5a10.5 10.5 0 01-10.5-10.5v-1.5z"
							clipRule="evenodd"
						/>
					</svg>
					<select
						value={currentWorkspaceId}
						onChange={(event) => {
							void handleWorkspaceChange(event.target.value);
						}}
						className="bg-transparent text-[11px] text-[#374151] font-medium outline-none"
					>
						{workspaces.map((workspaceId) => (
							<option key={workspaceId} value={workspaceId}>
								{workspaceLabel(workspaceId)}
							</option>
						))}
					</select>
				</label>
			</div>

			<div className="flex flex-1 overflow-hidden">
				<NavBar
					activeTab={activeNavTab}
					onTabChange={setActiveNavTab}
					unreadCount={Object.values(sessionPreviewMap).reduce(
						(sum, p) => sum + (p.unread > 0 ? 1 : 0),
						0,
					)}
				/>

				<ConversationsList
					sessions={state.sessions}
					onCreateSession={handleNewSession}
					workspaceSessions={workspaceSessions}
					selectedConvId={selectedConvId}
					onSelectConversation={handleSelectConversation}
					onSelectSession={handleResume}
					activeSessionId={state.sessionId}
					sessionPreviewMap={sessionPreviewMap}
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
					respondingRoles={respondingRoles}
					workspaceSessions={workspaceSessions}
					onAddAgent={handleAddAgentToWorkspace}
					lastReadTimestamp={selectedConvId ? lastReadAt[selectedConvId] : undefined}
					onConvene={() => {
						void handleSendMessage("/convene");
					}}
					currentModel={state.providerModel}
					reasoningEffort={state.reasoningEffort}
					memoryEnabled={state.memoryEnabled}
					availableModels={state.availableModels}
					onSetModel={(m) => void setModel(m, undefined, resolveTargetSessionId() || undefined)}
					onSetEffort={(e) => void setReasoningEffort(e, resolveTargetSessionId() || undefined)}
					onToggleMemory={() => void setMemoryEnabled(!state.memoryEnabled, resolveTargetSessionId() || undefined)}
					onCompact={() => void compactContext(resolveTargetSessionId() || undefined)}
					onClearChat={() => void clearChat(resolveTargetSessionId() || undefined)}
				/>
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
		</div>
	);
}
