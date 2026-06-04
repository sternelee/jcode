import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { runtimeEventVariant } from "./utils";
import { MessageSquareText } from "lucide-react";
import type { RuntimeEventItem } from "./types";

interface RuntimeEventsSectionProps {
	filteredRuntimeEvents: RuntimeEventItem[];
	runtimeFilter: string;
	setRuntimeFilter: (kind: typeof RUNTIME_KINDS[number]) => void;
	onSelectMessage?: (messageId: string) => void;
}

const RUNTIME_KINDS = [
	"all",
	"compaction",
	"rewind",
	"stdin",
	"queue",
	"memory",
	"reasoning",
	"connection",
	"other",
] as const;

export function RuntimeEventsSection({
	filteredRuntimeEvents,
	runtimeFilter,
	setRuntimeFilter,
	onSelectMessage,
}: RuntimeEventsSectionProps) {
	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Runtime events
				</div>
				<Badge variant="outline" className="text-[10px]">
					{filteredRuntimeEvents.length}
				</Badge>
			</div>
			<div className="flex flex-wrap gap-1">
				{RUNTIME_KINDS.map((kind) => (
					<button
						key={kind}
						className={cn(
							"px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors",
							runtimeFilter === kind
								? "bg-primary text-primary-foreground"
								: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
						)}
						onClick={() => setRuntimeFilter(kind)}
					>
						{kind}
					</button>
				))}
			</div>
			{filteredRuntimeEvents.length === 0 ? (
				<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
					System notices, queued prompts, stdin requests, and compaction
					events will show here.
				</div>
			) : (
				<div className="space-y-2">
					{filteredRuntimeEvents.map((event) => (
						<button
							key={event.messageId}
							type="button"
							className="w-full rounded-lg border bg-card p-3 text-left text-xs transition-colors hover:bg-secondary"
							onClick={() => onSelectMessage?.(event.messageId)}
						>
							<div className="flex items-center gap-2 mb-1.5">
								<MessageSquareText className="w-3.5 h-3.5 text-muted-foreground" />
								<span className="font-medium">{event.title}</span>
								<Badge
									variant={runtimeEventVariant(event.kind)}
									className="ml-auto text-[10px]"
								>
									{event.kind}
								</Badge>
							</div>
							<div className="text-muted-foreground break-words">
								{event.detail}
							</div>
						</button>
					))}
				</div>
			)}
		</section>
	);
}
