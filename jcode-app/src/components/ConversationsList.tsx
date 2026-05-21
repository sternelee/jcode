import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "@/types";
import { AgentAvatar, AgentAvatarStack } from "./AgentAvatar";

export interface SessionPreview {
	text: string;
	timestamp: number;
	unread?: number;
}

export interface ConversationItemData {
	id: string;
	/** user-facing display name */
	name: string;
	avatarType: "single" | "group";
	members: string[];
	time: string;
	preview: string;
	previewType: "typing" | "text";
	typingRole?: string;
	unread?: number;
	muted?: boolean;
	/** Whether any member is currently processing */
	isActive?: boolean;
}

interface ConversationsListProps {
	/** All workspace ids */
	workspaces: string[];
	/** All sessions across all workspaces */
	sessions: SessionInfo[];
	/** Currently active workspace */
	activeWorkspaceId: string;
	/** Which workspaces are expanded */
	expandedWorkspaces: Set<string>;
	/** Parent-controlled selection */
	selectedConvId?: string;
	/** Last-message preview per sessionId (including workspace virtual ids) */
	sessionPreviewMap?: Record<string, SessionPreview>;
	onToggleWorkspace: (workspaceId: string) => void;
	onSelectWorkspace: (workspaceId: string) => void;
	onSelectConversation: (id: string) => void;
	/** callback for selecting individual agent (DM) sessions */
	onSelectSession?: (session: SessionInfo) => void;
	onCreateSession: () => void;
	/** Remove an individual agent session (DM) from the workspace */
	onRemoveSession?: (sessionId: string) => void;
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

/** Check if a workspace is in swarm mode */
function isSwarmWorkspace(
	sessions: SessionInfo[],
	workspaceId: string,
): boolean {
	const wsSessions = sessions.filter(
		(s) => workspaceIdFromDir(s.workingDir) === workspaceId,
	);
	return wsSessions.filter((s) => s.roleName).length >= 2;
}

/** Build conversation items for a swarm workspace */
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

