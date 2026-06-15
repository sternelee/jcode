import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PatchDiff } from "@pierre/diffs/react";
import { cn } from "@/lib/utils";
import { GitCommitHorizontal, RefreshCw, FileDiff } from "lucide-react";

interface GitLogEntry {
	hash: string;
	shortHash: string;
	author: string;
	date: string;
	message: string;
}

interface GitDiffResult {
	staged: string;
	unstaged: string;
}

interface GitDiffPanelProps {
	workingDir?: string | null;
	/** "light" | "dark" — passed as themeType to @pierre/diffs. Falls back to "system". */
	theme?: "light" | "dark";
}

type DiffTab = "unstaged" | "staged" | "log";

export function GitDiffPanel({ workingDir, theme }: GitDiffPanelProps) {
	const [activeTab, setActiveTab] = useState<DiffTab>("unstaged");
	const [diff, setDiff] = useState<GitDiffResult | null>(null);
	const [log, setLog] = useState<GitLogEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchDiff = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await invoke<GitDiffResult>("git_diff", {
				workingDir: workingDir ?? null,
			});
			setDiff(result);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, [workingDir]);

	const fetchLog = useCallback(async () => {
		try {
			const entries = await invoke<GitLogEntry[]>("git_log", {
				workingDir: workingDir ?? null,
				count: 30,
			});
			setLog(entries);
		} catch (e) {
			setError(String(e));
		}
	}, [workingDir]);

	useEffect(() => {
		void fetchDiff();
		void fetchLog();
	}, [fetchDiff, fetchLog]);

	const currentPatch =
		activeTab === "staged" ? diff?.staged : diff?.unstaged;
	const hasContent = currentPatch && currentPatch.trim().length > 0;

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Tab bar */}
			<div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
				<TabButton
					active={activeTab === "unstaged"}
					onClick={() => setActiveTab("unstaged")}
					count={diff?.unstaged ? 1 : 0}
				>
					<FileDiff className="w-3 h-3" />
					Changes
				</TabButton>
				<TabButton
					active={activeTab === "staged"}
					onClick={() => setActiveTab("staged")}
					count={diff?.staged ? 1 : 0}
				>
					<FileDiff className="w-3 h-3" />
					Staged
				</TabButton>
				<TabButton
					active={activeTab === "log"}
					onClick={() => setActiveTab("log")}
					count={log.length}
				>
					<GitCommitHorizontal className="w-3 h-3" />
					Log
				</TabButton>
				<button
					type="button"
					onClick={() => {
						void fetchDiff();
						void fetchLog();
					}}
					disabled={loading}
					className="ml-auto w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-all disabled:opacity-30"
					title="Refresh"
				>
					<RefreshCw
						className={cn(
							"w-3.5 h-3.5",
							loading && "animate-spin",
						)}
					/>
				</button>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto">
				{activeTab === "log" ? (
					<LogList entries={log} />
				) : error ? (
					<div className="flex flex-col items-center justify-center h-full text-center px-4">
						<p className="text-[12px] text-destructive">{error}</p>
						<button
							type="button"
							onClick={() => {
								void fetchDiff();
							}}
							className="mt-2 text-[11px] text-primary hover:underline"
						>
							Retry
						</button>
					</div>
				) : loading ? (
					<div className="flex items-center justify-center h-full">
						<RefreshCw className="w-4 h-4 text-muted-foreground/40 animate-spin" />
					</div>
				) : !hasContent ? (
					<div className="flex flex-col items-center justify-center h-full text-center px-4">
						<FileDiff className="w-6 h-6 text-muted-foreground/20 mb-2" />
						<p className="text-[12px] text-muted-foreground/50">
							{activeTab === "staged"
								? "No staged changes"
								: "No uncommitted changes"}
						</p>
					</div>
				) : (
					<div className="p-2">
						<PatchDiff
							patch={currentPatch!}
							options={{ themeType: theme ?? "system" }}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

function TabButton({
	active,
	onClick,
	count,
	children,
}: {
	active: boolean;
	onClick: () => void;
	count: number;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all",
				active
					? "bg-muted text-foreground"
					: "text-muted-foreground/50 hover:text-foreground hover:bg-muted/50",
			)}
		>
			{children}
			{count > 0 && (
				<span className="text-[10px] text-muted-foreground/40">
					{count}
				</span>
			)}
		</button>
	);
}

function LogList({ entries }: { entries: GitLogEntry[] }) {
	if (entries.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-center px-4">
				<GitCommitHorizontal className="w-6 h-6 text-muted-foreground/20 mb-2" />
				<p className="text-[12px] text-muted-foreground/50">
					No commits yet
				</p>
			</div>
		);
	}

	return (
		<div className="divide-y divide-border">
			{entries.map((entry) => (
				<div
					key={entry.hash}
					className="px-3 py-2 hover:bg-muted/40 transition-colors"
				>
					<div className="flex items-start gap-2">
						<span className="text-[11px] font-mono text-primary/70 shrink-0 mt-0.5">
							{entry.shortHash}
						</span>
						<div className="min-w-0 flex-1">
							<p className="text-[12px] text-foreground truncate">
								{entry.message}
							</p>
							<div className="flex items-center gap-2 mt-0.5">
								<span className="text-[10px] text-muted-foreground/50">
									{entry.author}
								</span>
								<span className="text-[10px] text-muted-foreground/30">
									{formatGitDate(entry.date)}
								</span>
							</div>
						</div>
					</div>
				</div>
			))}
		</div>
	);
}

function formatGitDate(iso: string): string {
	try {
		const d = new Date(iso);
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		if (diffMins < 1) return "just now";
		if (diffMins < 60) return `${diffMins}m ago`;
		const diffHrs = Math.floor(diffMins / 60);
		if (diffHrs < 24) return `${diffHrs}h ago`;
		const diffDays = Math.floor(diffHrs / 24);
		if (diffDays < 7) return `${diffDays}d ago`;
		return d.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
	} catch {
		return iso;
	}
}
