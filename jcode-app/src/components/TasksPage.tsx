import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
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

interface BackgroundTask {
	id: string;
	name: string;
	status: string;
	progress?: number;
	created_at_ms: number;
	completed_at_ms?: number;
	result_summary?: string;
	error?: string;
}

export function TasksPage() {
	const [tasks, setTasks] = useState<BackgroundTask[]>([]);
	const [loading, setLoading] = useState(false);

	const fetchTasks = async () => {
		try {
			const result = await invoke<BackgroundTask[]>("list_background_tasks");
			setTasks(result || []);
		} catch (e) {
			console.error("Failed to list tasks:", e);
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
		if (s === "completed" || s === "done")
			return <CircleCheck className="w-4 h-4 text-emerald-500" />;
		if (s === "failed" || s === "error")
			return <CircleX className="w-4 h-4 text-destructive" />;
		if (s === "running" || s === "in_progress")
			return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
		if (s === "cancelled")
			return <X className="w-4 h-4 text-muted-foreground" />;
		return <Clock className="w-4 h-4 text-muted-foreground" />;
	};

	const statusClass = (status: string) => {
		const s = status.toLowerCase();
		if (s === "completed" || s === "done")
			return "bg-emerald-500/10 text-emerald-600 border-emerald-200";
		if (s === "failed" || s === "error")
			return "bg-destructive/10 text-destructive border-destructive/20";
		if (s === "running" || s === "in_progress")
			return "bg-primary/10 text-primary border-primary/20";
		if (s === "cancelled")
			return "bg-muted text-muted-foreground border-border";
		return "bg-muted/50 text-muted-foreground border-border";
	};

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
							{tasks.length} total ·{" "}
							{
								tasks.filter((t) =>
									["running", "in_progress"].includes(t.status.toLowerCase()),
								).length
							}{" "}
							running
						</p>
					</div>
				</div>
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

			{/* Task list */}
			<div className="flex-1 overflow-y-auto px-6 py-4">
				<div className="max-w-3xl mx-auto space-y-3">
					{tasks.length === 0 && (
						<div className="flex flex-col items-center justify-center py-16 text-center">
							<Terminal className="w-10 h-10 text-muted-foreground/30 mb-3" />
							<p className="text-[14px] text-muted-foreground">
								No background tasks
							</p>
							<p className="text-[12px] text-muted-foreground/60 mt-1">
								Tasks started with /task or /run will appear here
							</p>
						</div>
					)}
					{tasks.map((task) => (
						<div
							key={task.id}
							className="rounded-xl border border-border bg-card p-4 space-y-3"
						>
							<div className="flex items-center justify-between gap-3">
								<div className="flex items-center gap-2.5 min-w-0">
									{statusIcon(task.status)}
									<span className="text-[14px] font-medium text-foreground truncate">
										{task.name}
									</span>
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
									{["running", "in_progress", "pending"].includes(
										task.status.toLowerCase(),
									) && (
										<button
											type="button"
											onClick={() => handleCancel(task.id)}
											className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all"
											title="Cancel"
										>
											<X className="w-3 h-3" />
										</button>
									)}
								</div>
							</div>

							{typeof task.progress === "number" && (
								<div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
									<div
										className="h-full bg-primary rounded-full transition-all duration-500"
										style={{ width: `${task.progress}%` }}
									/>
								</div>
							)}

							{task.result_summary && (
								<p className="text-[12px] text-muted-foreground leading-relaxed">
									{task.result_summary}
								</p>
							)}
							{task.error && (
								<p className="text-[12px] text-destructive leading-relaxed">
									{task.error}
								</p>
							)}

							<div className="flex items-center gap-3 text-[11px] text-muted-foreground/60">
								<span>
									Created {new Date(task.created_at_ms).toLocaleString()}
								</span>
								{task.completed_at_ms && (
									<span>
										Completed {new Date(task.completed_at_ms).toLocaleString()}
									</span>
								)}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
