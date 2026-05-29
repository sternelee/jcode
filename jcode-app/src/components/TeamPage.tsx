import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "@/types";
import { Users, LayoutList, GitPullRequest } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";

interface TeamPageProps {
	sessions: SessionInfo[];
}

export function TeamPage({ sessions }: TeamPageProps) {
	const swarmSessions = useMemo(
		() => sessions.filter((s) => s.swarmEnabled || s.swarmRole),
		[sessions],
	);

	const coordinators = useMemo(
		() => swarmSessions.filter((s) => s.swarmRole === "coordinator"),
		[swarmSessions],
	);

	const agents = useMemo(
		() => swarmSessions.filter((s) => s.roleName),
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

	return (
		<div className="flex-1 flex flex-col bg-card overflow-hidden">
			{/* Header */}
			<div className="px-6 py-4 border-b border-border flex items-center gap-3 shrink-0">
				<div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
					<Users className="w-5 h-5" />
				</div>
				<div>
					<h1 className="text-[16px] font-semibold text-foreground">Team</h1>
					<p className="text-[12px] text-muted-foreground">
						{agents.length} agents · {coordinators.length} coordinator
						{coordinators.length !== 1 ? "s" : ""}
					</p>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto px-6 py-4">
				<div className="max-w-3xl mx-auto space-y-4">
					{/* Agents */}
					{agents.length > 0 && (
						<div className="rounded-xl border border-border bg-card p-5 space-y-3">
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

					{/* Plans */}
					{plans.map((plan) => (
						<div
							key={plan.swarmId}
							className="rounded-xl border border-border bg-card p-5 space-y-3"
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
							<div className="grid grid-cols-3 gap-2">
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
							</div>
							{plan.reason && (
								<p className="text-[12px] text-muted-foreground">
									{plan.reason}
								</p>
							)}
						</div>
					))}

					{/* Proposals */}
					{proposals.map((proposal) => (
						<div
							key={proposal.swarmId}
							className="rounded-xl border border-border bg-card p-5 space-y-3"
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
							<div className="flex items-center gap-4 text-[11px] text-muted-foreground">
								<span>{proposal.itemCount} items</span>
								<span>By {proposal.proposerName || "Unknown"}</span>
							</div>
						</div>
					))}

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
