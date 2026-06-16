import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LauncherChatProvider } from "@/lib/launcherTypes";
import type { ChatMessage } from "@/types";

interface LauncherChatState {
	sessionId: string | null;
	messages: ChatMessage[];
	isProcessing: boolean;
	error: string | null;
}

function createUserMessage(content: string): ChatMessage {
	return {
		id: `user-${Date.now()}`,
		role: "user",
		content,
		toolExecutions: [],
		isStreaming: false,
		timestamp: Date.now(),
	};
}

function createAssistantMessage(): ChatMessage {
	return {
		id: `assistant-${Date.now()}`,
		role: "assistant",
		content: "",
		toolExecutions: [],
		isStreaming: true,
		timestamp: Date.now(),
	};
}

export function useLauncherChat(provider: LauncherChatProvider) {
	const [state, setState] = useState<LauncherChatState>({
		sessionId: null,
		messages: [],
		isProcessing: false,
		error: null,
	});

	const setSessionId = useCallback((sessionId: string) => {
		setState((prev) => ({ ...prev, sessionId }));
	}, []);

	const ensureSession = useCallback(async () => {
		if (state.sessionId) return state.sessionId;
		const sessionId = await invoke<string>("begin_session", {
			workingDir: null,
			model: provider.model,
			memoryEnabled: true,
			roleName: null,
			profileId: provider.providerKey,
			forceProvider: true,
		});
		setSessionId(sessionId);
		return sessionId;
	}, [provider.model, provider.providerKey, state.sessionId, setSessionId]);

	const send = useCallback(
		async (content: string) => {
			const text = content.trim();
			if (!text) return;

			setState((prev) => ({
				...prev,
				messages: [...prev.messages, createUserMessage(text)],
				isProcessing: true,
				error: null,
			}));

			try {
				const sessionId = await ensureSession();
				await invoke("send_message", {
					sessionId,
					content: text,
					images: null,
					systemReminder: null,
				});
			} catch (e) {
				setState((prev) => ({
					...prev,
					isProcessing: false,
					error: String(e),
				}));
			}
		},
		[ensureSession],
	);

	const cancel = useCallback(async () => {
		if (!state.sessionId) return;
		try {
			await invoke("cancel", { sessionId: state.sessionId });
		} catch (e) {
			console.warn("cancel failed in launcher chat:", e);
		}
	}, [state.sessionId]);

	const reset = useCallback(() => {
		setState({
			sessionId: null,
			messages: [],
			isProcessing: false,
			error: null,
		});
	}, []);

	useEffect(() => {
		let active = true;
		const unlisten = listen<Record<string, unknown>>("server-event", (event) => {
			if (!active) return;
			const payload = event.payload as Record<string, unknown> & {
				session_id?: string;
				type?: string;
			};
			if (payload.session_id !== state.sessionId) return;

			const type = payload.type;
			setState((prev) => {
				const msgs = [...prev.messages];
				let lastAssistant = msgs[msgs.length - 1];
				if (!lastAssistant || lastAssistant.role !== "assistant") {
					msgs.push(createAssistantMessage());
					lastAssistant = msgs[msgs.length - 1];
				}

				switch (type) {
					case "text_delta": {
						const delta = (payload.delta as string) || "";
						lastAssistant.content += delta;
						break;
					}
					case "text_replace": {
						lastAssistant.content = (payload.text as string) || "";
						break;
					}
					case "tool_start":
					case "tool_input":
					case "tool_exec": {
						const toolName = (payload.tool_name as string) || "";
						const toolInput = payload.tool_input
							? JSON.stringify(payload.tool_input)
							: "";
						lastAssistant.content = `\`${toolName}\`${toolInput ? ` — ${toolInput}` : ""}`;
						break;
					}
					case "tool_done": {
						const toolName = (payload.tool_name as string) || "";
						lastAssistant.content = `\`${toolName}\` done`;
						break;
					}
					case "done":
					case "error":
					case "interrupted": {
						lastAssistant.isStreaming = false;
						if (type === "error") {
							return {
								...prev,
								messages: msgs,
								isProcessing: false,
								error: String(payload.message || "Unknown error"),
							};
						}
						return {
							...prev,
							messages: msgs,
							isProcessing: false,
							error: null,
						};
					}
				}

				return { ...prev, messages: msgs };
			});
		});

		return () => {
			active = false;
			void unlisten.then((fn) => fn());
		};
	}, [state.sessionId]);

	return {
		...state,
		send,
		cancel,
		reset,
	};
}
