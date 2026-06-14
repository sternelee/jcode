import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "@/types";
import {
	MessageSquare,
	BookOpen,
	AlarmClock,
	Grid3X3,
	Folder,
	Plus,
	Search,
	PanelLeftClose,
	PanelLeftOpen,
	ChevronDown,
	ChevronRight,
} from "lucide-react";
import {
	groupSessionsByWorkspace,
	isDefaultWorkspace,
	workspaceIdFromDir,
} from "@/lib/workspaces";

type ViewMode = "work" | "chat";

interface LeftSidebarProps {
	activeTab: string;
	onOpenLauncher?: () => void;
	onOpenPage?: (page: string) => void;
	onNewTask: () => void;
	onNewTaskInWorkspace?: (workingDir: string) => void;
	onSelectWorkspace?: (workspaceId: string) => void;
	sessions: SessionInfo[];
	activeSessionId: string | null;
	activeWorkspaceId?: string | null;
	onSelectSession: (session: SessionInfo) => void;
	sessionPreviewMap: Record<
		string,
		{ text: string; timestamp: number; unread: number }
	>;
	viewMode: ViewMode;
	onChangeViewMode: (mode: ViewMode) => void;
	collapsed: boolean;
	onToggleCollapse: () => void;
}

export function LeftSidebar({
	activeTab,
	onOpenLauncher,
	onOpenPage,
	onNewTask,
	onNewTaskInWorkspace,
	onSelectWorkspace,
	sessions,
	activeSessionId,
	activeWorkspaceId,
	onSelectSession,
	sessionPreviewMap,
	viewMode,
	onChangeViewMode,
	collapsed,
	onToggleCollapse,
}: LeftSidebarProps) {
	// Chat mode: sessions with no explicit working dir (the "default" workspace).
	const chatSessions = useMemo(
		() => sessions.filter((s) => isDefaultWorkspace(s.workingDir)),
		[sessions],
	);

	// Work mode: sessions grouped by their working directory, default workspace hidden.
	const workGroups = useMemo(
		() => groupSessionsByWorkspace(sessions).filter((g) => !g.isDefault),
		[sessions],
	);

	if (collapsed) {
		return (
			<CollapsedRail
				viewMode={viewMode}
				onChangeViewMode={onChangeViewMode}
				activeTab={activeTab}
				onOpenPage={onOpenPage}
				onNewTask={onNewTask}
				onOpenLauncher={onOpenLauncher}
				onToggleCollapse={onToggleCollapse}
			/>
		);
	}

	return (
		<nav className="w-[260px] min-w-[260px] bg-sidebar border-r border-sidebar-border flex flex-col select-none overflow-hidden">
			{/* Header: logo + launcher search + collapse */}
			<div className="flex items-center gap-2 px-3 py-3 border-b border-sidebar-border">
				<div className="w-7 h-7 rounded-lg bg-foreground/90 flex items-center justify-center shrink-0">
					<span className="text-background text-[12px] font-semibold">
						J
					</span>
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
				<button
					type="button"
					onClick={onToggleCollapse}
					className="w-6 h-6 rounded-md flex items-center justify-center text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-all"
					title="Collapse sidebar"
				>
					<PanelLeftClose className="w-3.5 h-3.5" />
				</button>
			</div>

			{/* View switcher — Chat / Work */}
			<div className="flex gap-1 px-3 py-2.5 border-b border-sidebar-border">
				<button
					type="button"
					onClick={() => onChangeViewMode("chat")}
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
				<button
					type="button"
					onClick={() => onChangeViewMode("work")}
					className={cn(
						"flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all",
						viewMode === "work"
							? "bg-sidebar-accent text-sidebar-primary shadow-sm"
							: "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
					)}
				>
					<Folder className="w-3.5 h-3.5" />
					Work
				</button>
			</div>

			{/* Page navigation (always visible) */}
			<div className="flex flex-col gap-0.5 px-2 py-2 border-b border-sidebar-border">
				<button
					type="button"
					onClick={onNewTask}
					className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent/60 transition-all group"
				>
					<Plus
						className="w-4 h-4 text-sidebar-foreground/60"
						strokeWidth={1.5}
					/>
					<span className="flex-1 text-left">New Session</span>
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

			{/* Body: Chat list or Work workspaces */}
			{viewMode === "chat" ? (
				<ChatList
					sessions={chatSessions}
					activeSessionId={activeSessionId}
					onSelectSession={onSelectSession}
					sessionPreviewMap={sessionPreviewMap}
				/>
			) : (
				<WorkList
					groups={workGroups}
					activeSessionId={activeSessionId}
					activeWorkspaceId={activeWorkspaceId}
					onSelectSession={onSelectSession}
					onSelectWorkspace={onSelectWorkspace}
					onNewTaskInWorkspace={onNewTaskInWorkspace}
					sessionPreviewMap={sessionPreviewMap}
				/>
			)}
		</nav>
	);
}

