import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import {
	Activity,
	Loader2,
	Zap,
	Clock,
	FileText,
	RotateCcw,
	Pause,
	Play,
	AlertCircle,
} from "lucide-react";

interface AmbientStatus {
	enabled: boolean;
	state: string;
	last_summary?: string;
	last_compactions?: number;
	last_memories_modified?: number;
	total_cycles: number;
	scheduled_count: number;
	scheduled_items: Array<{
		type: string;
		summary: string;
		scheduled_at_ms: number;
	}>;
}

export function MonitorPage() {
	const [status, setStatus] = useState<AmbientStatus | null>(null);
	const [loading, setLoading] = useState(false);

	const fetchStatus = async () => {
		try {
			const result = await invoke<AmbientStatus>("get_ambient_status");
			setStatus(result);
		} catch (e) {
			console.error("Failed to get ambient status:", e);
		}
	};

	useEffect(() => {
		fetchStatus();
		const interval = setInterval(fetchStatus, 5000);
		return () => clearInterval(interval);
	}, []);

	const toggleAmbient = async () => {
		try {
			if (status?.enabled) {
				await invoke("stop_ambient");
			} else {
				await invoke("trigger_ambient");
			}
			await fetchStatus();
		} catch (e) {
			console.error("Ambient toggle failed:", e);
		}
	};

	const isActive = status?.enabled ?? false;

	return (
		<div className="flex-1 flex flex-col bg-card overflow-hidden">
			{/* Header */}
			<div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
				<div className="flex items-center gap-3">
					<div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
						<Activity className="w-5 h-5" />
					</div>
					<div>
						<h1 className="text-[16px] font-semibold text-foreground">
							Monitor
						</h1>
						<p className="text-[12px] text-muted-foreground">
							Ambient mode and system health
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => {
							setLoading(true);
							fetchStatus().finally(() => setLoading(false));
						}}
						className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
						title="Refresh"
					>
						<RotateCcw className={cn("w-4 h-4", loading && "animate-spin")} />
					</button>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto px-6 py-4">
				<div className="max-w-3xl mx-auto space-y-4">
					{/* Ambient status card */}
					<div className="rounded-xl border border-border bg-card p-5 space-y-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div
									className={cn(
										"w-10 h-10 rounded-xl flex items-center justify-center",
										isActive
											? "bg-emerald-500/10 text-emerald-500"
											: "bg-muted text-muted-foreground",
									)}
								>
									<Zap className="w-5 h-5" />
								</div>
								<div>
									<div className="text-[14px] font-semibold text-foreground">
										Ambient Mode
									</div>
									<div className="flex items-center gap-1.5 mt-0.5">
										<span
											className={cn(
												"w-2 h-2 rounded-full",
												isActive
													? "bg-emerald-500 animate-pulse"
													: "bg-muted-foreground/30",
											)}
										/>
										<span className="text-[12px] text-muted-foreground">
											{status?.state || "Idle"}
										</span>
									</div>
								</div>
							</div>
							<button
								type="button"
								onClick={toggleAmbient}
								className={cn(
									"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all",
									isActive
										? "bg-destructive/10 text-destructive hover:bg-destructive/20"
										: "bg-primary text-primary-foreground hover:bg-primary/90",
								)}
							>
								{isActive ? (
									<>
										<Pause className="w-3.5 h-3.5" />
										Stop
									</>
								) : (
									<>
										<Play className="w-3.5 h-3.5" />
										Start
									</>
								)}
							</button>
						</div>

						{status && (
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
								<StatCard
									label="Total Cycles"
									value={String(status.total_cycles)}
									icon={<Clock className="w-3.5 h-3.5" />}
								/>
								<StatCard
									label="Scheduled"
									value={String(status.scheduled_count)}
									icon={<FileText className="w-3.5 h-3.5" />}
								/>
								<StatCard
									label="Compactions"
									value={String(status.last_compactions ?? 0)}
									icon={<Loader2 className="w-3.5 h-3.5" />}
								/>
								<StatCard
									label="Memories"
									value={String(status.last_memories_modified ?? 0)}
									icon={<AlertCircle className="w-3.5 h-3.5" />}
								/>
							</div>
						)}

						{status?.last_summary && (
							<div className="rounded-lg bg-muted/50 border border-border p-3">
								<div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
									Last Summary
								</div>
								<p className="text-[13px] text-foreground leading-relaxed">
									{status.last_summary}
								</p>
							</div>
						)}
					</div>

					{/* Scheduled items */}
					{status && status.scheduled_items.length > 0 && (
						<div className="rounded-xl border border-border bg-card p-5 space-y-3">
							<div className="text-[13px] font-semibold text-foreground">
								Scheduled Items
							</div>
							<div className="space-y-2">
								{status.scheduled_items.map((item, i) => (
									<div
										key={i}
										className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 border border-border"
									>
										<div className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
											<FileText className="w-3 h-3" />
										</div>
										<div className="flex-1 min-w-0">
											<div className="text-[12px] font-medium text-foreground truncate">
												{item.summary}
											</div>
											<div className="text-[11px] text-muted-foreground">
												{item.type} ·{" "}
												{new Date(item.scheduled_at_ms).toLocaleString()}
											</div>
										</div>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function StatCard({
	label,
	value,
	icon,
}: {
	label: string;
	value: string;
	icon: React.ReactNode;
}) {
	return (
		<div className="rounded-lg bg-muted/30 border border-border p-3 space-y-1">
			<div className="flex items-center gap-1.5 text-muted-foreground">
				{icon}
				<span className="text-[11px] font-medium">{label}</span>
			</div>
			<div className="text-[18px] font-semibold text-foreground">{value}</div>
		</div>
	);
}
