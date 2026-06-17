import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, ToolExecution } from "@/types";

// ─── Options ────────────────────────────────────────────────────────

export interface UseChatSessionOptions {
	/** Provider profile key (passed as profileId to begin_session). */
	providerKey: string;
	/** Initial model name. */
	model: string;
	/** Working directory for the session. null for rootless launcher chats. */
	workingDir?: string | null;
	/** Enable memory for this session. Defaults to true. */
	memoryEnabled?: boolean;
	/** Role name for swarm sessions. null for standalone. */
	roleName?: string | null;
	/** Force the specific provider even if the config default differs. */
	forceProvider?: boolean;
}

// ─── Internal helpers ───────────────────────────────────────────────

function createUserMessage(content: string, images?: [string, string][]): ChatMessage {
	return {
		id: `user-${Date.now()}`,
		role: "user",
		content,
		toolExecutions: [],
		isStreaming: false,
		timestamp: Date.now(),
		...(images?.length
			? {
					images: images.map(([mediaType, base64Data], i) => ({
						id: `img-${Date.now()}-${i}`,
						mediaType,
						base64Data,
					})),
				}
			: undefined),
	};
}

function createAssistantMessage(): ChatMessage {
	return {
		id: `assistant-${Date.now()}`,
		role: "assistant",
		content: "",
		reasoning: "",
		toolExecutions: [],
		isStreaming: true,
		timestamp: Date.now(),
	};
}

function upsertTool(
	toolExecutions: ToolExecution[],
	tool: Partial<ToolExecution> & { id: string },
): ToolExecution[] {
	const idx = toolExecutions.findIndex((t) => t.id === tool.id);
	if (idx === -1) {
		return [
			...toolExecutions,
			{
				id: tool.id,
				name: tool.name ?? "",
				status: tool.status ?? "starting",
				input: tool.input ?? "",
				output: tool.output,
				error: tool.error,
			},
		];
	}
	const updated = [...toolExecutions];
	updated[idx] = { ...updated[idx], ...tool };
	return updated;
}

// ─── Hook ───────────────────────────────────────────────────────────

export interface UseChatSessionReturn {
	sessionId: string | null;
	messages: ChatMessage[];
	isProcessing: boolean;
	error: string | null;
	currentModel: string;
	send: (content: string, images?: [string, string][]) => Promise<void>;
	cancel: () => Promise<void>;
	setModel: (model: string) => Promise<void>;
	reset: () => void;
}