	// 1. Workspace Thread (pinned group chat)
	const virtualId = `workspace:${workspaceId}`;
	const preview = sessionPreviewMap[virtualId];
	const anyResponding = swarmSessions.some((s) => s.liveProcessing);
	items.push({
		id: virtualId,
		name: `${workspaceLabel(workspaceId)} Thread`,
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

	// 2. Agent DM items
	for (const session of wsSessions) {
		if (!session.roleName) continue;
		const preview = sessionPreviewMap[session.sessionId];
		const isProcessing = session.liveProcessing;
		items.push({
			id: session.sessionId,
			name: session.roleName,
			avatarType: "single",
			members: [session.roleName],
			time: isProcessing ? "now" : formatPreviewTime(preview?.timestamp) || "—",
			preview: isProcessing
				? session.liveStatusDetail || "thinking…"
				: (preview?.text ??
						session.detail ??
						`${session.model || "assistant"} ready`),
			previewType: isProcessing ? "typing" : "text",
			typingRole: isProcessing ? session.roleName : undefined,
			isActive: isProcessing,
		});
	}

	// 3. Coordinator (non-role session that orchestrates the swarm)
	const coordinator = wsSessions.find(
		(s) => !s.roleName && s.swarmRole === "coordinator",
	);
	if (coordinator) {
		const preview = sessionPreviewMap[coordinator.sessionId];
		const isProcessing = coordinator.liveProcessing;
		items.push({
			id: coordinator.sessionId,
			name: coordinator.title || "JCode (Lead)",
			avatarType: "single",
			members: [],
			time: isProcessing ? "now" : formatPreviewTime(preview?.timestamp) || "—",
			preview: isProcessing
				? coordinator.liveStatusDetail || "coordinating…"
				: (preview?.text ?? coordinator.detail ?? "Lead agent — ready"),
			previewType: isProcessing ? "typing" : "text",
			typingRole: isProcessing ? "JCode" : undefined,
			isActive: isProcessing,
		});
	}

	return items;
}

/** Build conversation items for a normal workspace */
function buildNormalItems(
	sessions: SessionInfo[],
	workspaceId: string,
	sessionPreviewMap: Record<string, SessionPreview>,
): ConversationItemData[] {
	const items: ConversationItemData[] = [];
	const wsSessions = sessions.filter(
		(s) => workspaceIdFromDir(s.workingDir) === workspaceId,
	);

	for (const session of wsSessions) {
		const preview = sessionPreviewMap[session.sessionId];
		items.push({
			id: session.sessionId,
			name: session.title || session.model || "Session",
			avatarType: "single",
			members: [],
			time: formatPreviewTime(preview?.timestamp) || "—",
			preview:
				preview?.text ??
				session.detail ??
				session.model ??
				"ready",
			previewType: session.liveProcessing ? "typing" : "text",
			isActive: session.liveProcessing,
		});
	}

	return items;
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
	sessionPreviewMap = {},
}: ConversationsListProps) {
	const [searchQuery, setSearchQuery] = useState("");

	// Group items by workspace
	const workspaceItems = useMemo(() => {
		const map = new Map<string, ConversationItemData[]>();
		for (const wsId of workspaces) {
			const isSwarm = isSwarmWorkspace(sessions, wsId);
			const items = isSwarm
				? buildSwarmItems(sessions, wsId, sessionPreviewMap)
				: buildNormalItems(sessions, wsId, sessionPreviewMap);
			map.set(wsId, items);
		}
		return map;
	}, [workspaces, sessions, sessionPreviewMap]);

	// Filter by search
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
		<div className="w-[300px] min-w-[260px] bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden">
			{/* Header */}
			<div className="px-4 pt-4 pb-3">
				<div className="flex items-center justify-between mb-3">
					<h1 className="text-[15px] font-bold text-foreground tracking-tight">
						Workspaces
					</h1>
					<button
						type="button"
						onClick={onCreateSession}
						className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary hover:bg-primary/20 transition-colors"
						title="New conversation"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
							<path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
						</svg>
					</button>
				</div>

				{/* Search bar */}
				<div className="relative">
					<svg
						viewBox="0 0 20 20"
						fill="currentColor"
						className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2"
					>
						<path
							fillRule="evenodd"
							d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
							clipRule="evenodd"
						/>
					</svg>
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search workspaces..."
						className="w-full h-9 pl-9 pr-3 rounded-xl bg-background border border-border text-[13px] text-foreground placeholder-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
					/>
				</div>
			</div>

			{/* Workspace list */}
			<div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
				{filteredWorkspaces.map((wsId) => {
					const isExpanded = expandedWorkspaces.has(wsId);
					const isActive = wsId === activeWorkspaceId;
					const isSwarm = isSwarmWorkspace(sessions, wsId);
					const items = workspaceItems.get(wsId) || [];
					const label = workspaceLabel(wsId);

					return (
						<div key={wsId} className="rounded-xl overflow-hidden">
							{/* Workspace header — clickable to switch workspace */}
							<div
								className={cn(
									"flex items-center gap-1 px-2 py-2 rounded-xl transition-colors",
									isActive
										? "bg-primary/10"
										: "hover:bg-muted",
								)}
							>
								{/* Expand/collapse toggle */}
								<button
									type="button"
									onClick={() => onToggleWorkspace(wsId)}
									className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-muted-foreground hover:bg-border/50 transition-colors shrink-0"
								>
									<svg
										viewBox="0 0 20 20"
										fill="currentColor"
										className={cn(
											"w-4 h-4 transition-transform",
											isExpanded && "rotate-90",
										)}
									>
										<path
											fillRule="evenodd"
											d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
											clipRule="evenodd"
										/>
									</svg>
								</button>

								{/* Workspace name — click to switch */}
								<button
									type="button"
									onClick={() => onSelectWorkspace(wsId)}
									className="flex-1 text-left min-w-0"
								>
									<div className="flex items-center gap-2">
										{isSwarm ? (
											<span className="text-[13px] font-semibold text-primary truncate">
												#{label}
											</span>
										) : (
											<span
												className={cn(
													"text-[13px] font-semibold truncate",
													isActive
														? "text-primary"
														: "text-foreground",
												)}
											>
												{label}
											</span>
										)}
										{isSwarm && (
											<span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
												swarm
											</span>
										)}
									</div>
								</button>

								{/* Session count */}
								<span className="text-[11px] text-muted-foreground shrink-0">
									{items.length}
								</span>
							</div>

							{/* Expanded items */}
							{isExpanded && (
								<div className="pl-4 pr-1 pb-1 space-y-0.5">
									{isSwarm && (
										<div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
											Agents
										</div>
									)}
									{items.map((item) => (
										<ConversationItem
											key={item.id}
											item={item}
											isSelected={selectedConvId === item.id}
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
													if (session) {
														onSelectSession(session);
													}
												}
											}}
										/>
									))}
									{items.length === 0 && (
										<div className="px-3 py-2 text-[12px] text-muted-foreground">
											No sessions
										</div>
									)}
								</div>
							)}
						</div>
					);
				})}

				{filteredWorkspaces.length === 0 && (
					<div className="text-center text-[12px] text-muted-foreground py-8">
						{searchQuery
							? "No matching workspaces"
							: "No workspaces — create one to get started"}
					</div>
				)}
			</div>
		</div>
	);
}

