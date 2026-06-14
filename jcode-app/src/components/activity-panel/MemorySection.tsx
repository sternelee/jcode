import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { compactText } from "./utils";
import type { MemoryEntry, MemoryStats } from "@/types";

interface MemorySectionProps {
	exportMemories?: (path: string) => Promise<void>;
	importMemories?: (
		path: string,
	) => Promise<{ project_count: number; global_count: number } | null>;
}

export function MemorySection({
	exportMemories,
	importMemories,
}: MemorySectionProps) {
	const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
	const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[] | null>(
		null,
	);
	const [memoryScope, setMemoryScope] = useState<"all" | "project" | "global">(
		"all",
	);
	const [clearTestStatus, setClearTestStatus] = useState<string | null>(null);

	const loadMemoryData = useCallback(async () => {
		try {
			const stats = await invoke<MemoryStats>("get_memory_stats");
			setMemoryStats(stats);
		} catch {
			// ignore
		}
		try {
			const result = await invoke<{ memories: MemoryEntry[] }>("get_memory_list", { scope: memoryScope });
			setMemoryEntries(result.memories.slice(0, 20));
		} catch {
			// ignore
		}
	}, [memoryScope]);

	useEffect(() => {
		let fetching = false;
		const load = async () => {
			if (fetching) return;
			fetching = true;
			try {
				await loadMemoryData();
			} finally {
				fetching = false;
			}
		};
		void load();
		const id = window.setInterval(load, 60000);
		return () => {
			window.clearInterval(id);
		};
	}, [loadMemoryData]);

	useEffect(() => {
		// Immediately refresh when scope changes.
		void loadMemoryData();
	}, [memoryScope, loadMemoryData]);

	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
					<BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
					Memory
				</div>
				<Badge variant="outline" className="text-[10px]">
					{memoryStats?.total ?? "—"}
				</Badge>
			</div>
			<div className="flex flex-wrap gap-1">
				{(["all", "project", "global"] as const).map((scope) => (
					<button
						key={scope}
						className={cn(
							"px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors",
							memoryScope === scope
								? "bg-primary text-primary-foreground"
								: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
						)}
						onClick={() => setMemoryScope(scope)}
					>
						{scope}
					</button>
				))}
			</div>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-7 text-[10px]"
					onClick={async () => {
						try {
							const path = await save({
								filters: [{ name: "JSON", extensions: ["json"] }],
								defaultPath: "jcode-memories.json",
							});
							if (path && exportMemories) {
								await exportMemories(path);
							}
						} catch {
							// ignore
						}
					}}
				>
					Export
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-7 text-[10px]"
					onClick={async () => {
						try {
							const selected = await open({
								filters: [{ name: "JSON", extensions: ["json"] }],
								multiple: false,
							});
							if (
								selected &&
								typeof selected === "string" &&
								importMemories
							) {
								const result = await importMemories(selected);
								if (result) {
									const stats =
										await invoke<MemoryStats>("get_memory_stats");
									setMemoryStats(stats);
									const list = await invoke<{
										memories: MemoryEntry[];
									}>("get_memory_list", { scope: memoryScope });
									setMemoryEntries(list.memories.slice(0, 20));
								}
							}
						} catch {
							// ignore
						}
					}}
				>
					Import
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-7 text-[10px] gap-1"
					onClick={async () => {
						try {
							const result = await invoke<{ count: number }>("clear_test_memories");
							const message =
								result.count === 0
									? "Test memory storage is already empty."
									: `Cleared ${result.count} test memory file${result.count === 1 ? "" : "s"}.`;
							setClearTestStatus(message);
							await loadMemoryData();
							window.setTimeout(() => setClearTestStatus(null), 4000);
						} catch {
							setClearTestStatus("Failed to clear test memory storage.");
							window.setTimeout(() => setClearTestStatus(null), 4000);
						}
					}}
				>
					<Trash2 className="w-3 h-3" />
					Clear test
				</Button>
			</div>
			{clearTestStatus && (
				<div className="text-[11px] text-muted-foreground">{clearTestStatus}</div>
			)}
			{memoryStats ? (
				<div className="space-y-2">
					<div className="grid grid-cols-3 gap-2">
						<div className="rounded border bg-secondary px-2 py-2">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
								Project
							</div>
							<div className="text-sm font-medium">
								{memoryStats.project_count}
							</div>
						</div>
						<div className="rounded border bg-secondary px-2 py-2">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
								Global
							</div>
							<div className="text-sm font-medium">
								{memoryStats.global_count}
							</div>
						</div>
						<div className="rounded border bg-secondary px-2 py-2">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
								Tags
							</div>
							<div className="text-sm font-medium">
								{memoryStats.unique_tags}
							</div>
						</div>
					</div>
					{Object.entries(memoryStats.categories).length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{Object.entries(memoryStats.categories).map(
								([cat, count]) => (
									<Badge
										key={cat}
										variant="outline"
										className="text-[10px]"
									>
										{cat}: {count}
									</Badge>
								),
							)}
						</div>
					)}
				</div>
			) : (
				<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
					Memory stats unavailable.
				</div>
			)}
			{memoryEntries && memoryEntries.length > 0 && (
				<div className="space-y-2">
					<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
						Recent entries ({memoryEntries.length})
					</div>
					{memoryEntries.map((entry) => (
						<div
							key={entry.id}
							className="rounded border bg-secondary px-2 py-2 space-y-1 text-xs"
						>
							<div className="flex items-start justify-between gap-2">
								<div className="font-medium break-words">
									{compactText(entry.content, 80)}
								</div>
								<Badge variant="outline" className="text-[10px] shrink-0">
									{entry.category}
								</Badge>
							</div>
							<div className="flex flex-wrap gap-1">
								{entry.tags.map((tag) => (
									<Badge
										key={tag}
										variant="secondary"
										className="text-[10px]"
									>
										{tag}
									</Badge>
								))}
							</div>
							<div className="flex items-center justify-between text-[10px] text-muted-foreground">
								<span>
									trust {entry.trust} · conf{" "}
									{Math.round(entry.effective_confidence * 100)}%
								</span>
								<span>{entry.access_count} reads</span>
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
