import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
	Plus,
	Square,
	AtSign,
	Pause,
	Mic,
	Terminal,
	Hash,
	FileText,
	Zap,
	Trash2,
	Undo2,
	ArrowDownWideNarrow,
	Brain,
} from "lucide-react";
import type { AttachedImage } from "@/types";
import { cn } from "@/lib/utils";
import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";

interface SlashCommand {
	id: string;
	label: string;
	description: string;
	icon: React.ReactNode;
	action: string;
}

interface InputAreaProps {
	onSend: (
		content: string,
		images?: [string, string][],
		targetRole?: string,
	) => void;
	onQueueSend: (
		content: string,
		images?: [string, string][],
		targetRole?: string,
	) => void;
	onCancel: () => void;
	/** Send a soft-interrupt message to the running agent */
	onSoftInterrupt?: (content: string) => void;
	isProcessing: boolean;
	disabled?: boolean;
	queuedDraftCount?: number;
	availableRoles?: string[];
	/** roleName → current model display */
	roleModels?: Record<string, string>;
	/** Workspace file names for # insertion */
	workspaceFiles?: string[];
	/** Run configured dictation command and return transcript */
	onDictate?: () => Promise<
		{ text: string; mode: import("@/types").TranscriptMode } | null
	>;
	/** Callback when a slash command is selected */
	onSlashCommand?: (command: string) => void;
}

const SLASH_COMMANDS: SlashCommand[] = [
	{
		id: "compact",
		label: "compact",
		description: "Compact context window",
		icon: <ArrowDownWideNarrow className="w-3.5 h-3.5" />,
		action: "compact",
	},
	{
		id: "clear",
		label: "clear",
		description: "Clear chat history",
		icon: <Trash2 className="w-3.5 h-3.5" />,
		action: "clear",
	},
	{
		id: "rewind",
		label: "rewind",
		description: "Rewind last conversation turn",
		icon: <Undo2 className="w-3.5 h-3.5" />,
		action: "rewind",
	},
	{
		id: "memory-on",
		label: "memory on",
		description: "Enable agent memory",
		icon: <Brain className="w-3.5 h-3.5" />,
		action: "memory-on",
	},
	{
		id: "memory-off",
		label: "memory off",
		description: "Disable agent memory",
		icon: <Brain className="w-3.5 h-3.5 opacity-50" />,
		action: "memory-off",
	},
	{
		id: "interrupt",
		label: "interrupt",
		description: "Pause and inject message",
		icon: <Zap className="w-3.5 h-3.5" />,
		action: "interrupt",
	},
];

type PickerType = "slash" | "mention" | "file";

interface PickerState {
	type: PickerType;
	query: string;
	selectedIndex: number;
	visible: boolean;
}

