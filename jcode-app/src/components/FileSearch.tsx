import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
	Search,
	Folder,
	X,
	Loader2,
	ArrowUp,
	CornerDownLeft,
	FileText,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/hooks/useFileSearch";

interface FileSearchProps {
	results: SearchResult[];
	searching: boolean;
	done: boolean;
	error: string | null;
	keyword: string;
	path: string;
	initialQuery?: string;
	onKeywordChange: (value: string) => void;
	onPathChange: (value: string) => void;
	onSearch: () => void;
	onClear: () => void;
	onClose: () => void;
}

export function FileSearch({
	results,
	searching,
	done,
	error,
	keyword,
	path,
	initialQuery,
	onKeywordChange,
	onPathChange,
	onSearch,
	onClear,
	onClose,
}: FileSearchProps) {
	const keywordRef = useRef<HTMLInputElement>(null);
	const pathRef = useRef<HTMLInputElement>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const hasAutoSearchedRef = useRef(false);
	const lastQueryRef = useRef({ keyword: "", path: "" });
	const lastSearchedRef = useRef({ keyword: "", path: "" });

	useEffect(() => {
		keywordRef.current?.focus();
	}, []);

	useEffect(() => {
		if (initialQuery && !hasAutoSearchedRef.current && path.trim()) {
			hasAutoSearchedRef.current = true;
			onKeywordChange(initialQuery);
			lastSearchedRef.current = { keyword: initialQuery, path };
			onSearch();
		}
	}, [initialQuery, onKeywordChange, onSearch, path]);

	// Real-time search as the user types.
	useEffect(() => {
		if (!path.trim()) return;
		if (!keyword.trim()) {
			onClear();
			lastSearchedRef.current = { keyword: "", path };
			return;
		}
		const timer = setTimeout(() => {
			if (
				keyword === lastSearchedRef.current.keyword &&
				path === lastSearchedRef.current.path
			) {
				return;
			}
			lastSearchedRef.current = { keyword, path };
			onSearch();
		}, 1200);
		return () => clearTimeout(timer);
	}, [keyword, path, onSearch, onClear]);

	// Only reset the selection when the search query itself changes, not
	// while results are streaming in. This stops the list from feeling like
	// it is constantly refreshing as new matches arrive.
	useEffect(() => {
		if (
			keyword !== lastQueryRef.current.keyword ||
			path !== lastQueryRef.current.path
		) {
			lastQueryRef.current = { keyword, path };
			setSelectedIndex(0);
		}
	}, [keyword, path]);

	const openSelected = async (result?: SearchResult) => {
		const target = result ?? results[selectedIndex];
		if (!target) return;
		try {
			await invoke("open_file", { path: target.path });
		} catch (e) {
			// Fallback: reveal parent directory.
			await invoke("open_parent_directory", { path: target.path }).catch(() => {});
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			onClose();
			return;
		}
		if (e.key === "Enter") {
			if (document.activeElement === pathRef.current) {
				onSearch();
			} else if (results[selectedIndex]) {
				void openSelected();
			} else {
				onSearch();
			}
			return;
		}
		if (e.key === "Tab" && !e.shiftKey) {
			e.preventDefault();
			pathRef.current?.focus();
			return;
		}
		if (results.length === 0) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((i) => (i + 1) % results.length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => (i - 1 + results.length) % results.length);
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
						<Search className="size-3.5" />
					</div>
					<span className="text-[13px] font-medium">File Search</span>
					<span className="ml-auto text-[10px] launcher-muted">
						{searching
							? `Searching… ${results.length} matches`
							: done
								? `${results.length} matches`
								: ""}
					</span>
				</div>

				{/* Inputs */}
				<div className="p-2 space-y-2">
					<div className="launcher-input flex items-center gap-2 px-3 h-10">
						<Search className="size-4 shrink-0 text-[var(--launcher-muted-fg)]/60" />
						<input
							ref={keywordRef}
							value={keyword}
							onChange={(e) => onKeywordChange(e.target.value)}
							placeholder="Search keyword (regex supported)…"
							className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--launcher-muted-fg)]/60"
						/>
						{keyword && (
							<button
								type="button"
								onClick={() => onKeywordChange("")}
								className="size-5 rounded-md flex items-center justify-center text-[var(--launcher-muted-fg)]/60 hover:text-foreground hover:bg-muted/60 transition-colors"
							>
								<X className="size-3" />
							</button>
						)}
					</div>
					<div className="launcher-input flex items-center gap-2 px-3 h-9">
						<Folder className="size-4 shrink-0 text-[var(--launcher-muted-fg)]/60" />
						<input
							ref={pathRef}
							value={path}
							onChange={(e) => onPathChange(e.target.value)}
							placeholder="Directory path…"
							className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--launcher-muted-fg)]/60"
						/>
					</div>
				</div>

				{/* Results */}
				<div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
					{error ? (
						<div className="flex items-center justify-center h-32 text-destructive text-xs px-4 text-center">
							{error}
						</div>
					) : results.length === 0 && !searching ? (
						<div className="flex flex-col items-center justify-center h-32 gap-2 launcher-muted text-xs">
							<FileText className="size-6 opacity-30" />
							<span>
								{done ? "No matches" : "Enter keyword and path, then press Enter"}
							</span>
						</div>
					) : (
						<div className="space-y-1">
							{results.slice(0, 200).map((r, idx) => (
								<button
									type="button"
									key={`${r.path}:${r.line}:${idx}`}
									onMouseEnter={() => setSelectedIndex(idx)}
									onClick={() => openSelected(r)}
									className={cn(
										"w-full text-left rounded-lg px-3 py-2 transition-colors",
										selectedIndex === idx ? "bg-primary/10" : "hover:bg-primary/5",
									)}
								>
									<p className="text-[11px] launcher-muted truncate">
										{r.relative}:{r.line}
									</p>
									<p className="text-[12px] text-foreground font-mono truncate">
										{r.text}
									</p>
								</button>
							))}
							{searching && (
								<div className="flex items-center gap-2 px-3 py-2 launcher-muted text-xs">
									<Loader2 className="size-3 animate-spin" />
									Searching…
								</div>
							)}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="launcher-footer border-t border-[var(--launcher-glass-border)] px-3 py-1.5 flex items-center justify-between text-[11px]">
					<div className="flex items-center gap-3">
						<span className="flex items-center gap-1">
							<TabIcon className="size-3" />
							<span>tab to path</span>
						</span>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<span className="inline-flex items-center gap-1">
							<ArrowUp className="size-3" />
							<CornerDownLeft className="size-3" />
							<span>navigate · enter to search · esc to back</span>
						</span>
					</div>
				</div>
			</div>
		</motion.div>
	);
}

function TabIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			className={className}
		>
			<path d="M9 7l4 5-4 5M15 7l4 5-4 5" />
		</svg>
	);
}
