import { useJcodeSession } from "@/hooks/useJcodeSession";
import { TitleBar } from "@/components/TitleBar";
import { LeftSidebar } from "@/components/LeftSidebar";
import { ChatArea } from "@/components/ChatArea";
import { CreateSessionDialog } from "@/components/CreateSessionDialog";
import { StdinInputModal } from "@/components/StdinInputModal";
import { SessionSwitcherDialog } from "@/components/SessionSwitcherDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PermissionDialog } from "@/components/PermissionDialog";
import { SettingsPage } from "@/components/SettingsPage";
import { ProviderConfigPage } from "@/components/ProviderConfigPage";
import { TasksPage } from "@/components/TasksPage";
import { MonitorPage } from "@/components/MonitorPage";
import { TeamPage } from "@/components/TeamPage";
import { MediaPage } from "@/components/MediaPage";
import { McpPage } from "@/components/McpPage";
import { SkillsPage } from "@/components/SkillsPage";
import { ShortcutsHelpModal } from "@/components/ShortcutsHelpModal";
import { RightSidebar } from "@/components/RightSidebar";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { parseSlashCommand } from "@/components/SlashCommands";
import { useTheme } from "@/hooks/useTheme";
import type { SessionInfo, PermissionRequest } from "@/types";
import type { BuiltinPage } from "@/lib/launcherTypes";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
		renameSession,
		runDictation,
		sendSoftInterrupt,
		exportMemories,
		importMemories,
		searchMemories,
		getMemoryList,
		getMemoryStats,
		getMemoryGraph,
		getUsageInfo,
		getWorkspaceMemoryPreferences,
		setWorkspaceMemoryPreference,
		executeShellCommandAndDisplay,
	} = useJcodeSession();

	const [activeNavTab, setActiveNavTab] = useState("chat");
	const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState<{
		sessionId: string;
		name: string;
	} | null>(null);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	// Pre-seed createDialog in swarm mode when adding an agent to existing workspace
	const [createDialogInitMode, setCreateDialogInitMode] = useState<
		"normal" | "swarm" | "addMember"
	>("normal");
	const [preferredModel] = useState("");
	const [selectedConvId, setSelectedConvId] = useState<string | undefined>();
	const { effectiveTheme, setTheme } = useTheme();
	const [pendingSwarmMembers, setPendingSwarmMembers] = useState<
		Array<{
			roleName: string;
			model: string;
			profileId?: string;
			providerKey?: string;
		}>
	>([]);
	// Read cursor: track when each conversation was last viewed
	const [lastReadAt, setLastReadAt] = useState<Record<string, number>>({});
	// Pending permission requests
	const [permissionRequests, setPermissionRequests] = useState<
		PermissionRequest[]
	>([]);
	const [helpOpen, setHelpOpen] = useState(false);
	const [sidePanelOpen, setSidePanelOpen] = useState(true);
	const [onboardingComplete, setOnboardingComplete] = useState(() => {
		// Check if user has completed onboarding before
		return localStorage.getItem("jcode-onboarding-complete") === "true";
	});

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
		return sessions.find((session) => !session.roleName) || sessions[0];
	};

	const openWorkspaceConversation = async (
		workspaceId: string,
		preferredSessionId?: string,
		forceMode?: "normal" | "swarm",
	) => {
		const workingDir = workingDirFromWorkspaceId(workspaceId);
		setActiveWorkspace(workspaceId);
		setWorkingDir(workingDir);

		const existingMode = state.workspaceModes[workspaceId];
		const sessions = getWorkspaceSessions(workspaceId);
		const hasSwarm = sessions.filter((s) => s.roleName).length >= 2;
		const mode = forceMode ?? existingMode ?? (hasSwarm ? "swarm" : "normal");

		if (mode === "swarm") {
			const history = await loadWorkspaceThreadHistory(workingDir);
			setWorkspaceMode(workspaceId, "swarm", history);
		} else {
			setWorkspaceMode(workspaceId, "normal");
		}
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

	const handleOnboardingComplete = (model?: string, providerId?: string) => {
		localStorage.setItem("jcode-onboarding-complete", "true");
		setOnboardingComplete(true);
		if (model && providerId) {
			void setModel(model, providerId);
		}
	};

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

	// Poll permission requests — only on chat tab, adaptive interval
	useEffect(() => {
		if (!state.connected || activeNavTab !== "chat") return;
		const poll = async () => {
			try {
				const result = await invoke<{ requests: PermissionRequest[] }>(
					"get_permission_requests",
				);
				setPermissionRequests(result.requests || []);
			} catch {
				/* ignore */
			}
		};
		void poll();
		const intervalMs = permissionRequests.length > 0 ? 3000 : 10000;
		const interval = setInterval(poll, intervalMs);
		return () => clearInterval(interval);
	}, [state.connected, activeNavTab, permissionRequests.length]);

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

			// Cmd/Ctrl+K — summon the launcher palette. The backend also
			// exposes a global hotkey, but the in-workbench shortcut keeps
			// the keyboard-only workflow smooth once the workbench is
			// focused.
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				void invoke("show_launcher");
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
			if (event.key === "?" && !event.metaKey && !event.ctrlKey) {
				event.preventDefault();
				setHelpOpen(true);
			}
			if (event.key.toLowerCase() === "o" && !event.metaKey && !event.ctrlKey) {
				event.preventDefault();
				// sidebar toggle removed in RightSidebar migration
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [listSessions]);



	const handleCreateNormal = async (
		workingDir: string | null,
		model: string,
		profileId?: string,
	) => {
		const workspaceId = workspaceIdFromDir(workingDir);
		setActiveWorkspace(workspaceId);
		setWorkingDir(workingDir);
		const sessionId = await connect(
			workingDir,
			model || undefined,
			true,
			undefined,
			profileId,
		);
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
			createdSessionIds =
				(await invoke<string[]>("begin_swarm", {
					workingDir,
					coordinatorModel: model || null,
					coordinatorProfileId: profileId || null,
					memoryEnabled: true,
					members: pendingSwarmMembers.map((m) => ({
						roleName: m.roleName,
						model: m.model || null,
						// Prefer the explicit providerKey; fall back to profileId
						// for older callers.
						providerKey: m.providerKey ?? m.profileId ?? null,
						profileId: m.profileId ?? null,
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
			"swarm",
		);
		setPendingSwarmMembers([]);
	};

	const handleAddSwarmMember = (
		roleName: string,
		model: string,
		profileId?: string,
		providerKey?: string,
	) => {
		setPendingSwarmMembers((prev) => {
			if (prev.some((member) => member.roleName === roleName)) return prev;
			const resolvedProviderKey =
				providerKey ?? profileId ?? undefined;
			return [
				...prev,
				{ roleName, model, profileId, providerKey: resolvedProviderKey },
			];
		});
	};

	/** Commit a single new member to an existing workspace. Used by the
	 * "add to existing swarm" flow in CreateSessionDialog. */
	const handleCommitAddMember = async (
		workingDir: string | null,
		roleName: string,
		model: string,
		providerKey?: string,
	): Promise<string | null> => {
		try {
			const workspaceId = workspaceIdFromDir(workingDir);
			const newId = await invoke<string>("add_swarm_member", {
				workingDir,
				roleName,
				model: model || null,
				providerKey: providerKey ?? null,
				memoryEnabled: true,
			});
			await listSessions();
			await openWorkspaceConversation(workspaceId, undefined, "swarm");
			return newId;
		} catch (e) {
			console.error("Add swarm member failed:", e);
			alert(`Failed to add swarm member: ${String(e)}`);
			return null;
		}
	};

	const handleRemoveSwarmMember = (roleName: string) => {
		setPendingSwarmMembers((prev) =>
			prev.filter((member) => member.roleName !== roleName),
		);
	};

	/** Open the create dialog pre-set to swarm mode for the current workspace. */
	const handleAddAgentToWorkspace = () => {
		setCreateDialogInitMode("addMember");
		setCreateDialogOpen(true);
	};

	/** Toggle swarm mode for a workspace. */


	/** Remove an individual agent session from the workspace after confirmation. */


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
			return findWorkspaceTargetSession(workspaceId)?.sessionId;
		}
		if (selectedConvId) {
			return selectedConvId;
		}
		return (
			state.sessionId ||
			findWorkspaceTargetSession(currentWorkspaceId)?.sessionId
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

		// @AgentName routing: only when viewing the swarm thread.
		// In that case @mention is sent through the coordinator so it stays
		// aware of all delegations. Normal sessions send directly.
		if (targetSessionId && selectedConvId?.startsWith("workspace:")) {
			// Allow hyphens, underscores and alphanumerics in role names
			const mentionMatch = content.match(/^@([a-zA-Z0-9_-]+)(?:\s|$)/);
			if (mentionMatch) {
				const mentionedName = mentionMatch[1].toLowerCase();
				const wsSessions = getWorkspaceSessions(currentWorkspaceId);
				const agentSession = wsSessions.find(
					(s) => s.roleName?.toLowerCase() === mentionedName,
				);
				if (agentSession) {
					// Ensure the agent session is connected so coordinator can
					// delegate to it, but do NOT switch targetSessionId — the
					// message still goes to coordinator.
					if (
						state.sessionData[agentSession.sessionId]?.connectionPhase !==
						"connected"
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

	const handleRegenerateMessage = async (frontendIndex: number) => {
		if (selectedConvId?.startsWith("workspace:")) {
			// Workspace threads are merged from multiple sessions;
			// regeneration is not supported yet.
			return;
		}
		const targetSessionId = resolveTargetSessionId();
		if (!targetSessionId) return;

		const sessionMsgs = state.sessionData[targetSessionId]?.messages || [];
		const assistantMsg = sessionMsgs[frontendIndex];
		if (!assistantMsg || assistantMsg.role !== "assistant") return;

		// Find the preceding user message
		let userMsgIndex = -1;
		for (let i = frontendIndex - 1; i >= 0; i--) {
			if (sessionMsgs[i]?.role === "user") {
				userMsgIndex = i;
				break;
			}
		}
		if (userMsgIndex === -1) return;

		// Compute 1-based visible conversation count up to the user message
		let visibleCount = 0;
		for (let i = 0; i <= userMsgIndex; i++) {
			const role = sessionMsgs[i]?.role;
			if (role === "user" || role === "assistant") {
				visibleCount += 1;
			}
		}

		// Rewind to remove the user message and the assistant message
		await rewindChat(visibleCount, targetSessionId);

		// Re-send the user message content
		const userMsg = sessionMsgs[userMsgIndex];
		const images: [string, string][] | undefined = userMsg.images?.map(
			(img) => [img.mediaType, img.base64Data || ""],
		);
		await sendMessage(userMsg.content, images, targetSessionId);
	};

	const handleEditMessage = async (frontendIndex: number, newContent: string) => {
		if (selectedConvId?.startsWith("workspace:")) {
			// Workspace threads are merged from multiple sessions;
			// editing is not supported yet.
			return;
		}
		const targetSessionId = resolveTargetSessionId();
		if (!targetSessionId) return;

		const sessionMsgs = state.sessionData[targetSessionId]?.messages || [];
		const userMsg = sessionMsgs[frontendIndex];
		if (!userMsg || userMsg.role !== "user") return;

		// Compute 1-based visible conversation count up to the user message
		let visibleCount = 0;
		for (let i = 0; i < frontendIndex; i++) {
			const role = sessionMsgs[i]?.role;
			if (role === "user" || role === "assistant") {
				visibleCount += 1;
			}
		}

		// Rewind to remove the user message and everything after it
		await rewindChat(visibleCount, targetSessionId);

		// Send the edited content
		const images: [string, string][] | undefined = userMsg.images?.map(
			(img) => [img.mediaType, img.base64Data || ""],
		);
		await sendMessage(newContent, images, targetSessionId);
	};

	const handleQuoteMessage = (content: string, role: string) => {
		const quoted = `> **${role === "user" ? "You" : "Assistant"}**:\n> ${content.split("\n").join("\n> ")}\n\n`;
		// Pre-fill the input area with the quote
		// We need to access the ChatArea's textarea — use a custom event
		window.dispatchEvent(
			new CustomEvent("jcode:prefill-input", { detail: quoted }),
		);
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
		if (!selectedConvId) return [];
		if (selectedConvId.startsWith("workspace:")) {
			const workspaceId = selectedConvId.slice("workspace:".length);
			const virtualSessionId = `workspace:${workspaceId}`;
			return state.sessionData[virtualSessionId]?.messages || [];
		}
		return state.sessionData[selectedConvId]?.messages || [];
	}, [selectedConvId, state.sessionData]);

	const displayIsProcessing = useMemo(() => {
		if (!selectedConvId) return false;
		if (selectedConvId.startsWith("workspace:")) {
			return respondingRoles.length > 0;
		}
		return state.sessionData[selectedConvId]?.isProcessing ?? false;
	}, [respondingRoles, selectedConvId, state.sessionData]);

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

	// Launcher → workbench bridge.
	//
	// The launcher window emits events of the form `launcher:open-<kind>`
	// with a payload describing the requested action. We listen for them
	// here (in the workbench window) and dispatch the corresponding
	// state changes. The launcher uses `expand_to_workbench` to hide
	// itself and raise the workbench before the event fires.
	useEffect(() => {
		const unlisteners: Array<Promise<() => void>> = [];

		unlisteners.push(
			listen<{ kind?: string; sessionId?: string }>(
				"launcher:open-session",
				(event) => {
					const sessionId = event.payload?.sessionId;
					if (!sessionId) return;
					const session = state.sessions.find(
						(s) => s.sessionId === sessionId,
					);
					if (!session) return;
					handleResume(session);
				},
			),
		);

		// Builtin pages (settings / providers / mcp / skills / team) now
		// open in the dedicated pages window via `open_pages_window`.
		// The workbench no longer hosts these pages inline.
		unlisteners.push(
			listen<{ kind?: string; page?: BuiltinPage }>(
				"launcher:open-builtin",
				(event) => {
					const page = event.payload?.page;
					if (!page) return;
					void invoke("open_pages_window", { page });
				},
			),
		);

		unlisteners.push(
			listen<{ kind?: string; query?: string }>(
				"launcher:open-agent",
				(event) => {
					const query = (event.payload?.query ?? "").trim();
					if (!query) return;
					void handleSendMessage(query);
				},
			),
		);

		return () => {
			for (const unlistenPromise of unlisteners) {
				void unlistenPromise.then((unlisten) => unlisten());
			}
		};
		// We intentionally re-subscribe when the session list changes so
		// lookups in the handler pick up the freshest list.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.sessions, handleSendMessage, handleResume, setActiveNavTab]);

	// Show onboarding if not completed
	if (!onboardingComplete) {
		return (
			<WelcomeScreen
				onComplete={handleOnboardingComplete}
				availableModels={state.availableModels}
			/>
		);
	}

	return (
		<div className="h-screen bg-background flex flex-col overflow-hidden">
			<TitleBar />
			<div className="flex flex-1 overflow-hidden min-w-0">
				<LeftSidebar
					activeTab={activeNavTab}
					onOpenLauncher={() => void invoke("show_launcher")}
					onOpenPage={(page) => void invoke("open_pages_window", { page })}
					onNewTask={() => {
						setCreateDialogInitMode("normal");
						setCreateDialogOpen(true);
					}}
					sessions={state.sessions}
					activeSessionId={state.sessionId}
					onSelectSession={(s) => {
						const wsid = workspaceIdFromDir(s.workingDir);
						setActiveWorkspace(wsid);
						setWorkingDir(s.workingDir || null);
						if (selectedConvId !== s.sessionId) {
							setSelectedConvId(s.sessionId);
						}
						setLastReadAt((prev) => ({ ...prev, [s.sessionId]: Date.now() }));
						if (state.sessionId === s.sessionId) return;
						const sd = state.sessionData[s.sessionId];
						if (sd?.connectionPhase === "connected") {
							switchSession(s.sessionId);
						} else {
							void resumeSession(s.sessionId, s.workingDir || null);
						}
					}}
					sessionPreviewMap={sessionPreviewMap}
				/>

				{isChatTab ? (
					<>
						<ChatArea
							messages={displayMessages}
							isProcessing={displayIsProcessing}
							isLoading={displayIsLoading}
							connected={state.connected}
							totalTokens={
								selectedConvId
									? (state.sessionData[selectedConvId]?.totalTokens ?? null)
									: null
							}
							onSend={handleSendMessage}
							onCancel={() => cancel(resolveTargetSessionId() || undefined)}
							channelName={channelName}
							channelMembers={channelMembers}
							onRenameSession={renameSession}
							currentSessionId={
								selectedConvId?.startsWith("workspace:")
									? undefined
									: selectedConvId
							}
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
								void setModel(m, pid, resolveTargetSessionId() || undefined)
							}
							onSetAgentModel={(sid, m, pid) => void setModel(m, pid, sid)}
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
							onRunDictation={runDictation}
							onSendSoftInterrupt={async (content) => {
								const sid = resolveTargetSessionId();
								if (sid) await sendSoftInterrupt(content, sid);
							}}
							onRegenerateMessage={handleRegenerateMessage}
							onEditMessage={handleEditMessage}
							onQuoteMessage={handleQuoteMessage}
							currentWorkingDir={state.workingDir}
							onExecuteShellCommand={executeShellCommandAndDisplay}
						/>
						<RightSidebar
							snapshot={
								selectedConvId
									? (state.sessionData[selectedConvId]?.sidePanel ?? null)
									: null
							}
							consultantFiles={[]}
							skillFiles={[]}
							open={sidePanelOpen}
							onToggle={() => setSidePanelOpen((o) => !o)}
						/>
					</>
				) : (
					<div key={activeNavTab} className="animate-fade-in flex-1 flex min-w-0">
						{activeNavTab === "settings" ? (
							<SettingsPage
								theme={effectiveTheme}
								onThemeChange={setTheme}
								onExportMemories={exportMemories}
								onImportMemories={importMemories}
								onSearchMemories={searchMemories}
								onGetMemoryList={getMemoryList}
								onGetMemoryStats={getMemoryStats}
								onGetMemoryGraph={getMemoryGraph}
								onGetWorkspaceMemoryPreferences={getWorkspaceMemoryPreferences}
								onSetWorkspaceMemoryPreference={setWorkspaceMemoryPreference}
							/>
						) : activeNavTab === "network" ? (
							<ProviderConfigPage
								onAuthStatusChange={() => listSessions()}
								onGetUsageInfo={getUsageInfo}
							/>
						) : activeNavTab === "tasks" ? (
							<TasksPage />
						) : activeNavTab === "monitor" ? (
							<MonitorPage />
						) : activeNavTab === "team" ? (
							<TeamPage sessions={state.sessions} availableModels={state.availableModels} />
						) : activeNavTab === "media" ? (
							<MediaPage sessionData={state.sessionData} />
						) : activeNavTab === "mcp" ? (
							<McpPage />
						) : activeNavTab === "skills" ? (
							<SkillsPage />
						) : (
							<PlaceholderPage
								key={activeNavTab}
								icon={activeNavTab}
								title={placeholderTitle(activeNavTab)}
								description={placeholderDesc(activeNavTab)}
							/>
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
				onCommitAddMember={handleCommitAddMember}
				existingSwarmMembers={state.sessions
					.filter(
						(session) =>
							workspaceIdFromDir(session.workingDir) === currentWorkspaceId,
					)
					.map((session) => ({
						roleName: session.roleName ?? session.title ?? session.sessionId.slice(0, 8),
						model: null,
						providerKey: null,
					}))}
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
			<PermissionDialog
				requests={permissionRequests}
				onRespond={async (id, approved, message) => {
					try {
						await invoke("respond_to_permission", {
							requestId: id,
							approved,
							message: message || null,
						});
						setPermissionRequests((prev) => prev.filter((r) => r.id !== id));
					} catch (e) {
						console.error("Permission response failed:", e);
					}
				}}
			/>
			<ShortcutsHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
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
			? PlayIcon
			: icon === "tasks"
				? ListTodo
				: icon === "monitor"
					? Monitor
					: icon === "team"
						? Users
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

import { PlayIcon, ListTodo, Monitor, Users } from "lucide-react";
