import type { ChatMessage, SessionInfo, Workspace } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Folder,
  Plus,
  FileText,
  Search,
  TriangleAlert,
  WandSparkles,
  LoaderCircle,
  Keyboard,
  Layers3,
  Users,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface SessionSidebarProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  expandedWorkspaces: Set<string>;
  activeWorkspaceId: string | null;
  activeMessages: ChatMessage[];
  activeError?: string | null;
  isProcessing: boolean;
  queuedDraftCount: number;
  stdinPromptActive: boolean;
  availableRouteCount: number;
  onSelectSession: (session: SessionInfo) => void;
  onRefresh: () => void;
  onToggleWorkspace: (workspaceId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: () => void;
  onCreateSession: (workspaceId: string) => void;
  onDeleteSession: (session: SessionInfo) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
}

function workspaceName(dir: string): string {
  const parts = dir.split(/[/\\]/);
  return parts[parts.length - 1] || dir;
}

function compactText(text: string | undefined, max = 48): string {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function sessionSearchText(session: SessionInfo): string {
  return [
    session.title,
    session.subtitle,
    session.detail,
    session.sessionId,
    session.model,
    session.provider,
    ...(session.previewLines || []),
    ...(session.detailLines || []),
    session.workingDir,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesSession(session: SessionInfo, query: string): boolean {
  if (!query) return true;
  return sessionSearchText(session).includes(query);
}

function matchesStatusFilter(session: SessionInfo, statusFilter: "all" | "problem" | "crashed" | "running" | "swarm"): boolean {
  if (statusFilter === "all") return true;
  const normalized = session.status?.toLowerCase() || "";
  if (statusFilter === "crashed") {
    return normalized.includes("crash");
  }
  if (statusFilter === "running") {
    return normalized.includes("running") || normalized.includes("chunking") || Boolean(session.liveProcessing);
  }
  if (statusFilter === "swarm") {
    return Boolean(session.swarmEnabled);
  }
  return normalized.includes("error") || normalized.includes("fail") || normalized.includes("crash") || normalized.includes("blocked");
}

function latestRuntimeSignal(messages: ChatMessage[], activeError?: string | null) {
  if (activeError) {
    return {
      kind: "error" as const,
      label: compactText(activeError, 72),
    };
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const toolError = message.toolExecutions.find((tool) => tool.status === "error");
    if (toolError) {
      return {
        kind: "error" as const,
        label: compactText(`tool ${toolError.name}: ${toolError.error || toolError.output || "failed"}`, 72),
      };
    }
    if (message.role === "system") {
      if (message.content.includes("Context compaction") || message.content.includes("compact")) {
        const saved = message.content.match(/saved\s+(\d+)/i)?.[1];
        return {
          kind: "compaction" as const,
          label: saved ? `saved ${saved} tokens` : compactText(message.content, 72),
        };
      }
      if (/error|failed/i.test(message.content)) {
        return {
          kind: "error" as const,
          label: compactText(message.content, 72),
        };
      }
    }
  }

  return null;
}


function livePhaseLabel(session: SessionInfo): string | null {
  switch (session.livePhase) {
    case "chunking":
      return "chunking";
    case "tool":
      return session.liveToolName || "tool";
    case "thinking":
      return "thinking";
    case "waiting":
      return "waiting";
    default:
      return null;
  }
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  expandedWorkspaces,
  activeWorkspaceId,
  activeMessages,
  activeError,
  isProcessing,
  queuedDraftCount,
  stdinPromptActive,
  availableRouteCount,
  onSelectSession,
  onRefresh,
  onToggleWorkspace,
  onSelectWorkspace,
  onCreateWorkspace,
  onCreateSession,
  onDeleteSession,
  onDeleteWorkspace,
}: SessionSidebarProps) {
  const [search, setSearch] = useState(() => localStorage.getItem("desktop-session-sidebar-search") || "");
  const [workspaceFilter, setWorkspaceFilter] = useState(() => localStorage.getItem("desktop-session-sidebar-workspace-filter") || "all");
  const [statusFilter, setStatusFilter] = useState<"all" | "problem" | "crashed" | "running" | "swarm">(() => {
    const saved = localStorage.getItem("desktop-session-sidebar-status-filter");
    return saved === "problem" || saved === "crashed" || saved === "running" || saved === "swarm" ? saved : "all";
  });

  useEffect(() => {
    localStorage.setItem("desktop-session-sidebar-search", search);
  }, [search]);

  useEffect(() => {
    localStorage.setItem("desktop-session-sidebar-workspace-filter", workspaceFilter);
  }, [workspaceFilter]);

  useEffect(() => {
    localStorage.setItem("desktop-session-sidebar-status-filter", statusFilter);
  }, [statusFilter]);

  const workspaces = useMemo(() => {
    const map = new Map<string, SessionInfo[]>();
    map.set("default", []);
    for (const s of sessions) {
      const key = s.workingDir || "default";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    const sorted = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === activeWorkspaceId) return -1;
      if (b[0] === activeWorkspaceId) return 1;
      return workspaceName(a[0]).localeCompare(workspaceName(b[0]));
    });
    return sorted.map(
      ([id, sessions]): Workspace => ({
        id,
        name: id === "default" ? "Default" : workspaceName(id),
        sessions,
      }),
    );
  }, [sessions, activeWorkspaceId]);

  const normalizedQuery = search.trim().toLowerCase();
  const filteredWorkspaces = useMemo(
    () =>
      workspaces
        .filter((workspace) => workspaceFilter === "all" || workspace.id === workspaceFilter)
        .map((workspace) => {
          const workspaceMatches = !normalizedQuery || workspace.name.toLowerCase().includes(normalizedQuery);
          const filteredSessions = (workspaceMatches
            ? workspace.sessions
            : workspace.sessions.filter((session) => matchesSession(session, normalizedQuery)))
            .filter((session) => matchesStatusFilter(session, statusFilter));
          return {
            ...workspace,
            filteredSessions,
            totalSessions: workspace.sessions.length,
          };
        })
        .filter((workspace) => workspace.filteredSessions.length > 0 || normalizedQuery.length === 0),
    [workspaces, workspaceFilter, normalizedQuery, statusFilter],
  );

  const runtimeSignal = useMemo(() => latestRuntimeSignal(activeMessages, activeError), [activeMessages, activeError]);

  return (
    <div className="w-[320px] min-w-[260px] overflow-hidden bg-sidebar border-r border-sidebar-border flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-sidebar-border bg-sidebar">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60">
            Workspaces
          </h3>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-sidebar-accent"
              onClick={onCreateWorkspace}
              title="Create workspace"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-sidebar-accent"
              onClick={onRefresh}
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-2.5">
          <Search className="absolute left-3 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search sessions..."
            className="pl-9 text-xs h-8 bg-background border-border rounded-lg"
          />
        </div>

        {/* Workspace Filter */}
        <div className="mb-2.5">
          <Select value={workspaceFilter} onValueChange={(value) => setWorkspaceFilter(value || "all")}>
            <SelectTrigger className="h-8 w-full text-xs bg-background border-border rounded-lg">
              <SelectValue placeholder="Filter workspace" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All workspaces</SelectItem>
              {workspaces.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Status Filters - Pill style */}
        <div className="flex flex-wrap gap-1">
          {(["all", "problem", "running", "swarm", "crashed"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors",
                statusFilter === filter
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              )}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Workspace List */}
      <ScrollArea className="min-w-0 flex-1 overflow-auto scrollbar-thin">
        <div className="min-w-0 p-3 space-y-3">
          {filteredWorkspaces.map((ws) => {
            const isExpanded = normalizedQuery.length > 0 || workspaceFilter !== "all"
              ? true
              : expandedWorkspaces.has(ws.id);
            const isActive = ws.id === activeWorkspaceId;
            return (
              <div key={ws.id} className="min-w-0 rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                {/* Workspace Header */}
                <div className="flex min-w-0 items-center gap-1 px-2 py-1.5">
                  <button
                    onClick={() => {
                      onSelectWorkspace(ws.id);
                      if (normalizedQuery.length === 0 && workspaceFilter === "all") {
                        onToggleWorkspace(ws.id);
                      }
                    }}
                    className={cn(
                      "flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-secondary text-foreground",
                    )}
                    title={ws.id === "default" ? "Default workspace" : ws.id}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )}
                    <Folder className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="font-semibold truncate">{ws.name}</span>
                    <span className="text-[11px] text-muted-foreground ml-auto shrink-0 bg-secondary px-1.5 py-0.5 rounded-full">
                      {ws.filteredSessions.length !== ws.totalSessions
                        ? `${ws.filteredSessions.length}/${ws.totalSessions}`
                        : ws.totalSessions}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 hover:bg-secondary"
                    onClick={() => onCreateSession(ws.id)}
                    title="New session"
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => onDeleteWorkspace(ws.id)}
                    title="Delete workspace sessions"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Session List */}
                {isExpanded && (
                  <div className="px-2 pb-2 min-w-0 space-y-1">
                    {ws.filteredSessions.map((s) => {
                      const isCurrentSession = s.sessionId === activeSessionId;
                      return (
                        <div key={s.sessionId} className="flex min-w-0 items-start gap-1">
                          <button
                            onClick={() => onSelectSession(s)}
                            className={cn(
                              "flex-1 min-w-0 overflow-hidden text-left px-3 py-2.5 rounded-lg text-sm flex flex-col transition-all border",
                              isCurrentSession
                                ? "bg-primary/5 border-primary/20 shadow-sm"
                                : "hover:bg-secondary/60 border-transparent",
                            )}
                            title={s.detailLines?.join("\n") || s.detail || s.sessionId}
                          >
                            {/* Title + Status */}
                            <div className="flex items-start justify-between gap-2">
                              <span className={cn(
                                "font-semibold truncate",
                                isCurrentSession ? "text-primary" : "text-foreground"
                              )}>
                                {s.title}
                              </span>
                              <span className={cn(
                                "text-[9px] uppercase font-semibold shrink-0 px-1.5 py-0.5 rounded-full",
                                isCurrentSession
                                  ? "bg-primary text-primary-foreground"
                                  : s.status?.toLowerCase().includes("crash") || s.status?.toLowerCase().includes("error")
                                    ? "bg-destructive/10 text-destructive"
                                    : s.status?.toLowerCase().includes("running") || s.status?.toLowerCase().includes("active")
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                      : "bg-secondary text-secondary-foreground"
                              )}>
                                {isCurrentSession ? "current" : s.status || "session"}
                              </span>
                            </div>

                            {/* Subtitle */}
                            {s.subtitle && (
                              <span className="text-[11px] text-muted-foreground mt-1 truncate">
                                {s.subtitle}
                              </span>
                            )}

                            {/* Badges row */}
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {s.swarmEnabled && (
                                <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                                  <Users className="w-2.5 h-2.5" />
                                  swarm {s.swarmPeerCount || 0}
                                </span>
                              )}
                              {s.swarmEnabled && s.swarmRole && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground uppercase">
                                  {s.swarmRole}
                                </span>
                              )}
                              {!isCurrentSession && livePhaseLabel(s) && (
                                <span className={cn(
                                  "inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full",
                                  s.livePhase === "chunking"
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-secondary text-secondary-foreground"
                                )}>
                                  <Sparkles className="w-2.5 h-2.5" />
                                  {livePhaseLabel(s)}
                                </span>
                              )}
                            </div>

                            {/* Detail */}
                            {s.detail && (
                              <span className="text-[11px] text-muted-foreground/80 mt-1.5 truncate">
                                {s.detail}
                              </span>
                            )}

                            {/* Current session indicators */}
                            {isCurrentSession && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                <span className={cn(
                                  "inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full",
                                  isProcessing
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-secondary text-secondary-foreground"
                                )}>
                                  {isProcessing ? (
                                    <><LoaderCircle className="w-2.5 h-2.5 animate-spin" />running</>
                                  ) : "idle"}
                                </span>
                                {queuedDraftCount > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground">
                                    <Layers3 className="w-2.5 h-2.5" />queued {queuedDraftCount}
                                  </span>
                                )}
                                {stdinPromptActive && (
                                  <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground">
                                    <Keyboard className="w-2.5 h-2.5" />input pending
                                  </span>
                                )}
                                {availableRouteCount > 0 && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground">
                                    {availableRouteCount} routes
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Runtime signal */}
                            {isCurrentSession && runtimeSignal && (
                              <div
                                className={cn(
                                  "mt-2 rounded-lg border px-2.5 py-1.5 text-[10px] flex items-start gap-1.5",
                                  runtimeSignal.kind === "error"
                                    ? "border-destructive/20 bg-destructive/5 text-destructive"
                                    : "border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300",
                                )}
                              >
                                {runtimeSignal.kind === "error" ? (
                                  <TriangleAlert className="w-3 h-3 mt-0.5 shrink-0" />
                                ) : (
                                  <WandSparkles className="w-3 h-3 mt-0.5 shrink-0" />
                                )}
                                <span className="break-words">
                                  {runtimeSignal.kind === "error" ? "Recent error" : "Recent compaction"}: {runtimeSignal.label}
                                </span>
                              </div>
                            )}

                            {/* Live status */}
                            {!isCurrentSession && s.liveStatusDetail && (
                              <div className="mt-1.5 rounded-lg border border-primary/10 bg-primary/5 px-2.5 py-1 text-[10px] text-muted-foreground truncate">
                                {s.liveStatusDetail}
                              </div>
                            )}

                            {/* Preview lines or model */}
                            {s.previewLines && s.previewLines.length > 0 ? (
                              <div className="mt-2 space-y-0.5">
                                {s.previewLines.slice(0, isCurrentSession ? 2 : 3).map((line, index) => (
                                  <div
                                    key={`${s.sessionId}-preview-${index}`}
                                    className="text-[10px] text-muted-foreground font-mono truncate"
                                  >
                                    {line}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground font-mono mt-2 truncate">
                                {s.model || s.sessionId.slice(0, 8)}
                              </span>
                            )}
                          </button>

                          {/* Delete button */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 mt-1 shrink-0 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
                            onClick={() => onDeleteSession(s)}
                            disabled={isCurrentSession}
                            title={isCurrentSession ? "Switch away before deleting" : "Delete session"}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {filteredWorkspaces.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Search className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-xs">No sessions match this search</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