export function useChatSession(opts: UseChatSessionOptions): UseChatSessionReturn {
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isProcessing, setIsProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [currentModel, setCurrentModel] = useState(opts.model);

	const sessionIdRef = useRef<string | null>(null);
	const currentToolIdRef = useRef<string>("");

	// Sync model when provider changes externally.
	useEffect(() => {
		setCurrentModel(opts.model);
	}, [opts.model]);

	// Keep sessionIdRef in sync.
	useEffect(() => {
		sessionIdRef.current = sessionId;
	}, [sessionId]);

	// ── Session lifecycle ──────────────────────────────────────────

	const ensureSession = useCallback(async (): Promise<string> => {
		if (sessionIdRef.current) return sessionIdRef.current;
		const sid = await invoke<string>("begin_session", {
			workingDir: opts.workingDir ?? null,
			model: currentModel,
			memoryEnabled: opts.memoryEnabled ?? true,
			roleName: opts.roleName ?? null,
			profileId: opts.providerKey,
			forceProvider: opts.forceProvider ?? false,
		});
		setSessionId(sid);
		sessionIdRef.current = sid;
		return sid;
	}, [
		currentModel,
		opts.providerKey,
		opts.workingDir,
		opts.memoryEnabled,
		opts.roleName,
		opts.forceProvider,
	]);

	// ── Actions ────────────────────────────────────────────────────

	const send = useCallback(
		async (content: string, images?: [string, string][]) => {
			const text = content.trim();
			if (!text) return;

			setMessages((prev) => [...prev, createUserMessage(text, images)]);
			setIsProcessing(true);
			setError(null);

			try {
				const sid = await ensureSession();
				await invoke("send_message", {
					sessionId: sid,
					content: text,
					images: images ?? null,
					systemReminder: null,
				});
			} catch (e) {
				setIsProcessing(false);
				setError(String(e));
			}
		},
		[ensureSession],
	);

	const cancel = useCallback(async () => {
		if (!sessionIdRef.current) return;
		try {
			await invoke("cancel", { sessionId: sessionIdRef.current });
		} catch (e) {
			console.warn("[useChatSession] cancel failed:", e);
		}
	}, []);

	const setModel = useCallback(
		async (model: string) => {
			setCurrentModel(model);
			if (!sessionIdRef.current) return;
			try {
				await invoke("set_model", {
					sessionId: sessionIdRef.current,
					model,
					profileId: opts.providerKey,
				});
			} catch (e) {
				setError(`Failed to switch model: ${e}`);
			}
		},
		[opts.providerKey],
	);

	const reset = useCallback(() => {
		setSessionId(null);
		sessionIdRef.current = null;
		setMessages([]);
		setIsProcessing(false);
		setError(null);
		setCurrentModel(opts.model);
	}, [opts.model]);

	// ── Server event listener ──────────────────────────────────────

	useEffect(() => {
		let active = true;
		const unlistenPromise = listen<Record<string, unknown>>(
			"server-event",
			(event) => {
				if (!active) return;
				const payload = event.payload;
				if (payload.session_id !== sessionIdRef.current) return;

				const type = payload.type as string | undefined;

				setMessages((prev) => {
					const msgs = [...prev];
					let last = msgs[msgs.length - 1];

					// Ensure there is an assistant message to stream into.
					if (!last || last.role !== "assistant") {
						msgs.push(createAssistantMessage());
						last = msgs[msgs.length - 1];
					}

					switch (type) {
						case "text_delta": {
							last.content += (payload.text as string) || "";
							break;
						}
						case "text_replace": {
							last.content = (payload.text as string) || "";
							break;
						}
						case "reasoning_delta": {
							last.reasoning = (last.reasoning || "") + ((payload.text as string) || "");
							break;
						}
						case "reasoning_done":
							break;

						case "tool_start":
						case "tool_exec": {
							const id = (payload.id as string) || `tool-${Date.now()}`;
							const name = (payload.name as string) || "";
							currentToolIdRef.current = id;
							last.toolExecutions = upsertTool(last.toolExecutions, {
								id,
								name,
								status: type === "tool_start" ? "starting" : "executing",
							});
							break;
						}
						case "tool_input": {
							const id =
								(payload.id as string) || currentToolIdRef.current;
							if (id) {
								const delta = (payload.delta as string) || "";
								last.toolExecutions = upsertTool(last.toolExecutions, {
									id,
									input: delta,
									status: "collecting_input",
								});
							}
							break;
						}
						case "tool_done": {
							const id = (payload.id as string) || currentToolIdRef.current;
							const name = (payload.name as string) || "";
							currentToolIdRef.current = "";
							last.toolExecutions = upsertTool(last.toolExecutions, {
								id,
								name,
								status: (payload.error as string) ? "error" : "done",
								output: (payload.output as string) || "",
								error: payload.error as string | undefined,
							});
							break;
						}

						case "tokens": {
							last.tokenUsage = {
								input: (payload.input as number) || 0,
								output: (payload.output as number) || 0,
								cacheReadInput: payload.cache_read_input as number | undefined,
								cacheCreationInput: payload.cache_creation_input as number | undefined,
							};
							break;
						}

						case "done":
						case "interrupted": {
							last.isStreaming = false;
							setIsProcessing(false);
							setError(null);
							break;
						}
						case "error": {
							last.isStreaming = false;
							setIsProcessing(false);
							setError(String(payload.message || "Unknown error"));
							break;
						}
					}

					return msgs;
				});
			},
		);

		return () => {
			active = false;
			void unlistenPromise.then((fn) => fn());
		};
	}, []);

	return {
		sessionId,
		messages,
		isProcessing,
		error,
		currentModel,
		send,
		cancel,
		setModel,
		reset,
	};
}
