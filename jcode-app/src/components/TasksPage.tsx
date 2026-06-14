import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import type { BackgroundTask } from "@/types";
import {
	ListTodo,
	Loader2,
	CircleCheck,
	CircleX,
	Clock,
	RotateCcw,
	X,
	Terminal,
} from "lucide-react";

function formatDate(iso?: string): string {
	if (!iso) return "—";
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function formatDuration(seconds?: number): string {
	if (seconds === undefined || seconds === null) return "";
	if (seconds < 60) return `${Math.round(seconds)}s`;
	const mins = Math.floor(seconds / 60);
	const secs = Math.round(seconds % 60);
	if (mins < 60) return `${mins}m ${secs}s`;
	const hrs = Math.floor(mins / 60);
	return `${hrs}h ${mins % 60}m`;
}

export function TasksPage() {
	const [tasks, setTasks] = useState<BackgroundTask[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchTasks = async () => {
		try {
			setError(null);
			const result = await invoke<BackgroundTask[]>("list_background_tasks");
			setTasks(result || []);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.error("Failed to list tasks:", message);
			setError(message);
		}
	};

	useEffect(() => {
		fetchTasks();
		const interval = setInterval(fetchTasks, 5000);
		return () => clearInterval(interval);
	}, []);

	const handleCancel = async (taskId: string) => {
		try {
			await invoke("cancel_background_task", { taskId });
			await fetchTasks();
		} catch (e) {
			console.error("Cancel failed:", e);
		}
	};

	const statusIcon = (status: string) => {
		const s = status.toLowerCase();
		if (s === "completed") return <CircleCheck className="w-4 h-4 text-emerald-500" />;
		if (s === "failed") return <CircleX className="w-4 h-4 text-destructive" />;
		if (s === "running") return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
		if (s === "superseded") return <Clock className="w-4 h-4 text-muted-foreground" />;
		return <Clock className="w-4 h-4 text-muted-foreground" />;
	};

	const statusClass = (status: string) => {
		const s = status.toLowerCase();
		if (s === "completed") return "bg-emerald-500/10 text-emerald-600 border-emerald-200";
		if (s === "failed") return "bg-destructive/10 text-destructive border-destructive/20";
		if (s === "running") return "bg-primary/10 text-primary border-primary/20";
		if (s === "superseded") return "bg-muted text-muted-foreground border-border";
		return "bg-muted/50 text-muted-foreground border-border";
	};

	const runningCount = tasks.filter((t) => t.status === "running").length;
	const completedCount = tasks.filter((t) => t.status === "completed").length;
	const failedCount = tasks.filter((t) => t.status === "failed").length;

	return (
		<div className="flex-1 flex flex-col bg-card overflow-hidden">
			{/* Header */}
			<div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
				<div className="flex items-center gap-3">
					<div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
						<ListTodo className="w-5 h-5" />
					</div>
					<div>
						<h1 className="text-[16px] font-semibold text-foreground">
							Background Tasks
						</h1>
						<p className="text-[12px] text-muted-foreground">
							{tasks.length} total · {runningCount} running · {completedCount} done ·{" "}
							{failedCount} failed
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => {
							setLoading(true);
							fetchTasks().finally(() => setLoading(false));
						}}
						className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
						title="Refresh"
					>
						<RotateCcw className={cn("w-4 h-4", loading && "animate-spin")} />
					</button>
				</div>
			</div>

			{/* Task list */}
			<div className="flex-1 overflow-y-auto px-6 py-4">
				<div className="max-w-3xl mx-auto space-y-3">
					{error && (
						<div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-[13px] text-destructive">
							Failed to load tasks: {error}
						</div>
					)}

					{tasks.length === 0 && !error && (
						<div className="flex flex-col items-center justify-center py-16 text-center">
							<Terminal className="w-10 h-10 text-muted-foreground/30 mb-3" />
							<p className="text-[14px] text-muted-foreground">
								No background tasks
							</p>
							<p className="text-[12px] text-muted-foreground/60 mt-1 max-w-xs">
								Start one from chat with{" "}
								<code className="px-1 py-0.5 rounded bg-muted">/task</code>,{" "}
								<code className="px-1 py-0.5 rounded bg-muted">/run</code>, or{" "}
								<code className="px-1 py-0.5 rounded bg-muted">/overnight</code>
							</p>
						</div>
					)}

					{tasks.map((task) => (
						<div
							key={task.task_id}
							className="rounded-xl border border-border bg-card p-4 space-y-3"
						>
							<div className="flex items-center justify-between gap-3">
								<div className="flex items-center gap-2.5 min-w-0">
									{statusIcon(task.status)}
									<div className="min-w-0">
										<span className="block text-[14px] font-medium text-foreground truncate">
											{task.display_name || task.tool_name}
										</span>
										<span className="block text-[11px] text-muted-foreground font-mono truncate">
											{task.task_id}
											{task.detached && (
												<span className="ml-2 px-1.5 py-0 rounded bg-muted text-[10px]">
													detached
												</span>
											)}
										</span>
									</div>
								</div>
								<div className="flex items-center gap-2 shrink-0">
									<span
										className={cn(
											"px-2 py-0.5 rounded-full text-[11px] font-medium border",
											statusClass(task.status),
										)}
									>
										{task.status}
									</span>
									{task.status === "running" && (
										<button
											type="button"
											onClick={() => handleCancel(task.task_id)}
											className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all"
											title="Cancel"
										>
											<X className="w-3 h-3" />
										</button>
									)}
								</div>
							</div>

							{task.progress && (
								<div className="space-y-1.5">
									{task.progress.percent !== undefined && (
										<div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
											<div
												className="h-full bg-primary rounded-full transition-all duration-500"
												style={{ width: `${Math.min(task.progress.percent, 100)}%` }}
											/>
										</div>
									)}
									<div className="flex items-center gap-2 text-[11px] text-muted-foreground">
										{task.progress.message && <span>{task.progress.message}</span>}
										{task.progress.current !== undefined &&
											task.progress.total !== undefined && (
												<span>
													{task.progress.current}/{task.progress.total}
													{task.progress.unit ? ` ${task.progress.unit}` : ""}
												</span>
											)}
										{task.progress.eta_seconds !== undefined && (
											<span>ETA {formatDuration(task.progress.eta_seconds)}</span>
										)}
									</div>
								</div>
							)}

							{task.error && (
								<p className="text-[12px] text-destructive leading-relaxed">
									{task.error}
								</p>
							)}

							<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/60">
								<span>Started {formatDate(task.started_at)}</span>
								{task.completed_at && (
									<span>Completed {formatDate(task.completed_at)}</span>
								)}
								{task.duration_secs !== undefined && (
									<span>Duration {formatDuration(task.duration_secs)}</span>
								)}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
