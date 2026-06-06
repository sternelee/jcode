import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { SessionInfo, PerSessionData } from "@/types";
import { AgentAvatar, AgentAvatarStack } from "./AgentAvatar";

export interface SessionPreview {
	text: string;
	timestamp: number;
	unread?: number;
}

export interface ConversationItemData {
	id: string;
	name: string;
	avatarType: "single" | "group";
	members: string[];
	time: string;
	preview: string;
	previewType: "typing" | "text";
	typingRole?: string;
	unread?: number;
	muted?: boolean;
	isActive?: boolean;
	serverManaged?: boolean;
}

interface ConversationsListProps {
	workspaces: string[];
	sessions: SessionInfo[];
	activeWorkspaceId: string;
	expandedWorkspaces: Set<string>;
	selectedConvId?: string;
	sessionPreviewMap?: Record<string, SessionPreview>;
	sessionData?: Record<string, PerSessionData>;
	gitBranches?: Record<string, string>;
	isLoading?: boolean;
	error?: string | null;
	onRetry?: () => void;
	onToggleWorkspace: (workspaceId: string) => void;
	onSelectWorkspace: (workspaceId: string) => void;
	onSelectConversation: (id: string) => void;
	onSelectSession?: (session: SessionInfo) => void;
	onCreateSession: () => void;
	onRemoveSession?: (sessionId: string) => void;
	workspaceModes?: Record<string, "normal" | "swarm">;
	onToggleSwarmMode?: (workspaceId: string) => void;
}

const DEFAULT_WORKSPACE_ID = "default";

function workspaceIdFromDir(workingDir?: string | null): string {
	return workingDir || DEFAULT_WORKSPACE_ID;
}

function workspaceLabel(workspaceId: string): string {
	if (workspaceId === DEFAULT_WORKSPACE_ID) return "Default";
	return workspaceId.split("/").pop() || workspaceId;
}

function formatPreviewTime(ts?: number): string {
	if (!ts) return "";
	const d = new Date(ts);
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 1) return "now";
	if (diffMins < 60) return `${diffMins}m`;
	const diffHrs = Math.floor(diffMins / 60);
	if (diffHrs < 24) return `${diffHrs}h`;
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isSwarmWorkspace(
	sessions: SessionInfo[],
	workspaceId: string,
): boolean {
	const wsSessions = sessions.filter(
		(s) => workspaceIdFromDir(s.workingDir) === workspaceId,
	);
	return wsSessions.filter((s) => s.roleName).length >= 2;
}

function buildSwarmItems(
	sessions: SessionInfo[],
	workspaceId: string,
	sessionPreviewMap: Record<string, SessionPreview>,
): ConversationItemData[] {
	const items: ConversationItemData[] = [];
	const wsSessions = sessions.filter(
		(s) => workspaceIdFromDir(s.workingDir) === workspaceId,
	);
	const swarmSessions = wsSessions.filter((s) => s.roleName);
	const virtualId = `workspace:${workspaceId}`;
	const preview = sessionPreviewMap[virtualId];
	const anyResponding = swarmSessions.some((s) => s.liveProcessing);

	items.push({
		id: virtualId,
		name: `#${workspaceLabel(workspaceId)}`,
		avatarType: "group",
		members: swarmSessions.map((s) => s.roleName!),
		time: preview
			? formatPreviewTime(preview.timestamp)
			: anyResponding
				? "now"
				: "",
		preview: anyResponding
			? swarmSessions
					.filter((s) => s.liveProcessing)
					.map((s) => s.roleName)
					.filter(Boolean)
					.join(", ") + " is responding…"
			: (preview?.text ?? `${swarmSessions.length} agents`),
		previewType: anyResponding ? "typing" : "text",
		typingRole: anyResponding
			? (swarmSessions.find((s) => s.liveProcessing)?.roleName ?? undefined)
			: undefined,
		isActive: anyResponding,
	});

	return items;
}

