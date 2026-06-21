import { useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "@/types";
import {
	Users,
	LayoutList,
	GitPullRequest,
	CheckCircle2,
	XCircle,
	Loader2,
	AlertCircle,
} from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { RolePresetsPanel } from "./RolePresetsPanel";

interface TeamPageProps {
	sessions: SessionInfo[];
	/** Available model routes for the model picker */
	availableModels?: string[];
}

export function TeamPage({ sessions, availableModels = [] }: TeamPageProps) {
	const swarmSessions = useMemo(
		() => sessions.filter((s) => s.swarmEnabled || s.swarmRole),
		[sessions],
	);

	const coordinators = useMemo(
		() => swarmSessions.filter((s) => s.swarmRole === "coordinator"),
		[swarmSessions],
	);

	const agents = useMemo(
		() => swarmSessions.filter((s) => s.swarmRole === "agent"),
		[swarmSessions],
	);

	const plans = useMemo(() => {
		const map = new Map<string, NonNullable<SessionInfo["swarmPlan"]>>();
		for (const s of swarmSessions) {
			if (s.swarmPlan && !map.has(s.swarmPlan.swarmId)) {
				map.set(s.swarmPlan.swarmId, s.swarmPlan);
			}
		}
		return Array.from(map.values());
	}, [swarmSessions]);

	const proposals = useMemo(() => {
		const map = new Map<string, NonNullable<SessionInfo["swarmProposal"]>>();
		for (const s of swarmSessions) {
			if (s.swarmProposal && !map.has(s.swarmProposal.swarmId)) {
				map.set(s.swarmProposal.swarmId, s.swarmProposal);
			}
		}
		return Array.from(map.values());
	}, [swarmSessions]);

	const [proposalAction, setProposalAction] = useState<
		{ key: string; kind: "approving" | "rejecting" } | null
	>(null);
	const [proposalError, setProposalError] = useState<string | null>(null);

	const handleProposalAction = useCallback(
		async (
			proposal: SessionInfo["swarmProposal"],
			action: "approve" | "reject",
		) => {
			if (!proposal) return;
			const coordinator = coordinators.find(
				(c) => c.swarmId === proposal.swarmId,
			);
			if (!coordinator) {
				setProposalError("No coordinator found for this swarm.");
				return;
			}
			setProposalAction({
				key: proposal.proposalKey,
				kind: action === "approve" ? "approving" : "rejecting",
			});
			setProposalError(null);
			try {
				if (action === "approve") {
					await invoke("comm_approve_plan", {
						session_id: coordinator.sessionId,
						proposer_session: proposal.proposerSession,
					});
				} else {
					await invoke("comm_reject_plan", {
						session_id: coordinator.sessionId,
						proposer_session: proposal.proposerSession,
						reason: "Rejected from Team page",
					});
				}
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				setProposalError(message);
			} finally {
				setProposalAction(null);
			}
		},
		[coordinators],
	);

	return (
		<>
			<div className="flex-1 flex flex-col min-w-0 bg-card overflow-hidden overflow-x-hidden">
				{/* Header */}
				<div className="px-4 md:px-6 py-3 md:py-4 border-b border-border flex items-center gap-2 md:gap-3 shrink-0">
					<div className="w-7 h-7 md:w-9 md:h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
						<Users className="w-4 h-4 md:w-5 md:h-5" />
					</div>
					<div className="min-w-0">
						<h1 className="text-[14px] md:text-[16px] font-semibold text-foreground">
							Team
						</h1>
						<p className="text-[11px] md:text-[12px] text-muted-foreground">
							{agents.length} agents · {coordinators.length} coordinator
							{coordinators.length !== 1 ? "s" : ""}
						</p>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 py-3 md:py-4 min-w-0">
					<div className="max-w-3xl mx-auto space-y-4">
						{/* Agents */}
						{agents.length > 0 && (
							<div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
								<div className="text-[13px] font-semibold text-foreground flex items-center gap-2">
									<Users className="w-4 h-4 text-primary" />
									Active Agents
								</div>
								<div className="space-y-2">
									{agents.map((agent) => (
										<div
											key={agent.sessionId}
											className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/30 border border-border"
										>
											<AgentAvatar name={agent.roleName || "Agent"} size="sm" />
											<div className="flex-1 min-w-0">
												<div className="text-[13px] font-medium text-foreground truncate">
													{agent.roleName}
												</div>
												<div className="text-[11px] text-muted-foreground truncate">
													{agent.model || "default"}
												</div>
											</div>
											<div className="flex items-center gap-1.5 shrink-0">
												<span
													className={cn(
														"w-2 h-2 rounded-full",
														agent.liveProcessing
															? "bg-primary animate-pulse"
															: "bg-emerald-500",
													)}
												/>
												<span className="text-[11px] text-muted-foreground">
													{agent.liveProcessing ? "Working" : "Ready"}
												</span>
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Coordinators */}
						{coordinators.length > 0 && (
							<div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
								<div className="text-[13px] font-semibold text-foreground flex items-center gap-2">
									<Users className="w-4 h-4 text-primary" />
									Active Coordinators
								</div>
								<div className="space-y-2">
									{coordinators.map((c) => (
										<div
											key={c.sessionId}
											className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/30 border border-border"
										>
											<AgentAvatar name={c.roleName || "Coordinator"} size="sm" />
											<div className="flex-1 min-w-0">
												<div className="text-[13px] font-medium text-foreground truncate">
													{c.roleName || "Coordinator"}
												</div>
												<div className="text-[11px] text-muted-foreground truncate">
													{c.model || "default"}
												</div>
											</div>
											<span className="text-[11px] text-emerald-500 shrink-0">
												Active
											</span>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Plans */}
						{plans.map((plan) => (
							<div
								key={plan.swarmId}
								className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3"
							>
								<div className="flex items-center gap-2">
									<LayoutList className="w-4 h-4 text-primary" />
									<span className="text-[13px] font-semibold text-foreground">
										Plan v{plan.version}
									</span>
									<span className="ml-auto text-[11px] text-muted-foreground">
										{plan.itemCount} items
									</span>
								</div>
								<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
									<MiniStat
										label="Ready"
										value={plan.readyCount}
										color="text-emerald-500"
									/>
									<MiniStat
										label="Active"
										value={plan.activeCount}
										color="text-primary"
									/>
									<MiniStat
										label="Blocked"
										value={plan.blockedCount}
										color="text-amber-500"
									/>
									<MiniStat
										label="Done"
										value={plan.completedCount}
										color="text-emerald-500/80"
									/>
								</div>
								{plan.reason && (
									<p className="text-[12px] text-muted-foreground">
										{plan.reason}
									</p>
								)}
							</div>
						))}

						{/* Proposals */}
						{proposalError && (
							<div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-[12px] text-destructive flex items-start gap-2">
								<AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
								{proposalError}
							</div>
						)}
						{proposals.map((proposal) => {
							const isActing = proposalAction?.key === proposal.proposalKey;
							return (
								<div
									key={proposal.swarmId}
									className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3"
								>
									<div className="flex items-center gap-2">
										<GitPullRequest className="w-4 h-4 text-primary" />
										<span className="text-[13px] font-semibold text-foreground">
											Proposal
										</span>
									</div>
									<p className="text-[13px] text-foreground leading-relaxed">
										{proposal.summary}
									</p>
									<div className="flex items-center justify-between gap-3">
										<div className="flex items-center gap-4 text-[11px] text-muted-foreground">
											<span>{proposal.itemCount} items</span>
											<span>
												By {proposal.proposerName || "Unknown"}
											</span>
										</div>
										<div className="flex items-center gap-2">
											<button
												type="button"
												disabled={isActing}
												onClick={() =>
													handleProposalAction(proposal, "approve")
												}
												className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
											>
												{isActing && proposalAction?.kind === "approving" ? (
													<Loader2 className="w-3 h-3 animate-spin" />
												) : (
													<CheckCircle2 className="w-3 h-3" />
												)}
												Approve
											</button>
											<button
												type="button"
												disabled={isActing}
												onClick={() =>
													handleProposalAction(proposal, "reject")
												}
												className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-colors"
											>
												{isActing && proposalAction?.kind === "rejecting" ? (
													<Loader2 className="w-3 h-3 animate-spin" />
												) : (
													<XCircle className="w-3 h-3" />
												)}
												Reject
											</button>
										</div>
									</div>
								</div>
							);
						})}

						{/* Preset Roles */}
						<RolePresetsPanel availableModels={availableModels} />

						{agents.length === 0 && plans.length === 0 && (
							<div className="flex flex-col items-center justify-center py-16 text-center">
								<Users className="w-10 h-10 text-muted-foreground/30 mb-3" />
								<p className="text-[14px] text-muted-foreground">
									No active swarm
								</p>
								<p className="text-[12px] text-muted-foreground/60 mt-1">
									Create a swarm session to see agent coordination here
								</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</>
	);
}

function MiniStat({
	label,
	value,
	color,
}: {
	label: string;
	value: number;
	color: string;
}) {
	return (
		<div className="rounded-lg bg-muted/30 border border-border p-2.5 text-center">
			<div className={cn("text-[16px] font-semibold", color)}>{value}</div>
			<div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
		</div>
	);
}
