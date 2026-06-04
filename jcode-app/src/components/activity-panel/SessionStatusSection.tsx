import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { providerLabel } from "./utils";
import {
	Sparkles,
	Brain,
	Cable,
	ListTodo,
	Keyboard,
	Clock3,
	Copy,
} from "lucide-react";
import type { ModelRoute, StdinPrompt } from "@/types";

interface SessionStatusSectionProps {
	providerModel: string | null;
	providerName: string | null;
	sessionId: string | null;
	availableModels: string[];
	availableModelRoutes: ModelRoute[];
	reasoningEffort: string | null;
	connectionType: string | null;
	queuedDraftCount: number;
	stdinPrompt: StdinPrompt | null;
	totalTokens: [number, number] | null;
	statusDetail: string | null;
}

export function SessionStatusSection({
	providerModel,
	providerName,
	sessionId,
	availableModels,
	availableModelRoutes,
	reasoningEffort,
	connectionType,
	queuedDraftCount,
	stdinPrompt,
	totalTokens,
	statusDetail,
}: SessionStatusSectionProps) {
	const currentRoute = useMemo(
		() =>
			availableModelRoutes.find(
				(route) =>
					route.model === providerModel &&
					(!providerName || route.provider === providerName),
			) ||
			availableModelRoutes.find((route) => route.model === providerModel) ||
			null,
		[availableModelRoutes, providerModel, providerName],
	);

	return (
		<section className="space-y-2">
			<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Session status
			</div>
			<div className="grid grid-cols-1 gap-2">
				<div className="rounded-lg border bg-card p-3 space-y-2">
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<Sparkles className="w-3.5 h-3.5" />
						Model
					</div>
					<div className="text-sm font-medium break-all">
						{providerModel || "unknown"}
					</div>
					<div className="text-[11px] text-muted-foreground">
						{providerLabel(providerName)}
					</div>
					<div className="flex flex-wrap gap-1.5 pt-1">
						{sessionId && (
							<Badge variant="outline" className="text-[10px] font-mono">
								session {sessionId.slice(-8)}
							</Badge>
						)}
						{availableModels.length > 0 && (
							<Badge variant="secondary" className="text-[10px]">
								{availableModels.length} switchable models
							</Badge>
						)}
						{availableModelRoutes.length > 0 && (
							<Badge variant="secondary" className="text-[10px]">
								{
									availableModelRoutes.filter(
										(route) => route.context_window,
									).length
								}{" "}
								context-known
							</Badge>
						)}
					</div>
				</div>

				<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
					<div className="flex items-center justify-between gap-2">
						<span className="inline-flex items-center gap-1.5 text-muted-foreground">
							<Brain className="w-3.5 h-3.5" />
							Reasoning
						</span>
						<span className="font-mono">
							{reasoningEffort || "default"}
						</span>
					</div>
					<div className="flex items-center justify-between gap-2">
						<span className="inline-flex items-center gap-1.5 text-muted-foreground">
							<Cable className="w-3.5 h-3.5" />
							Connection
						</span>
						<span className="font-mono text-right">
							{connectionType || "unknown"}
						</span>
					</div>
					<div className="flex items-center justify-between gap-2">
						<span className="inline-flex items-center gap-1.5 text-muted-foreground">
							<ListTodo className="w-3.5 h-3.5" />
							Queued drafts
						</span>
						<span className="font-mono">{queuedDraftCount}</span>
					</div>
					<div className="flex items-center justify-between gap-2">
						<span className="inline-flex items-center gap-1.5 text-muted-foreground">
							<Keyboard className="w-3.5 h-3.5" />
							Interactive input
						</span>
						<span className="font-mono">
							{stdinPrompt ? "pending" : "none"}
						</span>
					</div>
					{totalTokens && (
						<div className="flex items-center justify-between gap-2">
							<span className="inline-flex items-center gap-1.5 text-muted-foreground">
								<Clock3 className="w-3.5 h-3.5" />
								Tokens
							</span>
							<span className="font-mono">
								↑{totalTokens[0]} ↓{totalTokens[1]}
							</span>
						</div>
					)}
					{statusDetail && (
						<div className="rounded border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground">
							{statusDetail}
						</div>
					)}
					{availableModelRoutes.length > 0 && (
						<div className="rounded border bg-secondary px-2 py-2 space-y-1.5">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
								Runtime capabilities
							</div>
							<div className="flex flex-wrap gap-1.5">
								{availableModelRoutes.some(
									(route) =>
										route.context_window &&
											route.context_window >= 100000,
								) && (
									<Badge variant="outline" className="text-[10px]">
										long-context
									</Badge>
								)}
								{availableModelRoutes.some((route) =>
									Boolean(route.display_name),
								) && (
									<Badge variant="outline" className="text-[10px]">
										rich-catalog
									</Badge>
								)}
								{availableModelRoutes.length > 1 && (
									<Badge variant="outline" className="text-[10px]">
										multi-route
									</Badge>
								)}
								{availableModels.length > 1 && (
									<Badge variant="outline" className="text-[10px]">
										hot-switch
									</Badge>
								)}
							</div>
						</div>
					)}
					{currentRoute && (
						<div className="rounded border bg-secondary px-2 py-2 space-y-1.5">
							<div className="flex items-center justify-between gap-2">
								<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
									Current route metadata
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="h-6 px-2 text-[10px]"
									onClick={() =>
										navigator.clipboard.writeText(
											JSON.stringify(currentRoute, null, 2),
										)
									}
								>
									<Copy className="w-3 h-3 mr-1" />
									copy
								</Button>
							</div>
							<pre className="rounded border bg-background/60 px-2 py-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground leading-relaxed">
								{JSON.stringify(currentRoute, null, 2)}
							</pre>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
