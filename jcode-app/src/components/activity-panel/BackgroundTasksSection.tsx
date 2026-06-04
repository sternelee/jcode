import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock3 } from "lucide-react";
import type { BackgroundTask } from "@/types";

interface BackgroundTasksSectionProps {
	listBackgroundTasks?: () => Promise<BackgroundTask[]>;
	cancelBackgroundTask?: (taskId: string) => Promise<boolean>;
}

export function BackgroundTasksSection({
	listBackgroundTasks,
	cancelBackgroundTask,
}: BackgroundTasksSectionProps) {
	const [backgroundTasks, setBackgroundTasks] = useState<
		BackgroundTask[] | null
	>(null);

	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
					<Clock3 className="w-3.5 h-3.5 text-muted-foreground" />
					Background tasks
				</div>
				<Badge variant="outline" className="text-[10px]">
					{backgroundTasks?.length ?? "—"}
				</Badge>
			</div>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-7 text-[10px]"
					onClick={async () => {
						if (!listBackgroundTasks) return;
						try {
							const tasks = await listBackgroundTasks();
							setBackgroundTasks(tasks);
						} catch {
							// ignore
						}
					}}
				>
					Refresh
				</Button>
			</div>
			{backgroundTasks && backgroundTasks.length > 0 ? (
				<div className="space-y-2">
					{backgroundTasks.slice(0, 10).map((task) => (
						<div
							key={task.task_id}
							className="rounded border bg-secondary px-2 py-2 space-y-1 text-xs"
						>
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0">
									<div className="font-medium">
										{task.display_name || task.tool_name}
									</div>
									<div className="text-[10px] text-muted-foreground font-mono">
										{task.task_id}
									</div>
								</div>
								<div className="flex flex-wrap gap-1">
									<Badge
										variant={
											task.status === "running"
												? "default"
												: task.status === "completed"
													? "secondary"
													: "outline"
										}
										className="text-[10px] uppercase"
									>
										{task.status}
									</Badge>
									{task.detached && (
										<Badge variant="outline" className="text-[10px]">
											detached
										</Badge>
									)}
								</div>
							</div>
							{task.progress && (
								<div className="space-y-1">
									{task.progress.percent !== undefined && (
										<div className="h-1.5 rounded-full bg-muted overflow-hidden">
											<div
												className="h-full bg-primary transition-all"
												style={{
													width: `${Math.min(task.progress.percent, 100)}%`,
												}}
											/>
										</div>
										)}
										<div className="text-[10px] text-muted-foreground">
											{task.progress.message || ""}
											{task.progress.current !== undefined &&
											task.progress.total !== undefined
												? ` (${task.progress.current}/${task.progress.total})`
												: ""}
										</div>
									</div>
								)}
							{task.status === "running" && cancelBackgroundTask && (
								<Button
									variant="ghost"
									size="sm"
									className="h-5 px-1.5 text-[10px] text-destructive"
									onClick={async () => {
										try {
											await cancelBackgroundTask(task.task_id);
											if (listBackgroundTasks) {
												const tasks = await listBackgroundTasks();
												setBackgroundTasks(tasks);
											}
										} catch {
											// ignore
										}
									}}
								>
									Cancel
								</Button>
							)}
						</div>
					))}
				</div>
			) : (
				<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
					No background tasks found.
				</div>
			)}
		</section>
	);
}
