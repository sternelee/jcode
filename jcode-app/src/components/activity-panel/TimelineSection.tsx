import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, ChevronDown, ChevronRight, ArrowUpRight, Wrench } from "lucide-react";
import { ToolCard } from "@/components/ToolCard";
import {
	boundaryBadgeVariant,
	boundaryIcon,
	turnStatusLabel,
} from "./utils";
import type { StdinPrompt } from "@/types";
import type { TimelineEntry } from "./types";

interface TimelineSectionProps {
	timelineEntries: TimelineEntry[];
	latestTurn: { messageId: string } | null;
	isProcessing: boolean;
	stdinPrompt: StdinPrompt | null;
	onSelectMessage?: (messageId: string) => void;
}

export function TimelineSection({
	timelineEntries,
	latestTurn,
	isProcessing,
	stdinPrompt,
	onSelectMessage,
}: TimelineSectionProps) {
	const [expandedTurnIds, setExpandedTurnIds] = useState<string[]>([]);
	const [turnSearch, setTurnSearch] = useState(
		() => localStorage.getItem("desktop-activity-turn-search") || "",
	);
	const [onlyErrorTurns, setOnlyErrorTurns] = useState(
		() => localStorage.getItem("desktop-activity-only-error-turns") === "true",
	);
	const [onlyToolTurns, setOnlyToolTurns] = useState(
		() => localStorage.getItem("desktop-activity-only-tool-turns") === "true",
	);

	useEffect(() => {
		if (!latestTurn) return;
		setExpandedTurnIds((current) =>
			current.includes(latestTurn.messageId)
				? current
				: [latestTurn.messageId, ...current].slice(0, 8),
		);
	}, [latestTurn?.messageId]);

	useEffect(() => {
		localStorage.setItem("desktop-activity-turn-search", turnSearch);
	}, [turnSearch]);

	useEffect(() => {
		localStorage.setItem(
			"desktop-activity-only-error-turns",
			String(onlyErrorTurns),
		);
	}, [onlyErrorTurns]);

	useEffect(() => {
		localStorage.setItem(
			"desktop-activity-only-tool-turns",
			String(onlyToolTurns),
		);
	}, [onlyToolTurns]);

	const filteredTimelineEntries = useMemo(() => {
		const query = turnSearch.trim().toLowerCase();
		return timelineEntries.filter((entry) => {
			if (entry.type === "boundary") return true;
			if (
				onlyErrorTurns &&
				!entry.turn.tools.some((tool) => tool.status === "error")
			)
				return false;
			if (onlyToolTurns && entry.turn.totalToolCount === 0) return false;
			if (!query) return true;
			const haystack = [
				entry.turn.userPrompt,
				entry.turn.assistantPreview,
				...entry.turn.tools.map((tool) => tool.name),
			]
				.join(" ")
				.toLowerCase();
			return haystack.includes(query);
		});
	}, [timelineEntries, turnSearch, onlyErrorTurns, onlyToolTurns]);

	const toggleTurn = (messageId: string) => {
		setExpandedTurnIds((current) =>
			current.includes(messageId)
				? current.filter((id) => id !== messageId)
				: [messageId, ...current],
		);
	};

	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Turn timeline
				</div>
				<Badge variant="outline" className="text-[10px]">
					{filteredTimelineEntries.length}
				</Badge>
			</div>
			<div className="rounded-lg border bg-card p-2 space-y-2">
				<div className="flex items-center gap-2 rounded border bg-secondary px-2 py-1.5">
					<Search className="w-3.5 h-3.5 text-muted-foreground" />
					<input
						value={turnSearch}
						onChange={(e) => setTurnSearch(e.target.value)}
						placeholder="Search turns, prompts, tools"
						className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
					/>
				</div>
				<div className="flex flex-wrap gap-1.5">
					<Button
						variant={onlyErrorTurns ? "secondary" : "outline"}
						size="sm"
						className="h-6 px-2 text-[10px]"
						onClick={() => setOnlyErrorTurns((value) => !value)}
					>
						error turns
					</Button>
					<Button
						variant={onlyToolTurns ? "secondary" : "outline"}
						size="sm"
						className="h-6 px-2 text-[10px]"
						onClick={() => setOnlyToolTurns((value) => !value)}
					>
						tool turns
					</Button>
				</div>
			</div>
			{filteredTimelineEntries.length === 0 ? (
				<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
					Assistant turns will appear here once the conversation starts.
				</div>
			) : (
				<div className="space-y-2">
					{filteredTimelineEntries.map((entry, index) => {
						if (entry.type === "boundary") {
							const Icon = boundaryIcon(entry.segmentKind);
							return (
								<button
									key={entry.id}
									type="button"
									className="w-full rounded-lg border border bg-background/50 p-3 text-left transition-colors hover:bg-secondary"
									onClick={() => onSelectMessage?.(entry.messageId)}
								>
									<div className="flex items-center gap-2 mb-1.5">
										<Icon className="w-3.5 h-3.5 text-muted-foreground" />
										<span className="text-xs font-semibold uppercase tracking-wide">
											{entry.title}
										</span>
										<Badge
											variant={boundaryBadgeVariant(entry.segmentKind)}
											className="ml-auto text-[10px]"
										>
											{entry.segmentKind}
										</Badge>
									</div>
									<div className="text-xs text-muted-foreground break-words">
										{entry.summary}
									</div>
								</button>
							);
						}

						const turn = entry.turn;
						const isExpanded = expandedTurnIds.includes(turn.messageId);
						const isLatest = !filteredTimelineEntries
							.slice(0, index)
							.some((item) => item.type === "turn");
						const status = turnStatusLabel(
							turn,
							isLatest,
							isProcessing,
							stdinPrompt,
						);

						return (
							<div key={entry.id} className="rounded-lg border bg-card">
								<div className="p-3 space-y-2">
									<div className="flex items-start gap-2">
										<button
											type="button"
											className="mt-0.5 text-muted-foreground"
											onClick={() => toggleTurn(turn.messageId)}
										>
											{isExpanded ? (
												<ChevronDown className="w-4 h-4" />
											) : (
												<ChevronRight className="w-4 h-4" />
											)}
										</button>
										<div className="min-w-0 flex-1 space-y-1">
											<div className="flex items-center gap-2 flex-wrap">
												<span className="text-xs font-semibold uppercase tracking-wide">
													Turn {turn.turnNumber}
												</span>
												<Badge
													variant={status.variant}
													className="text-[10px]"
												>
													{status.label}
												</Badge>
												{isLatest && (
													<Badge
														variant="secondary"
														className="text-[10px]"
													>
														latest
													</Badge>
												)}
											</div>
											<div className="text-xs text-muted-foreground break-words">
												{turn.assistantPreview ||
													"(no assistant preview)"}
											</div>
										</div>
										<Button
											variant="ghost"
											size="sm"
											className="h-7 px-2 text-[10px]"
											onClick={() => onSelectMessage?.(turn.messageId)}
										>
											Jump
											<ArrowUpRight className="w-3 h-3 ml-1" />
										</Button>
									</div>

									<div className="flex items-center gap-2 flex-wrap pl-6">
										<Badge variant="outline" className="text-[10px]">
											tools:{turn.totalToolCount}
										</Badge>
										{turn.runningToolCount > 0 && (
											<Badge variant="default" className="text-[10px]">
												active:{turn.runningToolCount}
											</Badge>
										)}
										{turn.tokenUsage && (
											<Badge
												variant="outline"
												className="text-[10px] font-mono"
											>
												↑{turn.tokenUsage.input} ↓{turn.tokenUsage.output}
												{turn.tokenUsage.cacheReadInput !== undefined &&
													turn.tokenUsage.cacheReadInput > 0 && (
														<span className="text-emerald-600 dark:text-emerald-400 ml-1">
															cache↑{turn.tokenUsage.cacheReadInput}
														</span>
													)}
												{turn.tokenUsage.cacheCreationInput !==
													undefined &&
													turn.tokenUsage.cacheCreationInput > 0 && (
														<span className="text-amber-600 dark:text-amber-400 ml-1">
															write↑{turn.tokenUsage.cacheCreationInput}
														</span>
													)}
											</Badge>
										)}
									</div>
								</div>

								{isExpanded && (
									<div className="border-t px-3 py-3 space-y-3">
										<div className="pl-6 space-y-3">
											<div>
												<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
													User prompt
												</div>
												<div className="text-xs break-words">
													{turn.userPrompt ||
														"No preceding user prompt captured."}
												</div>
											</div>

											<div>
												<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
													Assistant summary
												</div>
												<div className="text-xs text-muted-foreground break-words">
													{turn.assistantPreview ||
														"No assistant preview available."}
												</div>
											</div>

											<div>
												<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
													Tools in this turn
												</div>
												{turn.tools.length === 0 ? (
													<div className="rounded-md border border p-2 text-xs text-muted-foreground">
														No tools used in this turn.
													</div>
												) : (
													<div className="space-y-2">
														{turn.tools.map((tool, toolIndex) => (
															<div
																key={`${turn.messageId}-${tool.id}-${toolIndex}`}
																className="space-y-2"
															>
																<div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide">
																	<Wrench className="w-3 h-3" />
																	{tool.name}
																</div>
																<ToolCard tool={tool} />
															</div>
														))}
													</div>
												)}
											</div>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
