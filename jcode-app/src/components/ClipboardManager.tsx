import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
	Clipboard,
	Trash2,
	Pin,
	PinOff,
	Search,
	X,
	ArrowUp,
	CornerDownLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClipboardItem } from "@/hooks/useClipboard";

interface ClipboardManagerProps {
	items: ClipboardItem[];
	loading: boolean;
	error: string | null;
	query: string;
	onQueryChange: (value: string) => void;
	onCopy: (item: ClipboardItem) => void;
	onDelete: (id: number) => void;
	onTogglePin: (id: number, pinned: boolean) => void;
	onClear: () => void;
	onClose: () => void;
}

export function ClipboardManager({
	items,
	loading,
	error,
	query,
	onQueryChange,
	onCopy,
	onDelete,
	onTogglePin,
	onClear,
	onClose,
}: ClipboardManagerProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [selectedId, setSelectedId] = useState<number | null>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return items;
		return items.filter((i) => i.content.toLowerCase().includes(q));
	}, [items, query]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			onClose();
			return;
		}
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedId((prev) => {
				if (filtered.length === 0) return null;
				const idx = filtered.findIndex((i) => i.id === prev);
				const nextIdx =
					e.key === "ArrowDown"
						? idx < filtered.length - 1
							? idx + 1
							: 0
						: idx > 0
							? idx - 1
							: filtered.length - 1;
				return filtered[nextIdx]?.id ?? null;
			});
			return;
		}
		if (e.key === "Enter" && selectedId !== null) {
			e.preventDefault();
			const item = filtered.find((i) => i.id === selectedId);
			if (item) onCopy(item);
		}
	};

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
						<Clipboard className="size-3.5" />
					</div>
					<span className="text-[13px] font-medium">Clipboard History</span>
					<span className="ml-auto text-[10px] launcher-muted">
						{items.length} items
					</span>
				</div>

				{/* Search */}
				<div className="p-2">
					<div className="launcher-input flex items-center gap-2 px-3 h-10">
						<Search className="size-4 shrink-0 text-[var(--launcher-muted-fg)]/60" />
						<input
							ref={inputRef}
							value={query}
							onChange={(e) => {
								onQueryChange(e.target.value);
								setSelectedId(null);
							}}
							onKeyDown={(e) => e.stopPropagation()}
							placeholder="Search clipboard history…"
							className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--launcher-muted-fg)]/60"
						/>
						{query && (
							<button
								type="button"
								onClick={() => {
									onQueryChange("");
									setSelectedId(null);
								}}
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
							Loading clipboard…
						</div>
					) : error ? (
						<div className="flex items-center justify-center h-32 text-destructive text-xs px-4 text-center">
							{error}
						</div>
					) : filtered.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-32 gap-2 launcher-muted text-xs">
							<Clipboard className="size-6 opacity-30" />
							<span>{query ? "No matches" : "Clipboard history is empty"}</span>
						</div>
					) : (
						<div className="space-y-1">
							{filtered.map((item) => (
								<motion.button
									key={item.id}
									type="button"
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									transition={{ duration: 0.08 }}
									onClick={() => onCopy(item)}
									onMouseEnter={() => setSelectedId(item.id)}
									className={cn(
										"w-full text-left rounded-lg px-3 py-2 group transition-colors",
										"hover:bg-primary/10",
										selectedId === item.id && "bg-primary/10",
									)}
								>
									<div className="flex items-start gap-2">
										<div className="flex-1 min-w-0">
											<p className="text-[13px] text-foreground whitespace-pre-wrap break-words line-clamp-3">
												{item.content}
											</p>
											<p className="text-[10px] launcher-muted mt-1">
												{formatTime(item.createdAt)}
												{item.pinned && (
													<span className="ml-2 text-primary">pinned</span>
												)}
											</p>
										</div>
										<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													onTogglePin(item.id, !item.pinned);
												}}
												className="size-6 rounded-md flex items-center justify-center text-[var(--launcher-muted-fg)] hover:text-foreground hover:bg-muted/60 transition-colors"
												title={item.pinned ? "Unpin" : "Pin"}
											>
												{item.pinned ? (
													<PinOff className="size-3" />
												) : (
													<Pin className="size-3" />
												)}
											</button>
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													onDelete(item.id);
												}}
												className="size-6 rounded-md flex items-center justify-center text-[var(--launcher-muted-fg)] hover:text-destructive hover:bg-destructive/10 transition-colors"
												title="Delete"
											>
												<Trash2 className="size-3" />
											</button>
										</div>
									</div>
								</motion.button>
							))}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="launcher-footer border-t border-[var(--launcher-glass-border)] px-3 py-1.5 flex items-center justify-between text-[11px]">
					<div className="flex items-center gap-3">
						<button
							type="button"
							onClick={onClear}
							className="flex items-center gap-1.5 hover:text-foreground transition-colors"
							title="Clear unpinned history"
						>
							<Trash2 className="size-3" />
							Clear
						</button>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<span className="inline-flex items-center gap-1">
							<ArrowUp className="size-3" />
							<CornerDownLeft className="size-3" />
							<span>navigate · enter to copy · esc to back</span>
						</span>
					</div>
				</div>
			</div>
		</motion.div>
	);
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