function buildNormalItems(
	sessions: SessionInfo[],
	workspaceId: string,
	sessionPreviewMap: Record<string, SessionPreview>,
): ConversationItemData[] {
	return sessions
		.filter(
			(s) =>
				workspaceIdFromDir(s.workingDir) === workspaceId &&
				!s.roleName &&
				s.swarmRole !== "coordinator",
		)
		.map((session) => {
			const preview = sessionPreviewMap[session.sessionId];
			return {
				id: session.sessionId,
				name: session.title || session.model || "Session",
				avatarType: "single" as const,
				members: [],
				time: formatPreviewTime(preview?.timestamp) || "—",
				preview: preview?.text ?? session.detail ?? session.model ?? "ready",
				previewType: session.liveProcessing
					? ("typing" as const)
					: ("text" as const),
				isActive: session.liveProcessing,
				serverManaged: session.serverManaged,
			};
		});
}

export function ConversationsList({
	workspaces,
	sessions,
	activeWorkspaceId,
	expandedWorkspaces,
	selectedConvId,
	onToggleWorkspace,
	onSelectWorkspace,
	onSelectConversation,
	onSelectSession,
	onCreateSession,
	onRemoveSession,
	workspaceModes,
	onToggleSwarmMode,
	sessionPreviewMap = {},
	sessionData = {},
	gitBranches = {},
	isLoading = false,
	error = null,
	onRetry,
}: ConversationsListProps) {
	const [searchQuery, setSearchQuery] = useState("");

	const workspaceItems = useMemo(() => {
		const map = new Map<string, ConversationItemData[]>();
		for (const wsId of workspaces) {
			const hasSwarm = isSwarmWorkspace(sessions, wsId);
			const normalItems = buildNormalItems(sessions, wsId, sessionPreviewMap);
			const swarmItems = hasSwarm
				? buildSwarmItems(sessions, wsId, sessionPreviewMap)
				: [];
			map.set(wsId, [...normalItems, ...swarmItems]);
		}
		return map;
	}, [workspaces, sessions, sessionPreviewMap]);

	const filteredWorkspaces = useMemo(() => {
		if (!searchQuery.trim()) return workspaces;
		const q = searchQuery.toLowerCase();
		return workspaces.filter((wsId) => {
			const label = workspaceLabel(wsId).toLowerCase();
			const items = workspaceItems.get(wsId) || [];
			return (
				label.includes(q) ||
				items.some(
					(i) =>
						i.name.toLowerCase().includes(q) ||
						i.preview.toLowerCase().includes(q),
				)
			);
		});
	}, [workspaces, workspaceItems, searchQuery]);

	return (
		<div className="w-[280px] min-w-[260px] bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden">
			{/* Header */}
			<div className="px-4 pt-4 pb-3 space-y-3">
				<div className="flex items-center justify-between">
					<h1 className="text-[15px] font-semibold text-sidebar-foreground tracking-tight">
						Workspaces
					</h1>
					<button
						type="button"
						onClick={onCreateSession}
						className="w-7 h-7 rounded-lg flex items-center justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all duration-150"
						title="New conversation"
					>
						<svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
							<path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
						</svg>
					</button>
				</div>

				{/* Search */}
				<div className="relative">
					<svg
						viewBox="0 0 16 16"
						fill="currentColor"
						className="w-3.5 h-3.5 text-sidebar-foreground/40 absolute left-2.5 top-1/2 -translate-y-1/2"
					>
						<path
							fillRule="evenodd"
							d="M11.5 7.5a4 4 0 11-8 0 4 4 0 018 0zm-.82 4.74a5.5 5.5 0 111.06-1.06l2.79 2.79a.75.75 0 11-1.06 1.06l-2.79-2.79z"
							clipRule="evenodd"
						/>
					</svg>
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search..."
						className="w-full h-8 pl-8 pr-3 rounded-lg bg-sidebar-accent/50 border-0 text-[13px] text-sidebar-foreground placeholder-sidebar-foreground/40 outline-none focus:ring-1 focus:ring-sidebar-ring/30 transition-all"
					/>
				</div>
			</div>

			{/* Content - conditional rendering */}
			{isLoading ? (
				<div className="flex-1 flex items-center justify-center">
					<div className="space-y-3 w-full px-4">
						{[1, 2, 3].map((i) => (
							<div key={i} className="flex items-center gap-3 animate-pulse">
								<div className="w-8 h-8 rounded-full bg-sidebar-accent" />
								<div className="flex-1 space-y-1.5">
									<div className="h-3 bg-sidebar-accent rounded w-3/4" />
									<div className="h-2.5 bg-sidebar-accent rounded w-1/2" />
								</div>
							</div>
						))}
					</div>
				</div>
			) : error ? (
				<div className="flex-1 flex items-center justify-center px-4">
					<div className="text-center space-y-3">
						<div className="text-[13px] text-destructive">{error}</div>
						{onRetry && (
							<button
								type="button"
								onClick={onRetry}
								className="text-[12px] text-primary hover:underline"
							>
								Try again
							</button>
						)}
					</div>
				</div>
			) : filteredWorkspaces.length === 0 ? (
				<div className="flex-1 flex items-center justify-center px-4">
					<div className="text-center space-y-2">
						<div className="text-[13px] text-muted-foreground">
							{searchQuery ? "No matching sessions" : "No sessions yet"}
						</div>
						{!searchQuery && (
							<button
								type="button"
								onClick={onCreateSession}
								className="text-[12px] text-primary hover:underline"
							>
								Create your first session
							</button>
						)}
					</div>
				</div>
			) : (
				/* Workspace list */
				<div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
					{filteredWorkspaces.map((wsId) => {
						const isExpanded = expandedWorkspaces.has(wsId);
						const isActive = wsId === activeWorkspaceId;
						const items = workspaceItems.get(wsId) || [];
						const label = workspaceLabel(wsId);

						return (
							<div key={wsId}>
								{/* Workspace header */}
								<div
									className={cn(
										"flex items-center gap-1 px-2 py-1.5 rounded-lg transition-all duration-150 group/ws",
										isActive
											? "bg-sidebar-accent"
											: "hover:bg-sidebar-accent/50",
									)}
								>
									<button
										type="button"
										onClick={() => onToggleWorkspace(wsId)}
										className="w-5 h-5 rounded flex items-center justify-center text-sidebar-foreground/30 hover:text-sidebar-foreground/60 transition-colors shrink-0"
									>
										<svg
											viewBox="0 0 16 16"
											fill="currentColor"
											className={cn(
												"w-3.5 h-3.5 transition-transform duration-150",
												isExpanded && "rotate-90",
											)}
										>
											<path
												fillRule="evenodd"
												d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z"
												clipRule="evenodd"
											/>
										</svg>
									</button>

									<button
										type="button"
										onClick={() => onSelectWorkspace(wsId)}
										className="flex-1 text-left min-w-0"
									>
										<div className="flex items-center gap-1.5 min-w-0">
											<span
												className={cn(
													"text-[13px] font-medium truncate",
													isActive
														? "text-sidebar-primary"
														: "text-sidebar-foreground",
												)}
											>
												{label}
											</span>
											{gitBranches[wsId] && (
												<span className="shrink-0 text-[10px] font-mono text-sidebar-foreground/40 bg-sidebar-accent/50 px-1 py-0.5 rounded">
													{gitBranches[wsId]}
												</span>
											)}
										</div>
									</button>

									{onToggleSwarmMode && isSwarmWorkspace(sessions, wsId) && (
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												onToggleSwarmMode(wsId);
											}}
											className={cn(
												"text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0",
												workspaceModes?.[wsId] === "swarm"
													? "bg-sidebar-primary/20 text-sidebar-primary hover:bg-sidebar-primary/30"
													: "bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/80",
											)}
											title={
												workspaceModes?.[wsId] === "swarm"
													? "Switch to normal mode"
													: "Switch to swarm mode"
											}
										>
											{workspaceModes?.[wsId] === "swarm" ? "Swarm" : "Normal"}
										</button>
									)}
									<span className="text-[11px] text-sidebar-foreground/40 mr-1">
										{items.length}
									</span>
								</div>

								{/* Expanded items */}
								{isExpanded && (
									<div className="pl-3 pr-1 mt-0.5 space-y-0.5">
										{items.map((item) => (
											<ConvItem
												key={item.id}
												item={item}
												isSelected={selectedConvId === item.id}
												isProcessing={sessionData[item.id]?.isProcessing}
												onRemove={
													onRemoveSession && item.avatarType === "single"
														? () => onRemoveSession(item.id)
														: undefined
												}
												onSelect={() => {
													onSelectConversation(item.id);
													if (onSelectSession) {
														const session = sessions.find(
															(s) => s.sessionId === item.id,
														);
														if (session) onSelectSession(session);
													}
												}}
											/>
										))}
										{items.length === 0 && (
											<div className="px-3 py-3 text-[12px] text-sidebar-foreground/40 text-center">
												No sessions
											</div>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function ConvItem({
	item,
	isSelected,
	isProcessing,
	onSelect,
	onRemove,
}: {
	item: ConversationItemData;
	isSelected: boolean;
	isProcessing?: boolean;
	onSelect: () => void;
	onRemove?: () => void;
}) {
	return (
		<div className="relative group/item">
			<button
				type="button"
				onClick={onSelect}
				className={cn(
					"w-full text-left px-2.5 py-2 rounded-lg transition-all duration-150 flex items-start gap-2.5",
					isSelected ? "bg-sidebar-accent/80" : "hover:bg-sidebar-accent/40",
				)}
			>
				{/* Avatar */}
				<div className="mt-0.5 shrink-0">
					{item.avatarType === "group" ? (
						<AgentAvatarStack members={item.members} size="sm" />
					) : (
						<AgentAvatar name={item.name} size="sm" />
					)}
				</div>

				{/* Content */}
				<div className="flex-1 min-w-0">
					<div className="flex items-center justify-between gap-2">
						<span
							className={cn(
								"text-[13px] font-medium truncate",
								isSelected ? "text-sidebar-primary" : "text-sidebar-foreground",
							)}
						>
							{item.name}
						</span>
						<div className="flex items-center gap-1.5 shrink-0">
							{item.serverManaged && (
								<span className="text-[10px] text-sidebar-foreground/40 bg-sidebar-accent/50 px-1 py-0.5 rounded" title="Server managed">
									srv
								</span>
							)}
							<span className="text-[11px] text-sidebar-foreground/40">
								{item.time}
							</span>
						</div>
					</div>
					<div className="mt-0.5 flex items-center gap-2">
						{isProcessing ? (
							<span className="text-[12px] text-sidebar-primary truncate font-medium flex items-center gap-1.5">
								<span className="w-1.5 h-1.5 bg-sidebar-primary rounded-full animate-pulse" />
								{item.previewType === "typing" ? item.preview : "Processing…"}
							</span>
						) : item.previewType === "typing" ? (
							<span className="text-[12px] text-sidebar-primary truncate font-medium">
								{item.preview}
							</span>
						) : (
							<span className="text-[12px] text-sidebar-foreground/50 truncate">
								{item.preview}
							</span>
						)}
						{item.unread && item.unread > 0 ? (
							<span className="ml-auto min-w-[18px] h-[18px] bg-sidebar-primary text-sidebar-primary-fg text-[9px] font-bold rounded-full flex items-center justify-center px-1 shrink-0">
								{item.unread > 99 ? "99+" : item.unread}
							</span>
						) : null}
					</div>
				</div>
			</button>

			{/* X button */}
			{onRemove && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onRemove();
					}}
					className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-sidebar border border-sidebar-border flex items-center justify-center text-sidebar-foreground/30 hover:text-destructive hover:border-destructive/50 transition-all duration-150 opacity-0 group-hover/item:opacity-100"
					title="Remove"
				>
					<svg viewBox="0 0 10 10" fill="currentColor" className="w-2.5 h-2.5">
						<path d="M2.22 2.22a.75.75 0 011.06 0L5 3.94l1.72-1.72a.75.75 0 111.06 1.06L6.06 5l1.72 1.72a.75.75 0 11-1.06 1.06L5 6.06l-1.72 1.72a.75.75 0 01-1.06-1.06L3.94 5 2.22 3.28a.75.75 0 010-1.06z" />
					</svg>
				</button>
			)}
		</div>
	);
}