export function InputArea({
	onSend,
	onQueueSend,
	onCancel,
	onSoftInterrupt,
	isProcessing,
	disabled = false,
	queuedDraftCount = 0,
	availableRoles = [],
	roleModels = {},
	workspaceFiles = [],
	onDictate,
	onSlashCommand,
}: InputAreaProps) {
	const [text, setText] = useState("");
	const [images, setImages] = useState<AttachedImage[]>([]);
	const [dictating, setDictating] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	const [picker, setPicker] = useState<PickerState>({
		type: "slash",
		query: "",
		selectedIndex: 0,
		visible: false,
	});

	const filteredItems = useMemo(() => {
		const q = picker.query.toLowerCase();
		switch (picker.type) {
			case "slash":
				return SLASH_COMMANDS.filter(
					(c) =>
						c.label.toLowerCase().includes(q) ||
						c.description.toLowerCase().includes(q),
				);
			case "mention":
				return availableRoles.filter((r) =>
					r.toLowerCase().includes(q),
				);
			case "file":
				return workspaceFiles.filter((f) =>
					f.toLowerCase().includes(q),
				);
			default:
				return [];
		}
	}, [picker.type, picker.query, availableRoles, workspaceFiles]);

	const detectTrigger = useCallback(
		(value: string, cursorPos: number): PickerState | null => {
			const beforeCursor = value.slice(0, cursorPos);

			const slashMatch = beforeCursor.match(/\/([\w-]*)$/);
			if (slashMatch) {
				return {
					type: "slash",
					query: slashMatch[1] || "",
					selectedIndex: 0,
					visible: true,
				};
			}

			const mentionMatch = beforeCursor.match(/@([\w-]*)$/);
			if (mentionMatch && availableRoles.length > 0) {
				return {
					type: "mention",
					query: mentionMatch[1] || "",
					selectedIndex: 0,
					visible: true,
				};
			}

			const fileMatch = beforeCursor.match(/#([\w.-]*)$/);
			if (fileMatch && workspaceFiles.length > 0) {
				return {
					type: "file",
					query: fileMatch[1] || "",
					selectedIndex: 0,
					visible: true,
				};
			}

			return null;
		},
		[availableRoles.length, workspaceFiles.length],
	);

	const handleTextChange = (value: string) => {
		setText(value);
		const cursorPos = textareaRef.current?.selectionStart || 0;
		const trigger = detectTrigger(value, cursorPos);
		if (trigger) {
			setPicker(trigger);
		} else {
			setPicker((p) => ({ ...p, visible: false }));
		}
	};

	const insertItem = useCallback(
		(item: string) => {
			const cursorPos = textareaRef.current?.selectionStart || 0;
			const beforeCursor = text.slice(0, cursorPos);
			const afterCursor = text.slice(cursorPos);

			let regex: RegExp;
			let prefix: string;
			let suffix = " ";
			switch (picker.type) {
				case "slash":
					regex = /\/[\w-]*$/;
					prefix = "/";
					// Slash commands execute immediately — no trailing space needed for some
					suffix = " ";
					break;
				case "mention":
					regex = /@[\w-]*$/;
					prefix = "@";
					suffix = " ";
					break;
				case "file":
					regex = /#[\w.-]*$/;
					prefix = "#";
					suffix = " ";
					break;
			}

			const newBefore = beforeCursor.replace(regex, `${prefix}${item}${suffix}`);
			setText(newBefore + afterCursor);
			setPicker((p) => ({ ...p, visible: false }));
			setTimeout(() => {
				if (textareaRef.current) {
					const newPos = newBefore.length;
					textareaRef.current.selectionStart = newPos;
					textareaRef.current.selectionEnd = newPos;
					textareaRef.current.focus();
				}
			}, 0);
		},
		[text, picker.type],
	);

	const executeSlashCommand = useCallback(
		(command: SlashCommand) => {
			setPicker((p) => ({ ...p, visible: false }));
			setText("");

			if (onSlashCommand) {
				onSlashCommand(command.action);
				return;
			}

			// Fallback: map to soft interrupt messages if no handler provided
			switch (command.action) {
				case "interrupt":
					if (onSoftInterrupt) {
						onSoftInterrupt(
							"Pause execution to review the current state and respond to user input.",
						);
					}
					break;
			}
		},
		[onSlashCommand, onSoftInterrupt],
	);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (!picker.visible || filteredItems.length === 0) {
			// Allow Enter to submit when picker is closed (unless Shift is held)
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSubmit();
			}
			return;
		}

		if (e.key === "ArrowDown") {
			e.preventDefault();
			setPicker((p) => ({
				...p,
				selectedIndex: (p.selectedIndex + 1) % filteredItems.length,
			}));
			return;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			setPicker((p) => ({
				...p,
				selectedIndex:
					(p.selectedIndex - 1 + filteredItems.length) %
					filteredItems.length,
			}));
			return;
		}
		if (e.key === "Enter" || e.key === "Tab") {
			e.preventDefault();
			if (picker.type === "slash") {
				const cmd = filteredItems[picker.selectedIndex] as SlashCommand;
				if (cmd) executeSlashCommand(cmd);
			} else {
				const item = filteredItems[picker.selectedIndex] as string;
				if (item) insertItem(item);
			}
			return;
		}
		if (e.key === "Escape") {
			setPicker((p) => ({ ...p, visible: false }));
			return;
		}
	};

	const parseTargetRole = (
		content: string,
	): { targetRole?: string; cleanContent: string } => {
		const match = content.trim().match(/^@(\S+)\s*(.*)$/);
		if (match && availableRoles.includes(match[1])) {
			return { targetRole: match[1], cleanContent: match[2] || "" };
		}
		return { cleanContent: content };
	};

	const handleSubmit = () => {
		if (disabled) return;
		const content = text.trim();
		if (!content && images.length === 0) return;

		const tuples: [string, string][] = images
			.filter((i): i is AttachedImage & { base64Data: string } =>
				Boolean(i.base64Data),
			)
			.map((i) => [i.mediaType, i.base64Data]);

		const { targetRole, cleanContent } = parseTargetRole(content);
		const finalContent = cleanContent.trim() || "(image)";

		if (isProcessing) {
			onQueueSend(
				finalContent,
				tuples.length > 0 ? tuples : undefined,
				targetRole,
			);
		} else {
			onSend(
				finalContent,
				tuples.length > 0 ? tuples : undefined,
				targetRole,
			);
		}

		setText("");
		setImages([]);
		setPicker((p) => ({ ...p, visible: false }));
	};

	const handleAttach = async () => {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const sel = await open({
				multiple: false,
				filters: [
					{
						name: "Images",
						extensions: ["png", "jpg", "jpeg", "gif", "webp"],
					},
				],
			});
			if (sel) {
				const path = typeof sel === "string" ? sel : sel[0];
				if (path) {
					const res = await fetch(`file://${path}`);
					const blob = await res.blob();
					const reader = new FileReader();
					reader.onload = () => {
						const base64 = (reader.result as string).split(",")[1];
						setImages((p) => [
							...p,
							{
								id: `img-${Date.now()}`,
								mediaType: blob.type || "image/png",
								base64Data: base64,
							},
						]);
					};
					reader.readAsDataURL(blob);
				}
			}
		} catch {
			// Dialog cancelled or file read failed
		}
	};

	useEffect(() => {
		if (!picker.visible) return;
		const handleClickOutside = () =>
			setPicker((p) => ({ ...p, visible: false }));
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	}, [picker.visible]);

	const pickerTitle = useMemo(() => {
		switch (picker.type) {
			case "slash":
				return (
					<>
						<Terminal className="w-3 h-3 inline mr-1" />
						Slash command
					</>
				);
			case "mention":
				return (
					<>
						<AtSign className="w-3 h-3 inline mr-1" />
						Mention a character
					</>
				);
			case "file":
				return (
					<>
						<Hash className="w-3 h-3 inline mr-1" />
						Insert file
					</>
				);
		}
	}, [picker.type]);

	const placeholderText = useMemo(() => {
		if (disabled) return "Select a workspace and start a session...";
		const hints: string[] = [];
		if (SLASH_COMMANDS.length > 0) hints.push("/ for commands");
		if (availableRoles.length > 0) hints.push("@ to mention");
		if (workspaceFiles.length > 0) hints.push("# for files");
		if (hints.length > 0) {
			return `Type a message… (${hints.join(", ")})`;
		}
		return "Type a message… (Enter to send, Shift+Enter for newline)";
	}, [disabled, availableRoles.length, workspaceFiles.length]);

	return (
		<div className="border-t bg-card p-3">
			{images.length > 0 && (
				<div className="flex gap-2 mb-2">
					{images.map((img) => (
						<div key={img.id} className="relative">
							<img
								src={
									img.base64Data
										? `data:${img.mediaType};base64,${img.base64Data}`
										: ""
								}
								className="w-14 h-14 rounded-lg object-cover border"
							/>
							<button
								onClick={() =>
									setImages((p) => p.filter((i) => i.id !== img.id))
								}
								className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]"
							>
								×
							</button>
						</div>
					))}
				</div>
			)}
			<PromptInput onSubmit={handleSubmit} className="relative">
				<PromptInputBody>
					<div className="relative w-full">
						<PromptInputTextarea
							ref={textareaRef}
							value={text}
							onChange={(e) => handleTextChange(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={placeholderText}
							className="min-h-10 max-h-48 resize-none text-left"
						/>
						{picker.visible && filteredItems.length > 0 && (
							<div className="absolute bottom-full left-0 mb-1 w-64 max-h-48 overflow-auto rounded-lg border bg-popover shadow-md z-50">
								<div className="px-2 py-1.5 text-[10px] text-muted-foreground uppercase font-semibold border-b border-border/50">
									{pickerTitle}
								</div>
								{picker.type === "slash" &&
									(filteredItems as SlashCommand[]).map((cmd, index) => (
										<button
											key={cmd.id}
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												executeSlashCommand(cmd);
											}}
											className={cn(
												"w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2.5",
												index === picker.selectedIndex && "bg-accent",
											)}
										>
											<span className="text-muted-foreground shrink-0">
												{cmd.icon}
											</span>
											<div className="flex flex-col min-w-0">
												<span className="font-medium truncate">
													/{cmd.label}
												</span>
												<span className="text-[10px] text-muted-foreground truncate">
													{cmd.description}
												</span>
											</div>
										</button>
										))}
								{picker.type === "mention" &&
									(filteredItems as string[]).map((role, index) => (
										<button
											key={role}
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												insertItem(role);
											}}
											className={cn(
												"w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between",
												index === picker.selectedIndex && "bg-accent",
											)}
										>
											<span className="font-medium">@{role}</span>
											{roleModels[role] && (
												<span className="text-[10px] text-muted-foreground font-mono bg-secondary px-1.5 py-0.5 rounded">
													{roleModels[role]}
												</span>
											)}
										</button>
									))}
								{picker.type === "file" &&
									(filteredItems as string[]).map((file, index) => (
										<button
											key={file}
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												insertItem(file);
											}}
											className={cn(
												"w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2",
												index === picker.selectedIndex && "bg-accent",
											)}
										>
											<FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
											<span className="font-mono text-xs truncate">
												#{file}
											</span>
										</button>
									))}
							</div>
						)}
					</div>
				</PromptInputBody>
				<PromptInputFooter>
					<div className="flex items-center gap-2 flex-1">
						{/* 附件按钮 */}
						<Button
							variant="outline"
							size="icon"
							onClick={handleAttach}
							disabled={disabled}
							className="h-10 w-10 shrink-0"
							title="Attach image"
						>
							<Plus className="w-4 h-4" />
						</Button>

						{/* 语音输入按钮 */}
						{onDictate && (
							<Button
								variant={dictating ? "default" : "outline"}
								size="icon"
								onClick={async () => {
									if (dictating) return;
									setDictating(true);
									const result = await onDictate();
									setDictating(false);
									if (!result) return;
									const { text: t, mode } = result;
									if (mode === "replace") {
										setText(t);
									} else if (mode === "append") {
										setText((prev) => (prev ? prev + " " + t : t));
									} else if (mode === "insert") {
										const cursorPos =
											textareaRef.current?.selectionStart || 0;
										const before = text.slice(0, cursorPos);
										const after = text.slice(cursorPos);
										const spacer =
											before && !before.endsWith(" ") ? " " : "";
										const newText =
											before + spacer + t + (after ? " " + after : "");
										setText(newText);
										setTimeout(() => {
											if (textareaRef.current) {
												const newPos =
													cursorPos + spacer.length + t.length + 1;
												textareaRef.current.selectionStart = newPos;
												textareaRef.current.selectionEnd = newPos;
												textareaRef.current.focus();
											}
										}, 0);
									} else if (mode === "send") {
										setText(t);
										const content = t.trim();
										if (content) {
											const tuples: [string, string][] = images
												.filter(
													(
														i,
													): i is AttachedImage & {
														base64Data: string;
													} => Boolean(i.base64Data),
												)
												.map((i) => [i.mediaType, i.base64Data]);
											const { targetRole, cleanContent } =
												parseTargetRole(content);
											const finalContent =
												cleanContent.trim() || "(dictated)";
											if (isProcessing) {
												onQueueSend(
													finalContent,
													tuples.length > 0 ? tuples : undefined,
													targetRole,
												);
											} else {
												onSend(
													finalContent,
													tuples.length > 0 ? tuples : undefined,
													targetRole,
												);
											}
											setText("");
											setImages([]);
										}
									}
								}}
								disabled={disabled || dictating}
								className="h-10 w-10 shrink-0"
								title={
									dictating
										? "Dictating..."
										: "Dictate (run configured speech-to-text)"
								}
							>
								{dictating ? (
									<span className="inline-block w-3 h-3 rounded-full bg-white animate-pulse" />
								) : (
									<Mic className="w-4 h-4" />
								)}
							</Button>
						)}

						{dictating && (
							<span className="text-[11px] text-muted-foreground animate-pulse">
								Dictating…
							</span>
						)}

						{/* Responding 状态指示器 */}
						{isProcessing && (
							<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
								<span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
								{queuedDraftCount > 0
									? `responding · ${queuedDraftCount} queued`
									: "responding"}
							</div>
						)}

						{/* 软中断 / 暂停按钮 */}
						{isProcessing && onSoftInterrupt && (
							<Button
								variant="ghost"
								size="icon"
								onClick={() => {
									const content =
										text.trim() ||
										"Pause execution to review the current state and respond to user input.";
									onSoftInterrupt(content);
									setText("");
									}}
								className="h-10 w-10 shrink-0 text-muted-foreground hover:text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/20"
								title="Soft interrupt — pause agent and inject message"
							>
								<Pause className="w-4 h-4" />
							</Button>
						)}

						{/* 取消按钮（独立 ghost） */}
						{isProcessing && (
							<Button
								variant="ghost"
								size="icon"
								onClick={onCancel}
								className="h-10 w-10 shrink-0 ml-auto text-muted-foreground hover:text-destructive hover:bg-destructive/10"
								title="Stop current response"
							>
								<Square className="w-4 h-4 fill-current" />
							</Button>
						)}

						{/* 发送按钮（始终可见；processing 时自动队列） */}
						<PromptInputSubmit
							status="ready"
							disabled={disabled || (!text.trim() && images.length === 0)}
							className={cn("h-10 w-10 shrink-0", !isProcessing && "ml-auto")}
							title={isProcessing ? "Queue message" : "Send message"}
						/>
					</div>
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}