function ConversationItem({
	item,
	isSelected,
	onSelect,
	onRemove,
}: {
	item: ConversationItemData;
	isSelected: boolean;
	onSelect: () => void;
	onRemove?: () => void;
}) {
	return (
		<div className="relative group/item">
			<button
				type="button"
				onClick={onSelect}
				className={cn(
					"w-full text-left px-3 py-2 rounded-xl transition-all flex items-start gap-3",
					isSelected
						? "bg-primary/10"
						: "hover:bg-muted",
				)}
			>
				{/* Avatar */}
				<div className="mt-0.5 shrink-0">
					{item.avatarType === "group" ? (
						<AgentAvatarStack members={item.members} size="md" />
					) : (
						<AgentAvatar name={item.name} size="md" />
					)}
				</div>

				{/* Content */}
				<div className="flex-1 min-w-0 pr-6">
					<div className="flex items-center justify-between gap-2">
						<span
							className={cn(
								"text-[13px] font-semibold truncate",
								isSelected ? "text-primary" : "text-foreground",
							)}
						>
							{item.name}
						</span>
						<span className="text-[11px] text-muted-foreground shrink-0">
							{item.time}
						</span>
					</div>
					<div className="mt-0.5 flex items-center gap-2">
						{item.previewType === "typing" ? (
							<span className="text-[12px] text-transparent bg-clip-text bg-gradient-to-r from-primary to-primary/60 truncate font-medium">
								{item.preview}
							</span>
						) : (
							<span className="text-[12px] text-muted-foreground truncate">
								{item.preview}
							</span>
						)}
						{item.unread && item.unread > 0 ? (
							<span className="ml-auto w-5 h-5 bg-primary text-white text-[9px] font-bold rounded-full flex items-center justify-center shrink-0">
								{item.unread > 99 ? "99+" : item.unread}
							</span>
						) : null}
					</div>
				</div>
			</button>

			{/* Remove button — only for DMs, visible on hover */}
			{onRemove && item.avatarType === "single" && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onRemove();
					}}
					className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive transition-colors opacity-0 group-hover/item:opacity-100 shadow-sm"
					title={`Remove ${item.name}`}
				>
					<svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5">
						<path d="M2.22 2.22a.75.75 0 011.06 0L6 4.94l2.72-2.72a.75.75 0 111.06 1.06L7.06 6l2.72 2.72a.75.75 0 11-1.06 1.06L6 7.06l-2.72 2.72a.75.75 0 01-1.06-1.06L4.94 6 2.22 3.28a.75.75 0 010-1.06z" />
					</svg>
				</button>
			)}
		</div>
	);
}
