import { useReducer, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { processEvent } from "./processEvent";
import { sessionReducer, initialSessionState } from "./sessionReducer";
import type { ChatMessage, QueuedDraft } from "@/types";

function createQueuedDraft(
	content: string,
	images?: [string, string][],
): QueuedDraft {
	return {
		id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		content,
		images,
	};
}

export function useJcodeSession() {
	const [state, dispatch] = useReducer(sessionReducer, initialSessionState());

	useEffect(() => {
		listSessions();
	}, []);

	const stateRef = useRef(state);
	stateRef.current = state;

	/**
	 * Unified workspace-event listener: backend is the single source of truth
	 * for what appears in the virtual workspace thread. Replaces the previous
	 * three-way frontend mirroring (performSend, queueMessage, server-event).
	 */
	useEffect(() => {
		const unlisten = listen<Record<string, unknown>>(
			"workspace-event",
			(event) => {
				const payload = event.payload as Record<string, unknown>;
				const workspaceId = payload.workspace_id as string | undefined;
				const sourceSessionId = payload.source_session_id as string | undefined;
				if (!workspaceId) return;
				const virtualSessionId = `workspace:${workspaceId}`;
				const session = stateRef.current.sessions.find(
					(s) => s.sessionId === sourceSessionId,
				);
				const type = payload.type as string | undefined;
				if (type === "user_message") {
					const content = (payload.content as string) || "";
					const images = payload.images as
						| import("@/types").AttachedImage[]
						| undefined;
					dispatch({
						type: "ADD_USER_MESSAGE",
						content,
						images,
						sessionId: virtualSessionId,
					});
					return;
				}
				// For all other events, route through processEvent so the
				// virtual thread gets the same stream updates as the source
				// session.
				processEvent(
					payload as unknown as import("@/types").ServerEvent,
					dispatch,
					virtualSessionId,
					true,
					sourceSessionId,
					session?.roleName,
				);
			},
		);
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	useEffect(() => {
		const unlisten = listen<Record<string, unknown>>(
			"server-event",
			(event) => {
				const payload =
					event.payload as unknown as import("@/types").ServerEvent & {
						session_id?: string;
					};
				const sessionId = payload.session_id;
				processEvent(payload, dispatch, sessionId);

				// In swarm/workspace mode, also clear the virtual session
				if (payload.type === "clear_chat" && sessionId) {
					const session = stateRef.current.sessions.find(
						(s) => s.sessionId === sessionId,
					);
					const workspaceId = session?.workingDir;
					if (workspaceId && workspaceId !== "default") {
						dispatch({
							type: "CLEAR_CHAT",
							sessionId: `workspace:${workspaceId}`,
						});
					}
				}
			},
		);
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	const performSend = useCallback(
		async (
			content: string,
			images?: [string, string][],
			sessionId?: string,
		) => {
			if (!content.trim() && (!images || images.length === 0)) return;
			const imageAttachments = images?.map(([m, d], i) => ({
				id: `img-${Date.now()}-${i}`,
				mediaType: m,
				base64Data: d,
			}));
			dispatch({
				type: "ADD_USER_MESSAGE",
				content: content.trim() || "(image)",
				images: imageAttachments,
				sessionId,
			});
			// Backend now emits workspace-event for unified virtual-thread
			// updates; no frontend mirroring needed.
			try {
				await invoke("send_message", {
					content,
					images: images || null,
					systemReminder: null,
					sessionId,
				});
			} catch (e) {
				// eslint-disable-next-line no-console
				console.error("[performSend] invoke error:", e);
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const connect = useCallback(
		async (
			workingDir: string | null,
			model?: string,
			memoryEnabled?: boolean,
			roleName?: string,
			profileId?: string,
		) => {
			dispatch({ type: "SET_CONNECTING" });
			try {
				return await invoke<string>("begin_session", {
					workingDir,
					model: model || null,
					memoryEnabled: memoryEnabled ?? true,
					roleName: roleName || null,
					profileId: profileId || null,
				});
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return null;
			}
		},
		[],
	);

	const createRoleSession = useCallback(
		async (
			workingDir: string | null,
			roleName: string,
			model?: string,
			memoryEnabled?: boolean,
			profileId?: string,
		) => {
			dispatch({ type: "SET_CONNECTING" });
			try {
				return await invoke<string>("begin_session", {
					workingDir,
					model: model || null,
					memoryEnabled: memoryEnabled ?? true,
					roleName,
					profileId: profileId || null,
				});
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return null;
			}
		},
		[],
	);

	const resumeSession = useCallback(
		async (sessionId: string, workingDir: string | null) => {
			dispatch({ type: "SET_CONNECTING" });
			try {
				await invoke("resume_session", { sessionId, workingDir });
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
			}
		},
		[],
	);

	const switchSession = useCallback((sessionId: string) => {
		dispatch({ type: "SET_SESSION_ID", sessionId });
	}, []);

	const sendMessage = useCallback(
		async (
			content: string,
			images?: [string, string][],
			sessionId?: string,
		) => {
			await performSend(content, images, sessionId);
		},
		[performSend],
	);

	const queueMessage = useCallback(
		(content: string, images?: [string, string][], sessionId?: string) => {
			if (!content.trim() && (!images || images.length === 0)) return;
			const draft = createQueuedDraft(content, images);
			dispatch({ type: "QUEUE_DRAFT", draft, sessionId });
			dispatch({
				type: "ADD_SYSTEM_MESSAGE",
				content: `📝 Queued prompt (${state.queuedDrafts.length + 1} pending)`,
				sessionId,
			});
			// Backend workspace-event handles virtual-thread updates;
			// no frontend mirroring needed for queued drafts.
		},
		[state.queuedDrafts.length],
	);

	const sendSoftInterrupt = useCallback(
		async (content: string, sessionId?: string) => {
			try {
				await invoke("send_soft_interrupt", {
					sessionId,
					content,
					urgent: false,
				});
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const exportMemories = useCallback(async (path: string) => {
		try {
			await invoke("export_memories", { path });
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
		}
	}, []);

	const importMemories = useCallback(async (path: string) => {
		try {
			return (await invoke("import_memories", { path })) as {
				project_count: number;
				global_count: number;
			};
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const cancel = useCallback(async (sessionId?: string) => {
		try {
			await invoke("cancel", { sessionId });
			dispatch({ type: "INTERRUPTED", sessionId });
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e), sessionId });
		}
	}, []);

	const setModel = useCallback(
		async (model: string, profileId?: string, sessionId?: string) => {
			try {
				await invoke("set_model", {
					model,
					profileId: profileId || null,
					sessionId,
				});
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const setMemoryEnabled = useCallback(
		async (enabled: boolean, sessionId?: string) => {
			try {
				await invoke("set_memory_enabled", { enabled, sessionId });
				dispatch({ type: "SET_MEMORY_ENABLED", enabled, sessionId });
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const listSessions = useCallback(async () => {
		try {
			const data =
				await invoke<
					Array<{
						id: string;
						title: string;
						subtitle?: string;
						detail?: string;
						preview_lines?: string[];
						detail_lines?: string[];
						model?: string;
						provider?: string;
						status: string;
						working_dir?: string;
						role_name?: string;
						swarm_id?: string;
						swarm_enabled?: boolean;
						swarm_peer_count?: number;
						swarm_role?: "coordinator" | "agent";
						swarm_plan?: {
							swarm_id: string;
							version: number;
							item_count: number;
							participant_ids?: string[];
							participant_count?: number;
							reason?: string;
							ready_count: number;
							active_count: number;
							blocked_count: number;
							completed_count: number;
							next_ready_ids?: string[];
							items_preview?: Array<{
								id: string;
								content: string;
								status: string;
								priority: string;
								assigned_to?: string;
								subsystem?: string;
								blocked_by?: string[];
								file_scope?: string[];
							}>;
						};
						swarm_proposal?: {
							swarm_id: string;
							proposer_session: string;
							proposer_name?: string;
							summary: string;
							proposal_key: string;
							item_count: number;
							items_preview?: Array<{
								id: string;
								content: string;
								status: string;
								priority: string;
								assigned_to?: string;
								subsystem?: string;
								blocked_by?: string[];
								file_scope?: string[];
							}>;
						};
						live_processing?: boolean;
						live_tool_name?: string;
						live_status_detail?: string;
						live_phase?: "thinking" | "tool" | "chunking" | "waiting" | "idle";
						server_managed?: boolean;
						server_name?: string;
						server_icon?: string;
					}>
				>("list_sessions");
			const sessions = data.map((d) => ({
				sessionId: d.id,
				title: d.title || makeTitle(d.id),
				isActive: d.id === state.sessionId,
				subtitle: d.subtitle,
				detail: d.detail,
				previewLines: d.preview_lines,
				detailLines: d.detail_lines,
				model: d.model,
				provider: d.provider,
				status: d.status,
				workingDir: d.working_dir,
				roleName: d.role_name,
				swarmId: d.swarm_id,
				swarmEnabled: d.swarm_enabled,
				swarmPeerCount: d.swarm_peer_count,
				swarmRole: d.swarm_role,
				swarmPlan: d.swarm_plan
					? {
							swarmId: d.swarm_plan.swarm_id,
							version: d.swarm_plan.version,
							itemCount: d.swarm_plan.item_count,
							participantIds: d.swarm_plan.participant_ids || [],
							participantCount:
								d.swarm_plan.participant_count ||
								d.swarm_plan.participant_ids?.length ||
								0,
							reason: d.swarm_plan.reason,
							readyCount: d.swarm_plan.ready_count,
							activeCount: d.swarm_plan.active_count,
							blockedCount: d.swarm_plan.blocked_count,
							completedCount: d.swarm_plan.completed_count,
							nextReadyIds: d.swarm_plan.next_ready_ids || [],
							itemsPreview: (d.swarm_plan.items_preview || []).map((item) => ({
								id: item.id,
								content: item.content,
								status: item.status,
								priority: item.priority,
								assignedTo: item.assigned_to,
								subsystem: item.subsystem,
								blockedBy: item.blocked_by,
								fileScope: item.file_scope,
							})),
						}
					: undefined,
				swarmProposal: d.swarm_proposal
					? {
							swarmId: d.swarm_proposal.swarm_id,
							proposerSession: d.swarm_proposal.proposer_session,
							proposerName: d.swarm_proposal.proposer_name,
							summary: d.swarm_proposal.summary,
							proposalKey: d.swarm_proposal.proposal_key,
							itemCount: d.swarm_proposal.item_count,
							itemsPreview: (d.swarm_proposal.items_preview || []).map(
								(item) => ({
									id: item.id,
									content: item.content,
									status: item.status,
									priority: item.priority,
									assignedTo: item.assigned_to,
									subsystem: item.subsystem,
									blockedBy: item.blocked_by,
									fileScope: item.file_scope,
								}),
							),
						}
					: undefined,
				liveProcessing: d.live_processing,
				liveToolName: d.live_tool_name,
				liveStatusDetail: d.live_status_detail,
				livePhase: d.live_phase,
				serverManaged: d.server_managed,
				serverName: d.server_name,
				serverIcon: d.server_icon,
			}));
			dispatch({
				type: "SET_SESSIONS",
				sessions,
			});
			// Auto-expand workspaces that have the active session
			const activeSession = sessions.find((s) => s.isActive);
			dispatch({
				type: "SET_ACTIVE_WORKSPACE",
				workspaceId: activeSession?.workingDir || "default",
			});
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
		}
	}, [state.sessionId]);

	const loadWorkspaceThreadHistory = useCallback(
		async (workingDir: string | null) => {
			try {
				const data = await invoke<
					Array<{
						id: string;
						role: "user" | "assistant" | "system" | string;
						content: string;
						tool_executions?: import("@/types").ToolExecution[];
						is_streaming?: boolean;
						images?: Array<{
							media_type: string;
							data?: string;
							base64_data?: string;
							label?: string;
							path?: string;
						}>;
						timestamp?: number | null;
						role_name?: string | null;
						role_session_id?: string | null;
					}>
				>("get_workspace_thread_history", { workingDir });
				return data.map(
					(message, index) =>
						({
							id: message.id || `workspace-history-${index}`,
							role:
								message.role === "user" ||
								message.role === "assistant" ||
								message.role === "system"
									? message.role
									: "system",
							content: message.content,
							toolExecutions: message.tool_executions || [],
							isStreaming: message.is_streaming ?? false,
							images: message.images?.map((image, imageIndex) => ({
								id: `${message.id}-img-${imageIndex}`,
								mediaType: image.media_type,
								base64Data: image.base64_data || image.data,
								filePath: image.path,
								label: image.label,
							})),
							timestamp: message.timestamp ?? undefined,
							roleName: message.role_name ?? undefined,
							roleSessionId: message.role_session_id ?? undefined,
						}) satisfies ChatMessage,
				);
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return [] as ChatMessage[];
			}
		},
		[],
	);

	const sendStdinResponse = useCallback(
		async (requestId: string, input: string, sessionId?: string) => {
			dispatch({
				type: "ADD_SYSTEM_MESSAGE",
				content: "⌨️ Sending interactive input",
				sessionId,
			});
			try {
				await invoke("send_stdin_response", { requestId, input, sessionId });
				dispatch({ type: "STDIN_DONE", sessionId });
				dispatch({
					type: "ADD_SYSTEM_MESSAGE",
					content: "⌨️ Interactive input sent",
					sessionId,
				});
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const setWorkingDir = useCallback((dir: string | null) => {
		dispatch({ type: "SET_WORKING_DIR", dir });
	}, []);

	const deleteSession = useCallback(
		async (sessionId: string) => {
			try {
				await invoke("delete_session", { sessionId });
				await listSessions();
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				throw e;
			}
		},
		[listSessions],
	);

	const renameSession = useCallback(
		async (sessionId: string, title: string) => {
			try {
				await invoke("rename_session", { sessionId, title });
				await listSessions();
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				throw e;
			}
		},
		[listSessions],
	);

	const deleteWorkspaceSessions = useCallback(
		async (workingDir: string | null) => {
			try {
				await invoke("delete_workspace_sessions", { workingDir });
				await listSessions();
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				throw e;
			}
		},
		[listSessions],
	);

	const clearChat = useCallback(async (sessionId?: string) => {
		try {
			await invoke("clear_chat", { sessionId });
			dispatch({ type: "CLEAR_CHAT", sessionId });
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e), sessionId });
		}
	}, []);

	const rewindChat = useCallback(
		async (messageIndex: number, sessionId?: string) => {
			try {
				await invoke("rewind_chat", { messageIndex, sessionId });
				dispatch({ type: "REWIND_CHAT", messageIndex, sessionId });
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const setReasoningEffort = useCallback(
		async (effort: string, sessionId?: string) => {
			try {
				await invoke("set_reasoning_effort", { effort, sessionId });
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e), sessionId });
			}
		},
		[],
	);

	const compactContext = useCallback(async (sessionId?: string) => {
		try {
			await invoke("compact_context", { sessionId });
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e), sessionId });
		}
	}, []);

	const setActiveWorkspace = useCallback((workspaceId: string | null) => {
		dispatch({ type: "SET_ACTIVE_WORKSPACE", workspaceId });
	}, []);

	const toggleWorkspace = useCallback((workspaceId: string) => {
		dispatch({ type: "TOGGLE_WORKSPACE", workspaceId });
	}, []);

	useEffect(() => {
		if (
			state.isProcessing ||
			!state.connected ||
			state.stdinPrompt ||
			state.queuedDrafts.length === 0
		) {
			return;
		}

		const nextDraft = state.queuedDrafts[0];
		if (!nextDraft) return;

		dispatch({
			type: "DEQUEUE_DRAFT",
			draftId: nextDraft.id,
			sessionId: state.sessionId || undefined,
		});
		dispatch({
			type: "ADD_SYSTEM_MESSAGE",
			content: `▶ Sending queued prompt (${state.queuedDrafts.length - 1} remaining)`,
			sessionId: state.sessionId || undefined,
		});
		void performSend(
			nextDraft.content,
			nextDraft.images,
			state.sessionId || undefined,
		);
	}, [
		state.isProcessing,
		state.connected,
		state.stdinPrompt,
		state.queuedDrafts,
		performSend,
		state.sessionId,
	]);

	const setWorkspaceMode = useCallback(
		(
			workspaceId: string,
			mode: "normal" | "swarm",
			initialMessages?: ChatMessage[],
		) => {
			dispatch({
				type: "SET_WORKSPACE_MODE",
				workspaceId,
				mode,
				initialMessages,
			});
		},
		[],
	);

	const addWorkspaceMessage = useCallback(
		(_workspaceId: string, _message: ChatMessage) => {
			// 已废弃：消息通过 processEvent 镜像到虚拟 session
		},
		[],
	);

	const clearWorkspaceMessages = useCallback((workspaceId: string) => {
		dispatch({ type: "CLEAR_WORKSPACE_MESSAGES", workspaceId });
	}, []);

	const setError = useCallback((message: string, sessionId?: string) => {
		dispatch({ type: "SET_ERROR", message, sessionId });
	}, []);

	const listBackgroundTasks = useCallback(async () => {
		try {
			return (
				(await invoke<import("@/types").BackgroundTask[]>(
					"list_background_tasks",
				)) || []
			);
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return [];
		}
	}, []);

	const cancelBackgroundTask = useCallback(async (taskId: string) => {
		try {
			return await invoke<boolean>("cancel_background_task", { taskId });
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return false;
		}
	}, []);

	const runAuthDoctor = useCallback(async () => {
		try {
			return await invoke<import("@/types").AuthDoctorReport>(
				"run_auth_doctor",
			);
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const runAuthTest = useCallback(async (providerId?: string) => {
		try {
			return await invoke<import("@/types").AuthTestResult>("run_auth_test", {
				providerId: providerId || null,
			});
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const getPermissionRequests = useCallback(async () => {
		try {
			const result = await invoke<{
				requests: import("@/types").PermissionRequest[];
			}>("get_permission_requests");
			return result.requests || [];
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return [];
		}
	}, []);

	const respondToPermission = useCallback(
		async (requestId: string, approved: boolean, message?: string) => {
			try {
				await invoke("respond_to_permission", {
					requestId,
					approved,
					message: message || null,
				});
				return true;
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return false;
			}
		},
		[],
	);

	const triggerAmbient = useCallback(async () => {
		try {
			await invoke("trigger_ambient");
			return true;
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return false;
		}
	}, []);

	const stopAmbient = useCallback(async () => {
		try {
			await invoke("stop_ambient");
			return true;
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return false;
		}
	}, []);

	const addProviderProfile = useCallback(
		async (params: {
			name: string;
			base_url: string;
			model: string;
			api_key?: string;
			auth?: string;
		}) => {
			try {
				return await invoke<import("@/types").ProviderSetupReport>(
					"add_provider_profile",
					params,
				);
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return null;
			}
		},
		[],
	);

	const sendTranscript = useCallback(
		async (text: string, mode: import("@/types").TranscriptMode = "send") => {
			try {
				await invoke("send_transcript", { text, mode });
				return true;
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return false;
			}
		},
		[],
	);

	const getBrowserStatus = useCallback(async () => {
		try {
			return await invoke<import("@/types").BrowserStatus>(
				"get_browser_status",
			);
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const setupBrowser = useCallback(async () => {
		try {
			return await invoke<string>("setup_browser");
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const runDictation = useCallback(async () => {
		try {
			return await invoke<{
				text: string;
				mode: import("@/types").TranscriptMode;
			}>("run_dictation");
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);
	const saveSessionState = useCallback(
		async (sessionId: string, workingDir: string | null) => {
			try {
				await invoke("save_session_state", { sessionId, workingDir });
			} catch {
				// ignore
			}
		},
		[],
	);

	const searchMemories = useCallback(
		async (query: string, semantic = false) => {
			try {
				return (
					(
						await invoke<{
							results: import("@/types").MemoryEntry[];
						}>("search_memories", { query, semantic })
					)?.results ?? []
				);
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return [];
			}
		},
		[],
	);

	const getMemoryList = useCallback(
		async (scope: "all" | "project" | "global" = "all", tag?: string) => {
			try {
				return (
					(
						await invoke<{
							memories: import("@/types").MemoryEntry[];
						}>("get_memory_list", { scope, tag: tag || null })
					)?.memories ?? []
				);
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
				return [];
			}
		},
		[],
	);

	const getMemoryStats = useCallback(async () => {
		try {
			return await invoke<import("@/types").MemoryStats>("get_memory_stats");
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const getMemoryGraph = useCallback(async () => {
		try {
			return await invoke<import("@/types").MemoryGraphSnapshot>(
				"get_memory_graph",
			);
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const getUsageInfo = useCallback(async () => {
		try {
			return (
				(await invoke<import("@/types").UsageInfo>("get_usage_info")) ?? {
					providers: [],
				}
			);
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return { providers: [] };
		}
	}, []);

	const getVersionInfo = useCallback(async () => {
		try {
			return await invoke<import("@/types").VersionInfo>("get_version_info");
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const getWorkspaceMemoryPreferences = useCallback(async () => {
		try {
			return await invoke<import("@/types").WorkspaceMemoryPreferences>(
				"get_workspace_memory_preferences",
			);
		} catch (e) {
			dispatch({ type: "SET_ERROR", message: String(e) });
			return null;
		}
	}, []);

	const setWorkspaceMemoryPreference = useCallback(
		async (workingDir: string | null, enabled: boolean) => {
			try {
				await invoke("set_workspace_memory_preference", {
					workingDir: workingDir ?? null,
					enabled,
				});
			} catch (e) {
				dispatch({ type: "SET_ERROR", message: String(e) });
			}
		},
		[],
	);

	const getLastSessionState = useCallback(async () => {
		try {
			return await invoke<{
				session_id: string;
				working_dir: string | null;
			} | null>("get_last_session_state");
		} catch {
			return null;
		}
	}, []);

	const clearSessionState = useCallback(async () => {
		try {
			await invoke("clear_session_state");
		} catch {
			// ignore
		}
	}, []);

	const gitStatus = useCallback(async (workingDir?: string | null) => {
		try {
			return await invoke<string>("git_status", {
				workingDir: workingDir ?? null,
			});
		} catch (e) {
			return String(e);
		}
	}, []);

	const executeShellCommand = useCallback(
		async (command: string, workingDir?: string | null) => {
			return await invoke<{
				command: string;
				output: string;
				exitCode: number | null;
				durationMs: number;
			}>("execute_shell_command", {
				command,
				workingDir: workingDir ?? null,
			});
		},
		[],
	);

	const executeShellCommandAndDisplay = useCallback(
		async (command: string, workingDir?: string | null, sessionId?: string) => {
			dispatch({
				type: "ADD_USER_MESSAGE",
				content: `!${command}`,
				sessionId,
			});
			try {
				const result = await invoke<{
					command: string;
					output: string;
					exitCode: number | null;
					durationMs: number;
				}>("execute_shell_command", {
					command,
					workingDir: workingDir ?? null,
				});
				const exitInfo =
					result.exitCode !== null ? `exit ${result.exitCode}` : "done";
				const display = `$ ${result.command}\n${result.output}\n[${exitInfo} in ${result.durationMs}ms]`;
				dispatch({
					type: "ADD_SYSTEM_MESSAGE",
					content: display,
					sessionId,
				});
			} catch (e) {
				dispatch({
					type: "ADD_SYSTEM_MESSAGE",
					content: `$ ${command}\nError: ${String(e)}`,
					sessionId,
				});
			} finally {
				dispatch({ type: "SET_PROCESSING", value: false, sessionId });
			}
		},
		[],
	);

	return {
		state,
		connect,
		createRoleSession,
		resumeSession,
		switchSession,
		sendMessage,
		queueMessage,
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
		renameSession,
		setActiveWorkspace,
		toggleWorkspace,
		setWorkspaceMode,
		loadWorkspaceThreadHistory,
		addWorkspaceMessage,
		clearWorkspaceMessages,
		exportMemories,
		importMemories,
		listBackgroundTasks,
		cancelBackgroundTask,
		runAuthDoctor,
		runAuthTest,
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
		clearSessionState,
		gitStatus,
		setError,
		searchMemories,
		getMemoryList,
		getMemoryStats,
		getMemoryGraph,
		getUsageInfo,
		getVersionInfo,
		getWorkspaceMemoryPreferences,
		setWorkspaceMemoryPreference,
		executeShellCommand,
		executeShellCommandAndDisplay,
	};
}

function makeTitle(sid: string): string {
	const s = sid.split("_").pop() || sid;
	return s.length > 6 ? s.slice(s.length - 6) : s;
}
