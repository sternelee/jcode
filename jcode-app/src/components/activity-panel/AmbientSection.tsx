import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Moon, RotateCcw, Timer } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { AmbientStatusInfo, AmbientTranscript } from "@/types";

interface AmbientSectionProps {
	triggerAmbient?: () => Promise<boolean>;
	stopAmbient?: () => Promise<boolean>;
}

export function AmbientSection({
	triggerAmbient,
	stopAmbient,
}: AmbientSectionProps) {
	const [ambientStatus, setAmbientStatus] = useState<AmbientStatusInfo | null>(
		null,
	);
	const [ambientTranscripts, setAmbientTranscripts] = useState<
		AmbientTranscript[] | null
	>(null);

	const refreshAmbient = async () => {
		try {
			const status = await invoke<AmbientStatusInfo>("get_ambient_status");
			setAmbientStatus(status);
		} catch {
			setAmbientStatus(null);
		}
	};

	const refreshAmbientTranscripts = async () => {
		try {
			const result = await invoke<{ transcripts: AmbientTranscript[] }>(
				"get_ambient_transcripts",
			);
			setAmbientTranscripts(result.transcripts);
		} catch {
			setAmbientTranscripts(null);
		}
	};

	useEffect(() => {
		void refreshAmbient();
		void refreshAmbientTranscripts();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Ambient
				</div>
				<div className="flex items-center gap-2">
					<Badge variant="outline" className="text-[10px]">
						{ambientStatus?.scheduled_count ?? "–"}
					</Badge>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[10px]"
						onClick={() => {
							void refreshAmbient();
							void refreshAmbientTranscripts();
						}}
					>
						<RotateCcw className="w-3 h-3 mr-1" />
						Refresh
					</Button>
					{triggerAmbient && (
						<Button
							variant="secondary"
							size="sm"
							className="h-6 px-2 text-[10px]"
							disabled={
								ambientStatus?.status === "running" ||
								ambientStatus?.status === "disabled"
							}
							onClick={() => {
								void triggerAmbient().then((ok: boolean) => {
									if (ok) {
										void refreshAmbient();
										void refreshAmbientTranscripts();
									}
								});
							}}
						>
							Trigger
						</Button>
					)}
					{stopAmbient && (
						<Button
							variant="outline"
							size="sm"
							className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
							disabled={ambientStatus?.status === "disabled"}
							onClick={() => {
								void stopAmbient().then((ok: boolean) => {
									if (ok) {
										void refreshAmbient();
										void refreshAmbientTranscripts();
									}
								});
							}}
						>
							Stop
						</Button>
					)}
				</div>
			</div>
			{ambientStatus ? (
				<div className="space-y-2">
					<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-center gap-1.5">
								<Moon className="w-3.5 h-3.5 text-muted-foreground" />
								<span className="font-medium">Status</span>
							</div>
							<Badge
								variant={
									ambientStatus.status === "running"
										? "default"
										: ambientStatus.status === "scheduled"
											? "secondary"
											: "outline"
								}
								className="text-[10px] uppercase"
							>
								{ambientStatus.status}
							</Badge>
						</div>
						{!ambientStatus.enabled && (
							<div className="text-[11px] text-muted-foreground">
								Ambient mode is disabled in configuration.
							</div>
						)}
						{ambientStatus.last_run && (
							<div className="flex items-center justify-between gap-2">
								<span className="text-muted-foreground">Last run</span>
								<span className="font-mono">
									{new Date(ambientStatus.last_run).toLocaleString()}
								</span>
							</div>
						)}
						{ambientStatus.total_cycles > 0 && (
							<div className="flex items-center justify-between gap-2">
								<span className="text-muted-foreground">Total cycles</span>
								<span className="font-mono">
									{ambientStatus.total_cycles}
								</span>
							</div>
						)}
						{ambientStatus.last_summary && (
							<div className="rounded border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground">
								{ambientStatus.last_summary}
							</div>
						)}
						{ambientStatus.next_wake && (
							<div className="flex items-center justify-between gap-2">
								<span className="inline-flex items-center gap-1.5 text-muted-foreground">
									<Timer className="w-3.5 h-3.5" />
									Next wake
								</span>
								<span className="font-mono">
									{new Date(ambientStatus.next_wake).toLocaleString()}
								</span>
							</div>
						)}
						<div className="flex flex-wrap gap-1 pt-1">
							{ambientStatus.last_compactions !== undefined && (
								<Badge variant="outline" className="text-[10px]">
									compactions {ambientStatus.last_compactions}
								</Badge>
							)}
							{ambientStatus.last_memories_modified !== undefined && (
								<Badge variant="outline" className="text-[10px]">
									memories {ambientStatus.last_memories_modified}
								</Badge>
							)}
						</div>
					</div>
					{ambientStatus.scheduled_items.length > 0 && (
						<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
								Scheduled items
							</div>
							<div className="space-y-2">
								{ambientStatus.scheduled_items.map((item) => (
									<div
										key={item.id}
										className="rounded border bg-secondary px-2 py-2 space-y-1"
									>
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0">
												<div className="font-medium break-words">
													{item.task_description || item.context}
												</div>
												<div className="text-[10px] text-muted-foreground font-mono">
													{item.id}
												</div>
											</div>
											<div className="flex flex-wrap gap-1">
												<Badge
													variant="outline"
													className="text-[10px] uppercase"
												>
													{item.priority}
												</Badge>
												<Badge variant="outline" className="text-[10px]">
													{item.target.kind}
												</Badge>
											</div>
										</div>
										<div className="text-[10px] text-muted-foreground">
											{new Date(item.scheduled_for).toLocaleString()}
										</div>
									</div>
								))}
							</div>
						</div>
					)}
					{ambientTranscripts && ambientTranscripts.length > 0 && (
						<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
								Recent transcripts
							</div>
							<div className="space-y-2">
								{ambientTranscripts.slice(0, 5).map((tx) => (
									<div
										key={tx.session_id + tx.started_at}
										className="rounded border bg-secondary px-2 py-2 space-y-1"
									>
										<div className="flex items-center justify-between gap-2">
											<span className="font-medium">
												{tx.provider} · {tx.model}
											</span>
											<Badge
												variant={
													tx.status === "complete"
														? "secondary"
														: "outline"
												}
												className="text-[10px]"
											>
												{tx.status}
											</Badge>
										</div>
										<div className="text-[10px] text-muted-foreground">
											{new Date(tx.started_at).toLocaleString()}
											{tx.ended_at
												? ` – ${new Date(tx.ended_at).toLocaleString()}`
												: ""}
										</div>
										{tx.summary && (
											<div className="text-[11px] text-muted-foreground break-words">
												{tx.summary}
											</div>
										)}
										<div className="flex flex-wrap gap-1">
											<Badge variant="outline" className="text-[10px]">
												{tx.compactions} compactions
											</Badge>
											<Badge variant="outline" className="text-[10px]">
												{tx.memories_modified} memories
											</Badge>
											<Badge variant="outline" className="text-[10px]">
												{tx.pending_permissions} pending permissions
											</Badge>
										</div>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			) : (
				<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
					Ambient status unavailable.
				</div>
			)}
		</section>
	);
}