/* -------------------------------------------------------------------------- */
/*  Chat list                                                                 */
/* -------------------------------------------------------------------------- */

function ChatList({
	sessions,
	activeSessionId,
	onSelectSession,
	sessionPreviewMap,
}: {
	sessions: SessionInfo[];
	activeSessionId: string | null;
	onSelectSession: (s: SessionInfo) => void;
	sessionPreviewMap: Record<
		string,
		{ text: string; timestamp: number; unread: number }
	>;
}) {
	return (
		<div className="flex flex-col gap-0.5 px-2 py-2 flex-1 overflow-y-auto min-h-0">
			<div className="px-2.5 py-1 text-[11px] font-medium text-sidebar-foreground/40 uppercase tracking-wider">
				Chats
			</div>
			{sessions.length === 0 ? (
				<div className="px-2.5 py-4 text-[12px] text-sidebar-foreground/30 text-center">
					No chats yet. Start a new conversation.
				</div>
			) : (
				sessions.map((session) => {
					const isActive = session.sessionId === activeSessionId;
					const preview = sessionPreviewMap[session.sessionId];
					return (
						<button
							key={session.sessionId}
							type="button"
							onClick={() => onSelectSession(session)}
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
									isActive
										? "bg-primary fill-primary"
										: "bg-sidebar-foreground/20",
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
	);
}

/* -------------------------------------------------------------------------- */
/*  Work list (workspaces grouped by directory)                               */
/* -------------------------------------------------------------------------- */

function WorkList({
	groups,
	activeSessionId,
	activeWorkspaceId,
	onSelectSession,
	onSelectWorkspace,
	onNewTaskInWorkspace,
	sessionPreviewMap,
}: {
	groups: ReturnType<typeof groupSessionsByWorkspace>;
	activeSessionId: string | null;
	activeWorkspaceId?: string | null;
	onSelectSession: (s: SessionInfo) => void;
	onSelectWorkspace?: (workspaceId: string) => void;
	onNewTaskInWorkspace?: (workingDir: string) => void;
	sessionPreviewMap: Record<
		string,
		{ text: string; timestamp: number; unread: number }
	>;
}) {
	return (
		<div className="flex flex-col gap-1 px-2 py-2 flex-1 overflow-y-auto min-h-0">
			<div className="px-2.5 py-1 text-[11px] font-medium text-sidebar-foreground/40 uppercase tracking-wider">
				Workspaces
			</div>
			{groups.length === 0 ? (
				<div className="px-2.5 py-4 text-[12px] text-sidebar-foreground/30 text-center">
					No workspaces yet. Pick a folder to start.
				</div>
			) : (
				groups.map((group) => {
					const isActiveWs =
						activeWorkspaceId != null &&
						workspaceIdFromDir(activeWorkspaceId) === group.id;
					return (
						<div
							key={group.id}
							className="rounded-lg overflow-hidden"
						>
							<button
								type="button"
								onClick={() => onSelectWorkspace?.(group.id)}
								className={cn(
									"w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] font-medium transition-all",
									isActiveWs
										? "bg-sidebar-accent text-sidebar-primary"
										: "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
								)}
								title={group.id}
							>
								{isActiveWs ? (
									<ChevronDown
										className="w-3 h-3 shrink-0"
										strokeWidth={2}
									/>
								) : (
									<ChevronRight
										className="w-3 h-3 shrink-0"
										strokeWidth={2}
									/>
								)}
								<Folder
									className="w-3.5 h-3.5 shrink-0"
									strokeWidth={1.5}
								/>
								<span className="truncate flex-1 text-left">
									{group.label}
								</span>
								<span className="text-[10px] text-sidebar-foreground/40 shrink-0">
									{group.sessions.length}
								</span>
							</button>
							<div className="flex flex-col gap-0.5 pl-3 pr-1 py-0.5">
								{group.sessions.map((session) => {
									const isActive =
										session.sessionId === activeSessionId;
									const preview =
										sessionPreviewMap[session.sessionId];
									return (
										<button
											key={session.sessionId}
											type="button"
											onClick={() =>
												onSelectSession(session)
											}
											className={cn(
												"relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-all",
												isActive
													? "bg-sidebar-accent text-sidebar-primary"
													: "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
											)}
										>
											<div
												className={cn(
													"w-1 h-1 rounded-full shrink-0",
													isActive
														? "bg-primary fill-primary"
														: "bg-sidebar-foreground/20",
												)}
											/>
											<span className="truncate flex-1 text-left">
												{session.title ||
													session.sessionId.slice(
														0,
														8,
													)}
											</span>
											{preview && preview.unread > 0 && (
												<span className="text-[10px] text-primary font-medium">
													{preview.unread}
												</span>
											)}
										</button>
									);
								})}
								{onNewTaskInWorkspace &&
									group.sessions.some(
										(s) =>
											s.sessionId === activeSessionId,
									) && (
										<button
											type="button"
											onClick={() =>
												onNewTaskInWorkspace(
													group.id,
												)
											}
											className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-all"
										>
											<Plus
												className="w-3 h-3"
												strokeWidth={1.5}
											/>
											New session here
										</button>
									)}
							</div>
						</div>
					);
				})
			)}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*  Collapsed icon rail                                                       */
/* -------------------------------------------------------------------------- */

function CollapsedRail({
	viewMode,
	onChangeViewMode,
	activeTab,
	onOpenPage,
	onNewTask,
	onOpenLauncher,
	onToggleCollapse,
}: {
	viewMode: ViewMode;
	onChangeViewMode: (m: ViewMode) => void;
	activeTab: string;
	onOpenPage?: (page: string) => void;
	onNewTask: () => void;
	onOpenLauncher?: () => void;
	onToggleCollapse: () => void;
}) {
	const railBtn = "w-9 h-9 rounded-lg flex items-center justify-center transition-all";
	const railBtnActive = "bg-sidebar-accent text-sidebar-primary";
	const railBtnInactive =
		"text-sidebar-foreground/45 hover:text-sidebar-foreground hover:bg-sidebar-accent/40";

	return (
		<nav className="w-[52px] min-w-[52px] bg-sidebar border-r border-sidebar-border flex flex-col items-center select-none overflow-hidden">
			{/* Logo */}
			<div className="w-9 h-9 rounded-lg bg-foreground/90 flex items-center justify-center mt-3 shrink-0">
				<span className="text-background text-[12px] font-semibold">J</span>
			</div>

			{/* Launcher search */}
			{onOpenLauncher && (
				<button
					type="button"
					onClick={onOpenLauncher}
					className={cn(
						railBtn,
						"mt-2",
						"text-sidebar-foreground/45 hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
					)}
					title="Open launcher (⌘K)"
				>
					<Search className="w-4 h-4" />
				</button>
			)}

			{/* View toggle */}
			<div className="flex flex-col gap-1 mt-2 shrink-0">
				<button
					type="button"
					onClick={() => onChangeViewMode("chat")}
					className={cn(
						railBtn,
						viewMode === "chat" ? railBtnActive : railBtnInactive,
					)}
					title="Chat mode"
				>
					<MessageSquare className="w-4 h-4" />
				</button>
				<button
					type="button"
					onClick={() => onChangeViewMode("work")}
					className={cn(
						railBtn,
						viewMode === "work" ? railBtnActive : railBtnInactive,
					)}
					title="Work mode"
				>
					<Folder className="w-4 h-4" />
				</button>
			</div>

			{/* Spacer + main actions */}
			<div className="flex-1" />
			<div className="flex flex-col gap-1 items-center pb-3">
				<button
					type="button"
					onClick={onNewTask}
					className={cn(railBtn, railBtnInactive)}
					title="New Session"
				>
					<Plus className="w-4 h-4" />
				</button>
				<button
					type="button"
					onClick={() => onOpenPage?.("skills")}
					className={cn(
						railBtn,
						activeTab === "skills" ? railBtnActive : railBtnInactive,
					)}
					title="Skills"
				>
					<BookOpen className="w-4 h-4" />
				</button>
				<button
					type="button"
					onClick={() => onOpenPage?.("tasks")}
					className={cn(
						railBtn,
						activeTab === "tasks" ? railBtnActive : railBtnInactive,
					)}
					title="Scheduled Tasks"
				>
					<AlarmClock className="w-4 h-4" />
				</button>
				<button
					type="button"
					onClick={() => onOpenPage?.("mcp")}
					className={cn(
						railBtn,
						activeTab === "mcp" ? railBtnActive : railBtnInactive,
					)}
					title="WebBridge"
				>
					<Grid3X3 className="w-4 h-4" />
				</button>
				<button
					type="button"
					onClick={onToggleCollapse}
					className={cn(railBtn, railBtnInactive, "mt-2")}
					title="Expand sidebar"
				>
					<PanelLeftOpen className="w-4 h-4" />
				</button>
			</div>
		</nav>
	);
}
