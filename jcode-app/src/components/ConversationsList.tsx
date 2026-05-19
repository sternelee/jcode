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
	sessions: SessionInfo[];
	onCreateSession: () => void;
	/** Active workspace sessions for swarm display */
	workspaceSessions?: SessionInfo[];
	/** parent-controlled selection */
	selectedConvId?: string;
	onSelectConversation: (id: string) => void;
	/** callback for selecting individual agent (DM) sessions */
	onSelectSession?: (session: SessionInfo) => void;
	/** current active session id */
	activeSessionId?: string | null;
	/** Last-message preview per sessionId (including workspace virtual ids) */
	sessionPreviewMap?: Record<string, SessionPreview>;
	/** Remove an individual agent session (DM) from the workspace */
	onRemoveSession?: (sessionId: string) => void;
}

const FILTER_TABS = ["All", "Unread", "Agents", "Humans", "Groups"] as const;

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

export function ConversationsList({
	sessions,
	onCreateSession,
	workspaceSessions = [],
	selectedConvId,
	onSelectConversation,
	onSelectSession,
	// activeSessionId kept for future unread tracking
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	activeSessionId: _activeSessionId,
	sessionPreviewMap = {},
	onRemoveSession,
}: ConversationsListProps) {
	const [activeFilter, setActiveFilter] = useState<string>("All");
	const [searchQuery, setSearchQuery] = useState("");

	// Build conversation items from real sessions
	const conversationItems = useMemo<ConversationItemData[]>(() => {
		const items: ConversationItemData[] = [];
		const sourceSessions =
			workspaceSessions.length > 0 ? workspaceSessions : sessions;

		// If we have sessions with role names, add a pinned workspace thread
		const swarmSessions = sourceSessions.filter((s) => s.roleName);
		if (swarmSessions.length >= 2) {
			const workspaceId = swarmSessions[0]?.workingDir || "default";
			const virtualId = `workspace:${workspaceId}`;
			const preview = sessionPreviewMap[virtualId];
			const anyResponding = swarmSessions.some((s) => s.liveProcessing);
			items.push({
				id: virtualId,
				name: `${
					workspaceId === "default"
						? "Workspace"
						: (workspaceId.split("/").pop() ?? "team")
				} Thread`,
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
		}

		// Individual agent DM items
		for (const session of sourceSessions) {
			if (!session.roleName) continue;
			if (items.find((i) => i.id === session.sessionId)) continue;

			const preview = sessionPreviewMap[session.sessionId];
			const isProcessing = session.liveProcessing;
			items.push({
				id: session.sessionId,
				name: session.roleName,
				avatarType: "single",
				members: [session.roleName],
				time: isProcessing
					? "now"
					: formatPreviewTime(preview?.timestamp) || "—",
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

		// Coordinator (non-role session that orchestrates the swarm)
		if (swarmSessions.length >= 2) {
			const coordinator = sourceSessions.find(
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
		}

		if (items.length === 0) {
			for (const session of sourceSessions.slice(0, 10)) {
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
		}

		return items;
	}, [sessions, workspaceSessions, sessionPreviewMap]);

	const filteredItems = useMemo(() => {
		if (!searchQuery) return conversationItems;
		const q = searchQuery.toLowerCase();
		return conversationItems.filter(
			(i) =>
				i.name.toLowerCase().includes(q) ||
				i.members.some((m) => m.toLowerCase().includes(q)) ||
				i.preview.toLowerCase().includes(q),
		);
	}, [conversationItems, searchQuery]);

	// First item = workspace thread (pinned), rest = DMs
	const pinnedItems = filteredItems.slice(0, 1);
	const regularItems = filteredItems.slice(1);

	return (
		<div className="w-[320px] min-w-[280px] bg-[#FAFBFC] border-r border-[#E5E5E5] flex flex-col overflow-hidden">
			{/* Header */}
			<div className="px-5 pt-5 pb-3">
				<div className="flex items-center justify-between mb-4">
					<h1 className="text-[17px] font-bold text-[#111827] tracking-tight">
						Conversations
					</h1>
					<button
						type="button"
						onClick={onCreateSession}
						className="w-7 h-7 rounded-lg bg-[#EFF6FF] flex items-center justify-center text-[#3B82F6] hover:bg-[#DBEAFE] transition-colors"
						title="New conversation"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
							<path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
						</svg>
					</button>
				</div>

				{/* Search bar */}
				<div className="relative mb-3">
					<svg
						viewBox="0 0 20 20"
						fill="currentColor"
						className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2"
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
						placeholder="Q Find a conversation, agent, or human..."
						className="w-full h-9 pl-9 pr-3 rounded-xl bg-white border border-[#E5E7EB] text-[13px] text-[#111827] placeholder-[#9CA3AF] outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6]/20 transition-all"
					/>
					<div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
						<kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] font-mono bg-[#F3F4F6] text-[#9CA3AF] rounded border border-[#E5E7EB]">
							⌘K
						</kbd>
					</div>
				</div>

				{/* Filter tabs */}
				<div className="flex gap-1.5 flex-wrap">
					{FILTER_TABS.map((tab) => (
						<button
							key={tab}
							type="button"
							onClick={() => setActiveFilter(tab)}
							className={cn(
								"px-3 py-1.5 rounded-full text-[12px] font-medium transition-all",
								activeFilter === tab
									? "bg-[#EFF6FF] text-[#2563EB]"
									: "text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#374151]",
							)}
						>
							{tab}
							{tab === "Unread" && (
								<span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full">
									5
								</span>
							)}
						</button>
					))}
				</div>
			</div>

			{/* Conversation list */}
			<div className="flex-1 overflow-y-auto px-3 pb-2 space-y-0.5">
				{/* Pinned section (workspace thread) */}
				{pinnedItems.length > 0 && (
					<>
						<div className="px-2 py-2 text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
							PINNED
						</div>
						{pinnedItems.map((item) => (
							<ConversationItem
								key={item.id}
								item={item}
								isSelected={selectedConvId === item.id}
								onSelect={() => onSelectConversation(item.id)}
							/>
						))}
					</>
				)}

				{/* Regular section (DM conversations) */}
				{regularItems.length > 0 && (
					<div className="pt-1">
						{regularItems.map((item) => (
							<ConversationItem
								key={item.id}
								item={item}
								isSelected={selectedConvId === item.id}
								onRemove={
									onRemoveSession
										? () => onRemoveSession(item.id)
										: undefined
								}
								onSelect={() => {
									onSelectConversation(item.id);
									if (onSelectSession) {
										const session = (
											workspaceSessions.length > 0
												? workspaceSessions
												: sessions
										).find((s) => s.sessionId === item.id);
										if (session) {
											onSelectSession(session);
										}
									}
								}}
							/>
						))}
					</div>
				)}

				{/* Empty state */}
				{filteredItems.length === 0 && (
					<div className="text-center text-[12px] text-[#9CA3AF] py-8">
						{searchQuery
							? "No matching conversations"
							: "No active sessions — create one to get started"}
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
					"w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-start gap-3 group",
					isSelected ? "bg-[#EFF6FF]" : "hover:bg-[#F3F4F6]",
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
						<span className="text-[13px] font-semibold truncate text-[#111827]">{item.name}</span>
						<span className="text-[11px] text-[#9CA3AF] shrink-0">{item.time}</span>
					</div>
					<div className="mt-0.5 flex items-center gap-2">
						{item.previewType === "typing" ? (
							<span className="text-[12px] text-transparent bg-clip-text bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] truncate font-medium">
								{item.preview}
							</span>
						) : (
							<span className="text-[12px] text-[#6B7280] truncate">{item.preview}</span>
						)}
						{item.unread && item.unread > 0 ? (
							<span className="ml-auto w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center shrink-0">
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
					onClick={(e) => { e.stopPropagation(); onRemove(); }}
					className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white border border-[#E5E7EB] flex items-center justify-center text-[#9CA3AF] hover:text-[#EF4444] hover:border-[#FCA5A5] transition-colors opacity-0 group-hover/item:opacity-100 shadow-sm"
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
