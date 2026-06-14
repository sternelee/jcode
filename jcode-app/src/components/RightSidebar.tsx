import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { SidePanelSnapshot } from "@/types";
import {
	ListTodo,
	FileText,
	BookOpen,
	Circle,
	PanelRightClose,
	PanelRightOpen,
} from "lucide-react";

interface RightSidebarProps {
	snapshot: SidePanelSnapshot | null;
	consultantFiles: string[];
	skillFiles: string[];
	open: boolean;
	onToggle: () => void;
}

/**
 * Always-visible right sidebar with two collapsible sections:
 *
 * **Progress** — surfaces the agent's open tool pages (the same data the
 * old toggled `SidePanel` showed) as a vertical checklist. When the agent
 * is working, pages like "plan.md", "mutation schema", or "dashboard
 * component" appear here with their last-update time. Each page can be
 * expanded to reveal its content.
 *
 * **Context** — lists every file and skill the session has touched. The
 * agent emits `open_tool` and `write_tool` events that carry file paths;
 * those are collected and surfaced so you always know which files the
 * agent is editing.
 *
 * The design matches the ultra-dark theme: #121212 bg, #1e1e1e cards,
 * 12px rounded corners, Inter/Geist UI and SF Mono for code/paths.
 */
export function RightSidebar({
	snapshot,
	consultantFiles,
	skillFiles,
	open,
	onToggle,
}: RightSidebarProps) {
	const pages = snapshot?.pages ?? [];

	// ── Progress: derive a task-like view from the tool pages ──
	const progressItems = useMemo(() => {
		if (pages.length === 0) return [];
		return pages.map((page) => ({
			id: page.id,
			title: page.title,
			path: page.file_path,
			updatedAt: new Date(page.updated_at_ms).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			}),
			// Pages from the agent are implicitly "in progress"
			status: "in-progress" as const,
		}));
	}, [pages]);

	// ── Context: deduplicated file + skill references ──
	const contextItems = useMemo(() => {
		const items: { name: string; type: "file" | "skill" }[] = [];
		const seen = new Set<string>();

		for (const f of consultantFiles) {
			if (!seen.has(f)) {
				seen.add(f);
				items.push({ name: f, type: "file" });
			}
		}
		for (const s of skillFiles) {
			if (!seen.has(s)) {
				seen.add(s);
				items.push({ name: s, type: "skill" });
			}
		}
		return items;
	}, [consultantFiles, skillFiles]);

	return (
		<div className="flex h-full">
			{/* Toggle strip */}
			<div className="w-8 border-l border-border bg-card flex flex-col items-center py-3 gap-2 shrink-0">
				<button
					type="button"
					onClick={onToggle}
					title={open ? "Close side panel" : "Open side panel"}
					className={cn(
						"w-7 h-7 rounded-lg flex items-center justify-center transition-all",
						open
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
			</div>

			{/* Panel content */}
			{open && (
				<div className="w-[300px] min-w-[300px] border-l border-border bg-card flex flex-col overflow-hidden animate-slide-in-right">
					{/* ── Progress section ── */}
			<div className="shrink-0 flex flex-col overflow-hidden max-h-[45%] border-b border-border">
				<SectionHeader icon={ListTodo} label="Progress" count={progressItems.length} />
				<div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
					{progressItems.length === 0 ? (
						<Placeholder
							icon={ListTodo}
							title="No active progress"
							description="Agent tasks and tool pages will appear here as work progresses."
						/>
					) : (
						progressItems.map((item) => (
							<div
								key={item.id}
								className="group flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-foreground hover:bg-muted/50 transition-colors"
							>
								<div className="mt-0.5 shrink-0">
									<Circle className="w-3.5 h-3.5 text-amber-500" fill="currentColor" fillOpacity={0.2} />
								</div>
								<div className="min-w-0 flex-1">
									<div className="truncate font-medium">{item.title}</div>
									<div className="flex items-center gap-2 mt-0.5">
										<span className="text-[11px] text-muted-foreground/60 truncate font-mono">
											{item.path}
										</span>
										<span className="text-[10px] text-muted-foreground/40 shrink-0">
											{item.updatedAt}
										</span>
									</div>
								</div>
							</div>
						))
					)}
				</div>
			</div>

			{/* ── Context section ── */}
			<div className="flex-1 flex flex-col overflow-hidden min-h-0">
				<SectionHeader icon={FileText} label="Context" count={contextItems.length} />
				<div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
					{contextItems.length === 0 ? (
						<Placeholder
							icon={FileText}
							title="No context files"
							description="Files and skills referenced by the agent will appear here."
						/>
					) : (
						contextItems.map((item, idx) => (
							<div
								key={`${item.name}-${idx}`}
								className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-foreground hover:bg-muted/50 transition-colors"
							>
								<div
									className={cn(
										"shrink-0 w-6 h-6 rounded-md flex items-center justify-center",
										item.type === "skill"
											? "bg-emerald-500/10 text-emerald-500"
											: "bg-muted text-muted-foreground",
									)}
								>
									{item.type === "skill" ? (
										<BookOpen className="w-3.5 h-3.5" />
									) : (
										<FileText className="w-3.5 h-3.5" />
									)}
								</div>
								<span className="truncate font-mono text-[12px]">{item.name}</span>
							</div>
						))
					)}
				</div>
			</div>
			</div>
			)}
		</div>
	);
}

function SectionHeader({
	icon: Icon,
	label,
	count,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	count: number;
}) {
	return (
		<div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
			<Icon className="w-4 h-4 text-primary" />
			<span className="text-[12px] font-semibold text-foreground tracking-tight">
				{label}
			</span>
			{count > 0 && (
				<span className="ml-auto text-[11px] text-muted-foreground/50 font-mono">
					{count}
				</span>
			)}
		</div>
	);
}

function Placeholder({
	icon: Icon,
	title,
	description,
}: {
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	description: string;
}) {
	return (
		<div className="flex flex-col items-center justify-center h-full text-center px-6">
			<Icon className="w-8 h-8 text-muted-foreground/20 mb-2" />
			<p className="text-[13px] text-muted-foreground/70 font-medium">{title}</p>
			<p className="text-[11px] text-muted-foreground/50 mt-1 leading-relaxed">
				{description}
			</p>
		</div>
	);
}
