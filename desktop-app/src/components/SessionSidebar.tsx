import type { SessionInfo, Workspace } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, ChevronRight, ChevronDown, Folder } from "lucide-react";
import { useMemo } from "react";

interface SessionSidebarProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  expandedWorkspaces: Set<string>;
  activeWorkspaceId: string | null;
  onSelectSession: (sessionId: string) => void;
  onRefresh: () => void;
  onToggleWorkspace: (workspaceId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  isConnected: boolean;
}

function workspaceName(dir: string): string {
  const parts = dir.split(/[/\\]/);
  return parts[parts.length - 1] || dir;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  expandedWorkspaces,
  activeWorkspaceId,
  onSelectSession,
  onRefresh,
  onToggleWorkspace,
  onSelectWorkspace,
  isConnected,
}: SessionSidebarProps) {
  const workspaces = useMemo(() => {
    const map = new Map<string, SessionInfo[]>();
    for (const s of sessions) {
      const key = s.workingDir || "default";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    // Sort workspaces: active first, then by name
    const sorted = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === activeWorkspaceId) return -1;
      if (b[0] === activeWorkspaceId) return 1;
      return workspaceName(a[0]).localeCompare(workspaceName(b[0]));
    });
    return sorted.map(
      ([id, sessions]): Workspace => ({
        id,
        name: id === "default" ? "Default" : workspaceName(id),
        sessions: sessions.sort((a, b) =>
          b.sessionId.localeCompare(a.sessionId),
        ),
      }),
    );
  }, [sessions, activeWorkspaceId]);

  return (
    <div className="w-[240px] min-w-[200px] bg-card border-r flex flex-col">
      <div className="flex items-center justify-between px-3.5 py-3 border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Workspaces
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onRefresh}
        >
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>
      <ScrollArea className="flex-1 overflow-auto scrollbar-thin">
        <div className="p-2">
          {workspaces.map((ws) => {
            const isExpanded = expandedWorkspaces.has(ws.id);
            const isActive = ws.id === activeWorkspaceId;
            return (
              <div key={ws.id} className="mb-1">
                <button
                  onClick={() => {
                    onSelectWorkspace(ws.id);
                    onToggleWorkspace(ws.id);
                  }}
                  className={cn(
                    "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-secondary text-foreground",
                  )}
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <Folder className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-medium truncate">{ws.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                    {ws.sessions.length}
                  </span>
                </button>
                {isExpanded && (
                  <div className="ml-4 mt-0.5 space-y-0.5">
                    {ws.sessions.map((s) => (
                      <button
                        key={s.sessionId}
                        onClick={() => onSelectSession(s.sessionId)}
                        disabled={!isConnected}
                        className={cn(
                          "w-full text-left px-2.5 py-1.5 rounded-md text-sm flex flex-col transition-colors",
                          s.sessionId === activeSessionId
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-secondary text-muted-foreground",
                          !isConnected && "opacity-40 cursor-not-allowed",
                        )}
                      >
                        <span className="font-medium truncate">{s.title}</span>
                        <span className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          {s.model || s.sessionId.slice(0, 8)}
                        </span>
                        {s.status && (
                          <span className="text-[9px] text-muted-foreground uppercase mt-0.5">
                            {s.status}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {workspaces.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              No sessions
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
