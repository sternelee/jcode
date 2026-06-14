import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "@/types";
import {
	MessageSquare,
	BookOpen,
	AlarmClock,
	Grid3X3,
	Folder,
	BarChart3,
	ChevronDown,
	Circle,
	Search,
} from "lucide-react";

interface LeftSidebarProps {
	activeTab: string;
	onOpenLauncher?: () => void;
	onOpenPage?: (page: string) => void;
	onNewTask: () => void;
	sessions: SessionInfo[];
	activeSessionId: string | null;
	onSelectSession: (session: SessionInfo) => void;
	sessionPreviewMap: Record<string, { text: string; timestamp: number; unread: number }>;
}

export function LeftSidebar({
	activeTab,
	onOpenLauncher,
	onOpenPage,
	onNewTask,
	sessions,
	activeSessionId,
	onSelectSession,
	sessionPreviewMap,
}: LeftSidebarProps) {
	const [viewMode, setViewMode] = useState<"work" | "chat">("work");

	const chatSessions = useMemo(
		() =>
			sessions
				.filter((s) => !s.roleName)
				.sort((a, b) =>
					(a.title || "").localeCompare(b.title || ""),
				),
		[sessions],
	);

	const recentSessions = useMemo(
		() => chatSessions.slice(0, 8),
		[chatSessions],
	);

	const handleSelect = (session: SessionInfo) => {
		onSelectSession(session);
	};

	return (
		<nav className="w-[260px] min-w-[260px] bg-sidebar border-r border-sidebar-border flex flex-col select-none overflow-hidden">
			{/* Logo + launcher */}
			<div className="flex items-center gap-2 px-3 py-3 border-b border-sidebar-border">
				<div className="w-7 h-7 rounded-lg bg-foreground/90 flex items-center justify-center shrink-0">
					<span className="text-background text-[12px] font-semibold">J</span>
				</div>
				<span className="text-[14px] font-semibold text-sidebar-foreground tracking-tight">
          JFlow
				</span>
				{onOpenLauncher && (
					<button
						type="button"
						onClick={onOpenLauncher}
						className="ml-auto w-6 h-6 rounded-md flex items-center justify-center text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-all"
						title="Open launcher (⌘K)"
					>
						<Search className="w-3.5 h-3.5" />
					</button>
				)}
			</div>

			{/* View switcher — Work / Chat */}
			<div className="flex gap-1 px-3 py-2.5 border-b border-sidebar-border">
				<button
					type="button"
					onClick={() => setViewMode("work")}
					className={cn(
						"flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all",
						viewMode === "work"
							? "bg-sidebar-accent text-sidebar-primary shadow-sm"
							: "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
					)}
				>
					<BarChart3 className="w-3.5 h-3.5" />
					Work
				</button>
				<button
					type="button"
					onClick={() => setViewMode("chat")}
					className={cn(
						"flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all",
						viewMode === "chat"
							? "bg-sidebar-accent text-sidebar-primary shadow-sm"
							: "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
					)}
				>
					<MessageSquare className="w-3.5 h-3.5" />
					Chat
				</button>
			</div>

			{/* Navigation list */}
			<div className="flex flex-col gap-0.5 px-2 py-2 border-b border-sidebar-border">
				<button
					type="button"
					onClick={onNewTask}
					className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent/60 transition-all group"
				>
					<Circle className="w-4 h-4 text-sidebar-foreground/60" strokeWidth={1.5} />
					<span className="flex-1">New Session</span>
				</button>
				<button
					type="button"
					onClick={() => onOpenPage?.("skills")}
					className={cn(
						"flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-all",
						activeTab === "skills"
							? "bg-sidebar-accent text-sidebar-primary"
							: "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
					)}
				>
					<BookOpen className="w-4 h-4" strokeWidth={1.5} />
					Skills
				</button>
				<button
					type="button"
					onClick={() => onOpenPage?.("tasks")}
					className={cn(
						"flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-all",
						activeTab === "tasks"
							? "bg-sidebar-accent text-sidebar-primary"
							: "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
					)}
				>
					<AlarmClock className="w-4 h-4" strokeWidth={1.5} />
					Scheduled Tasks
				</button>
				<button
					type="button"
					onClick={() => onOpenPage?.("mcp")}
					className={cn(
						"flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-all",
						activeTab === "mcp"
							? "bg-sidebar-accent text-sidebar-primary"
							: "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
					)}
				>
					<Grid3X3 className="w-4 h-4" strokeWidth={1.5} />
					WebBridge
				</button>
			</div>

			{/* Project section */}
			{viewMode === "work" && (
				<div className="flex flex-col gap-0.5 px-2 py-2 border-b border-sidebar-border">
					<div className="px-2.5 py-1 text-[11px] font-medium text-sidebar-foreground/40 uppercase tracking-wider">
						Project
					</div>
					<div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground/70 transition-all">
						<Folder className="w-4 h-4 text-sidebar-foreground/50" strokeWidth={1.5} />
						<span className="truncate">No project selected</span>
					</div>
				</div>
			)}

			{/* Chats section */}
			<div className="flex flex-col gap-0.5 px-2 py-2 flex-1 overflow-y-auto min-h-0">
				<div className="px-2.5 py-1 text-[11px] font-medium text-sidebar-foreground/40 uppercase tracking-wider">
					Chats
				</div>
				{recentSessions.length === 0 ? (
					<div className="px-2.5 py-4 text-[12px] text-sidebar-foreground/30 text-center">
						No sessions yet
					</div>
				) : (
					recentSessions.map((session) => {
						const isActive = session.sessionId === activeSessionId;
						const preview = sessionPreviewMap[session.sessionId];
						return (
							<button
								key={session.sessionId}
								type="button"
								onClick={() => handleSelect(session)}
								className={cn(
									"relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-all group",
									isActive
										? "bg-sidebar-accent text-sidebar-primary"
										: "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
								)}
							>
								<div
									className={cn(
										"w-1.5 h-1.5 rounded-full shrink-0",
										isActive ? "bg-primary fill-primary" : "bg-sidebar-foreground/20",
									)}
								/>
								<span className="truncate flex-1 text-left">
									{session.title || session.sessionId.slice(0, 8)}
								</span>
								{preview && preview.unread > 0 && (
									<span className="text-[10px] text-primary font-medium">
										{preview.unread}
									</span>
								)}
							</button>
						);
					})
				)}
			</div>

			{/* User profile */}
			<div className="border-t border-sidebar-border px-3 py-2.5 flex items-center gap-2.5 shrink-0">
				<div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[11px] font-semibold shrink-0">
					U
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5">
						<span className="text-[13px] font-medium text-sidebar-foreground truncate">
							User
						</span>
					</div>
				</div>
				<ChevronDown className="w-3.5 h-3.5 text-sidebar-foreground/40 shrink-0" />
			</div>
		</nav>
	);
}
