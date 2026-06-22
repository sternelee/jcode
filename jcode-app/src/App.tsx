import { useJcodeSession } from "@/hooks/useJcodeSession";
import { TitleBar } from "@/components/TitleBar";
import { LeftSidebar } from "@/components/LeftSidebar";
import { CreateSessionDialog } from "@/components/CreateSessionDialog";
import { StdinInputModal } from "@/components/StdinInputModal";
import { SessionSwitcherDialog } from "@/components/SessionSwitcherDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsPage } from "@/components/SettingsPage";
import { ProviderConfigPage } from "@/components/ProviderConfigPage";
import { TasksPage } from "@/components/TasksPage";
import { MonitorPage } from "@/components/MonitorPage";
import { TeamPage } from "@/components/TeamPage";
import { MediaPage } from "@/components/MediaPage";
import { McpPage } from "@/components/McpPage";
import { SkillsPage } from "@/components/SkillsPage";
import { RightSidebar } from "@/components/RightSidebar";
import { PermissionDialog } from "@/components/PermissionDialog";
import { ChatArea } from "@/components/ChatArea";
import { ShortcutsHelpModal } from "@/components/ShortcutsHelpModal";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { parseSlashCommand, profileIdFromDisplayName, profileIdFromRoute } from "@/components/SlashCommands";
import { useTheme } from "@/hooks/useTheme";
import type { SessionInfo, SkillInfo, PermissionRequest } from "@/types";
import type { BuiltinPage } from "@/lib/launcherTypes";
import {
	DEFAULT_WORKSPACE_ID,
	workspaceIdFromDir,
	workingDirFromWorkspaceId,
	workspaceLabel,
} from "@/lib/workspaces";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { PlayIcon, ListTodo, Monitor, Users } from "lucide-react";

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
		exportMemories,
		importMemories,
		searchMemories,
		getMemoryList,
		getMemoryStats,
		getMemoryGraph,
		getUsageInfo,
		getWorkspaceMemoryPreferences,
		setWorkspaceMemoryPreference,
		runDictation,
		sendSoftInterrupt,
		executeShellCommandAndDisplay,
		sendA2uiAction,
		getPermissionRequests,
		respondToPermission,
} = useJcodeSession();

	const [activeNavTab, setActiveNavTab] = useState("");
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
	const [helpOpen, setHelpOpen] = useState(false);
	const [leftCollapsed, setLeftCollapsed] = useState(false);
	const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
	const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([]);
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
		setActiveNavTab("");
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



	// Poll permission requests
	useEffect(() => {
		if (!state.connected) return;
		const interval = setInterval(async () => {
			try {
				const result = await getPermissionRequests();
				setPermissionRequests(result);
			} catch {
				/* ignore */
			}
		}, 4000);
		return () => clearInterval(interval);
	}, [state.connected, getPermissionRequests]);

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
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
				event.preventDefault();
				setCreateDialogInitMode("normal");
				setCreateDialogOpen(true);
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

		// ── /skills:xxx frontend injection ────────────────────────────────────
		const skillMatch = content.trim().match(/^\/skills:(\S+)(?:\s+(.*))?$/s);
		if (skillMatch) {
			const skillName = skillMatch[1];
			try {
				const skills = await invoke<SkillInfo[]>("list_skills");
				const skill = skills.find((s) => s.name === skillName);
				if (skill) {
					await sendMessage(content.trim(), images, targetSessionId, skill.content);
				} else {
					await sendMessage(`Skill "${skillName}" not found.`, images, targetSessionId);
				}
			} catch (e) {
				console.warn("[handleSendMessage] Failed to resolve skill:", e);
				await sendMessage(content.trim(), images, targetSessionId);
			}
			return;
		}

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




	const handleResume = (session: SessionInfo) => {
		setActiveWorkspace(workspaceIdFromDir(session.workingDir));
		setWorkingDir(session.workingDir || null);
		setActiveNavTab("");
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





	const currentProfileId = useMemo(() => {
		if (!selectedConvId) return null;
		const data = state.sessionData[selectedConvId];
		const model = data?.providerModel;
		const routes = data?.availableModelRoutes ?? [];
		if (model && routes.length > 0) {
			const route = routes.find((r) => r.model === model);
			if (route) return profileIdFromRoute(route);
		}
		const displayName = data?.providerName;
		if (displayName) {
			const fromDisplay = profileIdFromDisplayName(displayName);
			if (fromDisplay) return fromDisplay;
		}
		return null;
	}, [selectedConvId, state.sessionData]);

	// Resolve the active session data for ChatArea
	const activeSessionId = selectedConvId?.startsWith("workspace:")
		? findWorkspaceTargetSession(selectedConvId.slice("workspace:".length))?.sessionId
		: selectedConvId;
	const activeSessionData = activeSessionId ? state.sessionData[activeSessionId] : null;

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
		// Chat now lives in the launcher window; the workbench no longer
		// exposes a Chat tab, so ignore legacy "open-chat" events.

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
			<TitleBar context={state.workingDir ? workspaceLabel(workspaceIdFromDir(state.workingDir)) : null} />
			<div className="flex flex-1 overflow-hidden min-w-0">
				<LeftSidebar
					activeTab={activeNavTab}
					onOpenLauncher={() => void invoke("show_launcher")}
					onOpenPage={(page) => {
						const inline = ["skills", "tasks", "mcp", "monitor", "team", "media", "settings"];
						if (inline.includes(page)) {
							setActiveNavTab(page);
						} else {
							void invoke("open_pages_window", { page });
						}
					}}
					onNewTask={() => {
						setCreateDialogInitMode("normal");
						setCreateDialogOpen(true);
					}}
					onNewTaskInWorkspace={(workingDir) => {
						setWorkingDir(workingDir);
						setCreateDialogInitMode("normal");
						setCreateDialogOpen(true);
					}}
					onSelectWorkspace={(workspaceId) => {
						const dir = workingDirFromWorkspaceId(workspaceId);
						setActiveWorkspace(workspaceId);
						setWorkingDir(dir);
					}}
					sessions={state.sessions}
					activeSessionId={state.sessionId}
					activeWorkspaceId={state.activeWorkspaceId}
					collapsed={leftCollapsed}
					onToggleCollapse={() => setLeftCollapsed((c) => !c)}
					onSelectSession={(s) => {
						const wsid = workspaceIdFromDir(s.workingDir);
						setActiveWorkspace(wsid);
						setWorkingDir(s.workingDir || null);
						setActiveNavTab("");
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
					onDeleteSession={(sessionId) => {
						setConfirmRemove({
							sessionId,
							name: state.sessions.find((s) => s.sessionId === sessionId)?.title || sessionId.slice(0, 8),
						});
					}}
					sessionPreviewMap={sessionPreviewMap}
				/>

				<AnimatePresence mode="wait">
					<motion.div
							key={activeNavTab}
							initial={{ opacity: 0, x: 8 }}
							animate={{ opacity: 1, x: 0 }}
							exit={{ opacity: 0, x: -8 }}
							transition={{ duration: 0.15, ease: "easeOut" }}
							className="flex-1 flex min-w-0"
						>
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
							availableModels={state.availableModels}
							currentModel={
								selectedConvId
									? (state.sessionData[selectedConvId]?.providerModel || state.providerModel || undefined)
									: state.providerModel || undefined
							}
							currentProfileId={currentProfileId || undefined}
								onSetModel={(m, pid) =>
									void setModel(m, pid, state.sessionId || undefined)
								}
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
						) : activeSessionData ? (
							<ChatArea
								messages={activeSessionData.messages}
								isProcessing={activeSessionData.isProcessing}
								onSend={(content, images) => void handleSendMessage(content, images)}
								onCancel={() => void cancel(activeSessionId)}
								currentModel={activeSessionData.providerModel}
								totalTokens={activeSessionData.totalTokens}
								providerName={activeSessionData.providerName}
								currentProfileId={currentProfileId || undefined}
								memoryEnabled={activeSessionData.memoryEnabled}
								reasoningEffort={activeSessionData.reasoningEffort}
								availableModels={activeSessionData.availableModels}
								onSetModel={(m, pid) => void setModel(m, pid, activeSessionId)}
								onSetEffort={(effort) => void setReasoningEffort(effort, activeSessionId)}
								onToggleMemory={() => void setMemoryEnabled(!activeSessionData.memoryEnabled, activeSessionId)}
								onCompact={() => void compactContext(activeSessionId)}
								onClearChat={() => void clearChat(activeSessionId)}
								onRenameSession={(sid, name) => void renameSession(sid, name)}
								currentSessionId={activeSessionId}
								currentWorkingDir={state.workingDir}
								isLoading={activeSessionData.connectionPhase !== "connected"}
								connected={state.connected}
								onNewSession={() => {
									setCreateDialogInitMode("normal");
									setCreateDialogOpen(true);
								}}
								onRunDictation={runDictation}
								onSendSoftInterrupt={async (content) =>
									await sendSoftInterrupt(content, activeSessionId || undefined)
								}
								onExecuteShellCommand={executeShellCommandAndDisplay}
							/>
						) : (
							<PlaceholderPage
								key={activeNavTab || "empty"}
								icon={activeNavTab || "tasks"}
								title={placeholderTitle(activeNavTab || "tasks")}
								description={placeholderDesc(activeNavTab || "tasks")}
							/>
						)}
					</motion.div>
				</AnimatePresence>
				<RightSidebar
					snapshot={activeSessionData?.sidePanel ?? null}
					open={rightSidebarOpen}
					onToggle={() => setRightSidebarOpen((o) => !o)}
					mode="work"
					workingDir={state.workingDir}
					theme={effectiveTheme}
					onA2uiAction={(action) => void sendA2uiAction(action)}
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
					onCancel={(requestId) =>
						sendStdinResponse(requestId, "", state.sessionId || undefined)
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
			<PermissionDialog
				requests={permissionRequests}
				onRespond={(requestId, approved, message) => {
					void respondToPermission(requestId, approved, message);
					setPermissionRequests((prev) => prev.filter((r) => r.id !== requestId));
				}}
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
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.2, ease: "easeOut" }}
			className="flex-1 flex flex-col items-center justify-center bg-background"
		>
			<div className="flex flex-col items-center gap-4 max-w-md text-center px-6">
				<div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center">
					{IconComponent && (
						<IconComponent className="w-8 h-8 text-muted-foreground" />
					)}
				</div>
				<h1 className="text-xl font-semibold text-foreground">{title}</h1>
				<p className="text-sm text-muted-foreground">{description}</p>
				<p className="text-xs text-muted-foreground/60">
					This feature is coming soon. Use the launcher (⌘K) to start a
					conversation with an AI agent.
				</p>
			</div>
		</motion.div>
	);
}
