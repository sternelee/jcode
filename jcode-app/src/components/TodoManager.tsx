import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
	CheckSquare2,
	Square,
	Trash2,
	ListTodo,
	X,
	ArrowUp,
	CornerDownLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TodoItem } from "@/hooks/useTodos";

interface TodoManagerProps {
	items: TodoItem[];
	loading: boolean;
	error: string | null;
	onAdd: (text: string) => void;
	onToggle: (id: number, completed: boolean) => void;
	onDelete: (id: number) => void;
	onClearCompleted: () => void;
	onClose: () => void;
}

export function TodoManager({
	items,
	loading,
	error,
	onAdd,
	onToggle,
	onDelete,
	onClearCompleted,
	onClose,
}: TodoManagerProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [input, setInput] = useState("");
	const [selectedId, setSelectedId] = useState<number | null>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const pending = useMemo(() => items.filter((i) => !i.completed), [items]);
	const completed = useMemo(() => items.filter((i) => i.completed), [items]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			if (input) {
				e.preventDefault();
				setInput("");
			} else {
				onClose();
			}
			return;
		}
		const all = [...pending, ...completed];
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedId((prev) => {
				if (all.length === 0) return null;
				const idx = all.findIndex((i) => i.id === prev);
				const nextIdx =
					e.key === "ArrowDown"
						? idx < all.length - 1
							? idx + 1
							: 0
						: idx > 0
							? idx - 1
							: all.length - 1;
				return all[nextIdx]?.id ?? null;
			});
			return;
		}
		if (e.key === " " && selectedId !== null) {
			e.preventDefault();
			const item = all.find((i) => i.id === selectedId);
			if (item) onToggle(item.id, !item.completed);
		}
	};

	const renderItem = (item: TodoItem) => (
		<motion.div
			key={item.id}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 0.08 }}
			onMouseEnter={() => setSelectedId(item.id)}
			className={cn(
				"flex items-center gap-2 rounded-lg px-3 py-2 group transition-colors",
				selectedId === item.id && "bg-primary/10",
			)}
		>
			<button
				type="button"
				onClick={() => onToggle(item.id, !item.completed)}
				className="shrink-0 text-[var(--launcher-muted-fg)] hover:text-primary transition-colors"
			>
				{item.completed ? (
					<CheckSquare2 className="size-4 text-primary" />
				) : (
					<Square className="size-4" />
				)}
			</button>
			<span
				className={cn(
					"flex-1 text-[13px] truncate",
					item.completed && "line-through launcher-muted",
				)}
			>
				{item.text}
			</span>
			<button
				type="button"
				onClick={() => onDelete(item.id)}
				className="size-6 rounded-md flex items-center justify-center text-[var(--launcher-muted-fg)] opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
				title="Delete"
			>
				<Trash2 className="size-3" />
			</button>
		</motion.div>
	);

	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.98 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={{ duration: 0.18, ease: "easeOut" }}
			className="h-screen w-screen flex flex-col text-foreground"
			onKeyDown={handleKeyDown}
		>
			<div className="flex-1 launcher-glass overflow-hidden flex flex-col">
				{/* Header */}
				<div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--launcher-glass-border)]">
					<div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center text-primary">
						<ListTodo className="size-3.5" />
					</div>
					<span className="text-[13px] font-medium">Todos</span>
					<span className="ml-auto text-[10px] launcher-muted">
						{pending.length} pending
					</span>
				</div>

				{/* Input */}
				<div className="p-2">
					<div className="launcher-input flex items-center gap-2 px-3 h-10">
						<input
							ref={inputRef}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && input.trim()) {
									e.preventDefault();
									e.stopPropagation();
									onAdd(input.trim());
									setInput("");
									return;
								}
								if (e.key === "Escape") return;
								e.stopPropagation();
							}}
							placeholder="Add a todo…"
							className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--launcher-muted-fg)]/60"
						/>
						{input && (
							<button
								type="button"
								onClick={() => setInput("")}
								className="size-5 rounded-md flex items-center justify-center text-[var(--launcher-muted-fg)]/60 hover:text-foreground hover:bg-muted/60 transition-colors"
							>
								<X className="size-3" />
							</button>
						)}
					</div>
				</div>

				{/* List */}
				<div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
					{loading && items.length === 0 ? (
						<div className="flex items-center justify-center h-32 launcher-muted text-xs">
							Loading todos…
						</div>
					) : error ? (
						<div className="flex items-center justify-center h-32 text-destructive text-xs px-4 text-center">
							{error}
						</div>
					) : items.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-32 gap-2 launcher-muted text-xs">
							<ListTodo className="size-6 opacity-30" />
							<span>No todos yet</span>
						</div>
					) : (
						<div className="space-y-1">
							{pending.map(renderItem)}
							{completed.length > 0 && (
								<div className="pt-2 mt-2 border-t border-[var(--launcher-glass-border)]">
									<p className="text-[10px] launcher-muted px-3 py-1">
										Completed
									</p>
									{completed.map(renderItem)}
								</div>
							)}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="launcher-footer border-t border-[var(--launcher-glass-border)] px-3 py-1.5 flex items-center justify-between text-[11px]">
					<div className="flex items-center gap-3">
						{completed.length > 0 && (
							<button
								type="button"
								onClick={onClearCompleted}
								className="flex items-center gap-1.5 hover:text-foreground transition-colors"
							>
								<Trash2 className="size-3" />
								Clear completed
							</button>
						)}
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<span className="inline-flex items-center gap-1">
							<ArrowUp className="size-3" />
							<CornerDownLeft className="size-3" />
							<span>navigate · enter to add · space to toggle · esc to back</span>
						</span>
					</div>
				</div>
			</div>
		</motion.div>
	);
}
