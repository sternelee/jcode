import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { SidePanelSnapshot } from "@/types";
import { PanelRightOpen, PanelRightClose, FileText, X } from "lucide-react";

interface SidePanelProps {
	snapshot: SidePanelSnapshot | null;
	open: boolean;
	onToggle: () => void;
}

export function SidePanel({ snapshot, open, onToggle }: SidePanelProps) {
	const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

	const focusedPage = useMemo(() => {
		if (!snapshot || snapshot.pages.length === 0) return null;
		const focusedId = selectedPageId || snapshot.focused_page_id;
		if (focusedId) {
			const page = snapshot.pages.find((p) => p.id === focusedId);
			if (page) return page;
		}
		return snapshot.pages[0];
	}, [snapshot, selectedPageId]);

	const hasContent = snapshot && snapshot.pages.length > 0;

	return (
		<div className="flex h-full">
			{/* Toggle button strip */}
			<div className="w-8 border-l border-border bg-card flex flex-col items-center py-3 gap-2 shrink-0">
				<button
					type="button"
					onClick={onToggle}
					title={open ? "Close side panel" : "Open side panel"}
					className={cn(
						"w-7 h-7 rounded-lg flex items-center justify-center transition-all",
						open || hasContent
							? "text-primary bg-primary/10"
							: "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted",
					)}
				>
					{open ? (
						<PanelRightClose className="w-4 h-4" />
					) : (
						<PanelRightOpen className="w-4 h-4" />
					)}
				</button>
				{hasContent && !open && (
					<span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
				)}
			</div>

			{/* Panel content */}
			{open && (
				<div className="w-[320px] max-w-[40vw] border-l border-border bg-card flex flex-col overflow-hidden animate-slide-in-right">
					{/* Header */}
					<div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
						<div className="flex items-center gap-2">
							<FileText className="w-4 h-4 text-primary" />
							<span className="text-[13px] font-semibold text-foreground">
								Side Panel
							</span>
						</div>
						{snapshot && (
							<span className="text-[11px] text-muted-foreground">
								{snapshot.pages.length} pages
							</span>
						)}
					</div>

					{/* Page tabs */}
					{snapshot && snapshot.pages.length > 1 && (
						<div className="flex gap-1 px-3 py-2 border-b border-border overflow-x-auto shrink-0">
							{snapshot.pages.map((page) => {
								const isActive =
									focusedPage?.id === page.id ||
									selectedPageId === page.id ||
									(!selectedPageId && snapshot.focused_page_id === page.id);
								return (
									<button
										key={page.id}
										type="button"
										onClick={() => setSelectedPageId(page.id)}
										className={cn(
											"px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all",
											isActive
												? "bg-primary/10 text-primary"
												: "text-muted-foreground hover:text-foreground hover:bg-muted",
										)}
									>
										{page.title}
									</button>
								);
							})}
							{selectedPageId && (
								<button
									type="button"
									onClick={() => setSelectedPageId(null)}
									className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
								>
									<X className="w-3 h-3" />
								</button>
							)}
						</div>
					)}

					{/* Content */}
					<div className="flex-1 overflow-y-auto px-4 py-3">
						{!snapshot || snapshot.pages.length === 0 ? (
							<div className="flex flex-col items-center justify-center h-full text-center">
								<FileText className="w-8 h-8 text-muted-foreground/30 mb-2" />
								<p className="text-[13px] text-muted-foreground">
									No side panel content
								</p>
								<p className="text-[11px] text-muted-foreground/60 mt-1">
									Use /observe or BTW commands to populate
								</p>
							</div>
						) : focusedPage ? (
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<h3 className="text-[13px] font-semibold text-foreground">
										{focusedPage.title}
									</h3>
									<span className="text-[10px] text-muted-foreground">
										{new Date(focusedPage.updated_at_ms).toLocaleTimeString()}
									</span>
								</div>
								<div className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
									{focusedPage.content}
								</div>
							</div>
						) : null}
					</div>
				</div>
			)}
		</div>
	);
}
