import { useState } from "react";
import { Shield, X, Check, AlertTriangle } from "lucide-react";
import type { PermissionRequest } from "@/types";

interface PermissionDialogProps {
	requests: PermissionRequest[];
	onRespond: (requestId: string, approved: boolean, message?: string) => void;
}

export function PermissionDialog({
	requests,
	onRespond,
}: PermissionDialogProps) {
	const [message, setMessage] = useState("");
	const [expandedId, setExpandedId] = useState<string | null>(null);

	if (requests.length === 0) return null;

	const current = requests[0];
	const isExpanded = expandedId === current.id;

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
			<div className="w-[420px] max-w-[90vw] bg-card rounded-2xl shadow-2xl border border-border overflow-hidden animate-scale-in">
				{/* Header */}
				<div className="px-5 py-4 border-b border-border flex items-center gap-3">
					<div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
						<Shield className="w-5 h-5" />
					</div>
					<div className="flex-1 min-w-0">
						<h3 className="text-[15px] font-semibold text-foreground">
							Permission Request
						</h3>
						<p className="text-[12px] text-muted-foreground">
							{requests.length > 1
								? `${requests.length} pending requests`
								: "Tool needs your approval"}
						</p>
					</div>
					<button
						type="button"
						onClick={() => onRespond(current.id, false, "Dismissed")}
						className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-all"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				{/* Content */}
				<div className="px-5 py-4 space-y-3">
					<div className="flex items-start gap-3">
						<div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
							<AlertTriangle className="w-4 h-4" />
						</div>
						<div className="flex-1 min-w-0">
							<div className="text-[13px] font-medium text-foreground">
								{current.action}
							</div>
							<div className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
								{current.description}
							</div>
							{current.rationale && (
								<button
									type="button"
									onClick={() => setExpandedId(isExpanded ? null : current.id)}
									className="mt-1.5 text-[12px] text-primary hover:underline"
								>
									{isExpanded ? "Hide rationale" : "Show rationale"}
								</button>
							)}
						</div>
					</div>

					{isExpanded && current.rationale && (
						<div className="rounded-xl bg-muted/50 border border-border p-3 text-[12px] font-mono text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto">
							{current.rationale}
						</div>
					)}

					<div className="flex items-center gap-2">
						<span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
							Urgency
						</span>
						<span
							className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
								current.urgency === "high"
									? "bg-destructive/10 text-destructive"
									: current.urgency === "normal"
										? "bg-amber-500/10 text-amber-500"
										: "bg-muted text-muted-foreground"
							}`}
						>
							{current.urgency}
						</span>
					</div>

					<input
						type="text"
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						placeholder="Optional message…"
						className="w-full h-9 px-3 rounded-xl bg-muted/50 border border-border text-[13px] text-foreground placeholder-muted-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
					/>
				</div>

				{/* Actions */}
				<div className="px-5 py-3 border-t border-border flex items-center gap-2">
					<button
						type="button"
						onClick={() => {
							onRespond(current.id, false, message || undefined);
							setMessage("");
						}}
						className="flex-1 h-9 rounded-xl text-[13px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-border hover:border-destructive/30 transition-all"
					>
						Deny
					</button>
					<button
						type="button"
						onClick={() => {
							onRespond(current.id, true, message || undefined);
							setMessage("");
						}}
						className="flex-1 h-9 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all flex items-center justify-center gap-1.5"
					>
						<Check className="w-4 h-4" />
						Approve
					</button>
				</div>
			</div>
		</div>
	);
}
