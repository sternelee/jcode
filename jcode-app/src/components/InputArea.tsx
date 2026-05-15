import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Square, AtSign, Pause } from "lucide-react";
import type { AttachedImage } from "@/types";
import { cn } from "@/lib/utils";
import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";

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
}: InputAreaProps) {
	const [text, setText] = useState("");
	const [images, setImages] = useState<AttachedImage[]>([]);
	const [mentionQuery, setMentionQuery] = useState("");
	const [showMentions, setShowMentions] = useState(false);
	const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	const filteredRoles = availableRoles.filter((role) =>
		role.toLowerCase().includes(mentionQuery.toLowerCase()),
	);

	const handleTextChange = (value: string) => {
		setText(value);
		const cursorPos = textareaRef.current?.selectionStart || 0;
		const beforeCursor = value.slice(0, cursorPos);
		const match = beforeCursor.match(/@([\w-]*)$/);
		if (match && availableRoles.length > 0) {
			setMentionQuery(match[1] || "");
			setShowMentions(true);
			setSelectedMentionIndex(0);
		} else {
			setShowMentions(false);
		}
	};

	const insertMention = useCallback(
		(role: string) => {
			const cursorPos = textareaRef.current?.selectionStart || 0;
			const beforeCursor = text.slice(0, cursorPos);
			const afterCursor = text.slice(cursorPos);
			const newBefore = beforeCursor.replace(/@[\w-]*$/, `@${role} `);
			setText(newBefore + afterCursor);
			setShowMentions(false);
			setTimeout(() => {
				if (textareaRef.current) {
					const newPos = newBefore.length;
					textareaRef.current.selectionStart = newPos;
					textareaRef.current.selectionEnd = newPos;
					textareaRef.current.focus();
				}
			}, 0);
		},
		[text],
	);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (showMentions && filteredRoles.length > 0) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelectedMentionIndex((i) => (i + 1) % filteredRoles.length);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelectedMentionIndex(
					(i) => (i - 1 + filteredRoles.length) % filteredRoles.length,
				);
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				insertMention(filteredRoles[selectedMentionIndex]!);
				return;
			}
			if (e.key === "Escape") {
				setShowMentions(false);
				return;
			}
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
			onSend(finalContent, tuples.length > 0 ? tuples : undefined, targetRole);
		}

		setText("");
		setImages([]);
		setShowMentions(false);
	};

	const handleAttach = async () => {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const sel = await open({
				multiple: false,
				filters: [
					{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
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
		if (!showMentions) return;
		const handleClickOutside = () => setShowMentions(false);
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	}, [showMentions]);

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
							placeholder={
								disabled
									? "Select a workspace and start a session..."
									: availableRoles.length > 0
										? "Type a message... Use @role to mention a character"
										: "Type a message... (Enter to send, Shift+Enter for newline)"
							}
							className="min-h-10 max-h-48 resize-none text-left"
						/>
						{showMentions && filteredRoles.length > 0 && (
							<div className="absolute bottom-full left-0 mb-1 w-56 max-h-40 overflow-auto rounded-lg border bg-popover shadow-md z-50">
								<div className="px-2 py-1.5 text-[10px] text-muted-foreground uppercase font-semibold">
									<AtSign className="w-3 h-3 inline mr-1" />
									Mention a character
								</div>
								{filteredRoles.map((role, index) => (
									<button
										key={role}
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											insertMention(role);
										}}
										className={cn(
											"w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between",
											index === selectedMentionIndex && "bg-accent",
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
							</div>
						)}
					</div>
				</PromptInputBody>
				<PromptInputFooter>
					<div className="flex items-center gap-2 flex-1">
						{/* 附件按钒 */}
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

						{/* Responding 状态指示器 */}
						{isProcessing && (
							<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
								<span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
								{queuedDraftCount > 0
									? `responding · ${queuedDraftCount} queued`
									: "responding"}
							</div>
						)}

						{/* 软中断 / 暂停按钒 */}
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

						{/* 取消按钒（独立 ghost） */}
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

						{/* 发送按钒（始终可见；processing 时自动队列） */}
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
