import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import type {
	AmbientStatusInfo,
	AmbientTranscript,
	AmbientScheduleItem,
	BrowserStatus,
} from "@/types";
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
	Globe,
	CheckCircle2,
	XCircle,
	MessageSquare,
	BookOpen,
	CalendarClock,
} from "lucide-react";

function formatDate(iso?: string): string {
	if (!iso) return "—";
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function MonitorPage() {
	const [status, setStatus] = useState<AmbientStatusInfo | null>(null);
	const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(
		null,
	);
	const [transcripts, setTranscripts] = useState<AmbientTranscript[]>([]);
	const [visibleCycle, setVisibleCycle] = useState<
		| {
				system_prompt?: string;
				initial_message?: string;
		  }
		| undefined
	>(undefined);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchStatus = async () => {
		try {
			const result = await invoke<AmbientStatusInfo>("get_ambient_status");
			setStatus(result);
		} catch (e) {
			console.error("Failed to get ambient status:", e);
		}
	};

	const fetchBrowserStatus = async () => {
		try {
			const result = await invoke<BrowserStatus>("get_browser_status");
			setBrowserStatus(result);
		} catch (e) {
			console.error("Failed to get browser status:", e);
		}
	};

	const fetchTranscripts = async () => {
		try {
			const result = await invoke<{
				transcripts: AmbientTranscript[];
				visible_cycle?: {
					system_prompt?: string;
					initial_message?: string;
				};
			}>("get_ambient_transcripts");
			setTranscripts(result.transcripts || []);
			setVisibleCycle(result.visible_cycle);
		} catch (e) {
			console.error("Failed to get ambient transcripts:", e);
		}
	};

	useEffect(() => {
		fetchStatus();
		fetchBrowserStatus();
		fetchTranscripts();
		const interval = setInterval(() => {
			fetchStatus();
			fetchBrowserStatus();
			fetchTranscripts();
		}, 5000);
		return () => clearInterval(interval);
	}, []);

	const toggleAmbient = async () => {
		try {
			setError(null);
			if (status?.enabled) {
				await invoke("stop_ambient");
			} else {
				await invoke("trigger_ambient");
			}
			await fetchStatus();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			setError(message);
			console.error("Ambient toggle failed:", e);
		}
	};

	const isActive = status?.enabled ?? false;
	const ambientStatus = status?.status || "disabled";

	const statusColor = (s: string) => {
		switch (s) {
			case "running":
				return "bg-emerald-500 animate-pulse";
			case "scheduled":
				return "bg-amber-500";
			case "paused":
				return "bg-amber-500/60";
			case "disabled":
				return "bg-muted-foreground/30";
			default:
				return "bg-primary/60";
		}
	};

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
							Promise.all([
								fetchStatus(),
								fetchBrowserStatus(),
								fetchTranscripts(),
							]).finally(() => setLoading(false));
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
					{error && (
						<div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-[13px] text-destructive">
							Failed to toggle ambient mode: {error}
						</div>
					)}

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
											className={cn("w-2 h-2 rounded-full", statusColor(ambientStatus))}
										/>
										<span className="text-[12px] text-muted-foreground capitalize">
											{ambientStatus}
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

						{status?.next_wake && (
							<div className="flex items-center gap-2 text-[12px] text-muted-foreground">
								<CalendarClock className="w-3.5 h-3.5" />
								Next wake {formatDate(status.next_wake)}
							</div>
						)}
						{status?.last_run && !status.next_wake && (
							<div className="flex items-center gap-2 text-[12px] text-muted-foreground">
								<Clock className="w-3.5 h-3.5" />
								Last run {formatDate(status.last_run)}
							</div>
						)}
					</div>

					{/* Browser status */}
					{browserStatus && (
						<div className="rounded-xl border border-border bg-card p-5 space-y-4">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-3">
									<div
										className={cn(
											"w-10 h-10 rounded-xl flex items-center justify-center",
											browserStatus.ready
												? "bg-emerald-500/10 text-emerald-500"
												: "bg-muted text-muted-foreground",
										)}
									>
										<Globe className="w-5 h-5" />
									</div>
									<div>
										<div className="text-[14px] font-semibold text-foreground">
											Browser
										</div>
										<div className="flex items-center gap-1.5 mt-0.5">
											<span
												className={cn(
													"w-2 h-2 rounded-full",
													browserStatus.ready
														? "bg-emerald-500"
														: "bg-amber-500",
												)}
											/>
											<span className="text-[12px] text-muted-foreground">
												{browserStatus.ready
													? "Ready"
													: browserStatus.binary_installed
														? "Not responding"
														: "Not installed"}
											</span>
										</div>
									</div>
								</div>
							</div>

							<div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
								<StatCard
									label="Backend"
									value={browserStatus.backend}
									icon={
										browserStatus.setup_complete ? (
											<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
										) : (
											<XCircle className="w-3.5 h-3.5 text-destructive" />
										)
									}
								/>
								<StatCard
									label="Browser"
									value={browserStatus.browser}
									icon={
										browserStatus.binary_installed ? (
											<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
										) : (
											<XCircle className="w-3.5 h-3.5 text-destructive" />
										)
									}
								/>
								<StatCard
									label="Compatible"
									value={browserStatus.compatible ? "Yes" : "No"}
									icon={
										browserStatus.compatible ? (
											<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
										) : (
											<XCircle className="w-3.5 h-3.5 text-destructive" />
										)
									}
								/>
							</div>

							{browserStatus.missing_actions.length > 0 && (
								<div className="rounded-lg bg-muted/50 border border-border p-3">
									<div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
										Missing Actions
									</div>
									<ul className="space-y-1">
										{browserStatus.missing_actions.map((action, i) => (
											<li
												key={i}
												className="text-[12px] text-muted-foreground flex items-start gap-2"
											>
												<span className="mt-1.5 w-1 h-1 rounded-full bg-muted-foreground shrink-0" />
												{action}
											</li>
										))}
									</ul>
								</div>
							)}
						</div>
					)}

					{/* Transcripts */}
					{transcripts.length > 0 && (
						<div className="rounded-xl border border-border bg-card p-5 space-y-3">
							<div className="flex items-center gap-2">
								<MessageSquare className="w-4 h-4 text-primary" />
								<div className="text-[13px] font-semibold text-foreground">
									Recent Transcripts
								</div>
							</div>
							<div className="space-y-2">
								{transcripts.slice(0, 5).map((t, i) => (
									<div
										key={i}
										className="rounded-lg bg-muted/30 border border-border p-3 space-y-1.5"
									>
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<span
													className={cn(
														"w-1.5 h-1.5 rounded-full",
														t.status === "complete"
															? "bg-emerald-500"
															: t.status === "interrupted"
																? "bg-amber-500"
																: "bg-primary/60",
													)}
												/>
												<span className="text-[12px] font-medium text-foreground">
													{t.session_id.slice(-6)}
												</span>
												<span className="text-[11px] text-muted-foreground">
													{t.provider} · {t.model}
												</span>
											</div>
											<span className="text-[10px] text-muted-foreground">
												{formatDate(t.started_at)}
											</span>
										</div>
										{t.summary && (
											<p className="text-[12px] text-muted-foreground leading-relaxed">
												{t.summary}
											</p>
										)}
										<div className="flex items-center gap-3 text-[10px] text-muted-foreground/70">
											<span>{t.actions.length} actions</span>
											<span>{t.compactions} compactions</span>
											<span>{t.memories_modified} memories</span>
											{t.pending_permissions > 0 && (
												<span className="text-amber-500">
													{t.pending_permissions} pending
												</span>
											)}
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Visible cycle */}
					{visibleCycle?.system_prompt && (
						<div className="rounded-xl border border-border bg-card p-5 space-y-3">
							<div className="flex items-center gap-2">
								<BookOpen className="w-4 h-4 text-primary" />
								<div className="text-[13px] font-semibold text-foreground">
									Visible Cycle
								</div>
							</div>
							{visibleCycle.system_prompt && (
								<div className="rounded-lg bg-muted/30 border border-border p-3">
									<div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
										System Prompt
									</div>
									<p className="text-[12px] text-foreground whitespace-pre-wrap leading-relaxed">
										{visibleCycle.system_prompt}
									</p>
								</div>
							)}
							{visibleCycle.initial_message && (
								<div className="rounded-lg bg-muted/30 border border-border p-3">
									<div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
										Initial Message
									</div>
									<p className="text-[12px] text-foreground whitespace-pre-wrap leading-relaxed">
										{visibleCycle.initial_message}
									</p>
								</div>
							)}
						</div>
					)}

					{/* Scheduled items */}
					{status && status.scheduled_items.length > 0 && (
						<div className="rounded-xl border border-border bg-card p-5 space-y-3">
							<div className="text-[13px] font-semibold text-foreground">
								Scheduled Items
							</div>
							<div className="space-y-2">
								{status.scheduled_items.map((item: AmbientScheduleItem, i: number) => (
									<div
										key={item.id || i}
										className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 border border-border"
									>
										<div className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
											<FileText className="w-3 h-3" />
										</div>
										<div className="flex-1 min-w-0">
											<div className="text-[12px] font-medium text-foreground truncate">
												{item.task_description || item.id}
											</div>
											<div className="text-[11px] text-muted-foreground">
												{item.target.kind}
												{item.target.session_id ? ` · ${item.target.session_id.slice(-6)}` : ""}
												{" · "}
												{formatDate(item.scheduled_for)}
											</div>
										</div>
										<span
											className={cn(
												"text-[10px] px-1.5 py-0.5 rounded-full border uppercase",
												item.priority === "high"
													? "bg-destructive/10 text-destructive border-destructive/20"
													: item.priority === "normal"
														? "bg-primary/10 text-primary border-primary/20"
														: "bg-muted text-muted-foreground border-border",
											)}
										>
											{item.priority}
										</span>
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
		<div className="rounded-lg border border-border bg-muted/30 p-3">
			<div className="flex items-center gap-2 text-muted-foreground mb-1">
				{icon}
				<span className="text-[10px] font-medium uppercase tracking-wider">
					{label}
				</span>
			</div>
			<div className="text-[16px] font-semibold text-foreground">{value}</div>
		</div>
	);
}
