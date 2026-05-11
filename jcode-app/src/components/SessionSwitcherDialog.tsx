import { useEffect, useMemo, useState } from "react";
import type { SessionInfo } from "@/types";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, Users, Sparkles } from "lucide-react";

interface SessionSwitcherDialogProps {
  open: boolean;
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onOpenChange: (open: boolean) => void;
  onSelectSession: (session: SessionInfo) => void;
}

function workspaceLabel(path?: string): string {
  if (!path) return "Default";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function sessionSearchText(session: SessionInfo): string {
  return [
    session.sessionId,
    session.title,
    session.subtitle,
    session.detail,
    session.workingDir,
    session.model,
    session.provider,
    ...(session.previewLines || []),
    ...(session.detailLines || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesStatusFilter(session: SessionInfo, statusFilter: "all" | "problem" | "crashed" | "running" | "swarm"): boolean {
  if (statusFilter === "all") return true;
  const normalized = session.status?.toLowerCase() || "";
  if (statusFilter === "crashed") return normalized.includes("crash");
  if (statusFilter === "running") {
    return normalized.includes("running") || normalized.includes("chunking") || Boolean(session.liveProcessing);
  }
  if (statusFilter === "swarm") {
    return Boolean(session.swarmEnabled);
  }
  return normalized.includes("error") || normalized.includes("fail") || normalized.includes("crash") || normalized.includes("blocked");
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

export function SessionSwitcherDialog({
  open,
  sessions,
  activeSessionId,
  onOpenChange,
  onSelectSession,
}: SessionSwitcherDialogProps) {
  const [query, setQuery] = useState(() => localStorage.getItem("desktop-session-switcher-search") || "");
  const [workspaceFilter, setWorkspaceFilter] = useState(() => localStorage.getItem("desktop-session-switcher-workspace-filter") || "all");
  const [statusFilter, setStatusFilter] = useState<"all" | "problem" | "crashed" | "running" | "swarm">(() => {
    const saved = localStorage.getItem("desktop-session-switcher-status-filter");
    return saved === "problem" || saved === "crashed" || saved === "running" || saved === "swarm" ? saved : "all";
  });

  useEffect(() => {
    localStorage.setItem("desktop-session-switcher-search", query);
  }, [query]);

  useEffect(() => {
    localStorage.setItem("desktop-session-switcher-workspace-filter", workspaceFilter);
  }, [workspaceFilter]);

  useEffect(() => {
    localStorage.setItem("desktop-session-switcher-status-filter", statusFilter);
  }, [statusFilter]);

  const workspaces = useMemo(() => {
    const items = Array.from(
      new Map(
        sessions.map((session) => [session.workingDir || "default", workspaceLabel(session.workingDir)]),
      ).entries(),
    );
    return items.sort((a, b) => a[1].localeCompare(b[1]));
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...sessions]
      .filter((session) => workspaceFilter === "all" || (session.workingDir || "default") === workspaceFilter)
      .filter((session) => matchesStatusFilter(session, statusFilter))
      .filter((session) => !normalizedQuery || sessionSearchText(session).includes(normalizedQuery))
      .sort((a, b) => {
        if (a.sessionId === activeSessionId) return -1;
        if (b.sessionId === activeSessionId) return 1;
        return a.title.localeCompare(b.title);
      });
  }, [sessions, workspaceFilter, statusFilter, query, activeSessionId]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Session Switcher"
      description="Search recent sessions by title, metadata, transcript preview, workspace, or error state."
      className="sm:max-w-2xl"
      showCloseButton={false}
    >
      <div className="border-b p-3 space-y-2.5 bg-background/60">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            placeholder="Search sessions, prompts, tools"
            className="pl-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={workspaceFilter} onValueChange={(value) => setWorkspaceFilter(value || "all")}>
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue placeholder="Filter workspace" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All workspaces</SelectItem>
              {workspaces.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={statusFilter === "all" ? "secondary" : "outline"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setStatusFilter("all")}
          >
            all
          </Button>
          <Button
            variant={statusFilter === "problem" ? "secondary" : "outline"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setStatusFilter("problem")}
          >
            problem
          </Button>
          <Button
            variant={statusFilter === "running" ? "secondary" : "outline"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setStatusFilter("running")}
          >
            running
          </Button>
          <Button
            variant={statusFilter === "swarm" ? "secondary" : "outline"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setStatusFilter("swarm")}
          >
            swarm
          </Button>
          <Button
            variant={statusFilter === "crashed" ? "secondary" : "outline"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setStatusFilter("crashed")}
          >
            crashed
          </Button>
        </div>
      </div>

      <Command shouldFilter={false}>
        <CommandList className="max-h-[70vh]">
          <CommandEmpty>No matching sessions.</CommandEmpty>
          <CommandGroup heading={`Recent sessions (${filteredSessions.length})`}>
            {filteredSessions.map((session) => {
              return (
                <CommandItem
                  key={session.sessionId}
                  value={session.sessionId}
                  onSelect={() => {
                    onSelectSession(session);
                    onOpenChange(false);
                  }}
                  className="items-start py-2.5"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="truncate font-medium">{session.title}</span>
                      {session.sessionId === activeSessionId && (
                        <Badge variant="secondary" className="h-5 text-[10px]">
                          current
                        </Badge>
                      )}
                      <Badge variant="outline" className="h-5 text-[10px]">
                        {workspaceLabel(session.workingDir)}
                      </Badge>
                      {session.status && (
                        <Badge variant={
                          session.status.toLowerCase().includes("crash") ||
                          session.status.toLowerCase().includes("error") ||
                          session.status.toLowerCase().includes("fail")
                            ? "destructive"
                            : "outline"
                        } className="h-5 text-[10px] uppercase">
                          {session.status}
                        </Badge>
                      )}
                      {session.swarmEnabled && (
                        <Badge variant="outline" className="h-5 text-[10px]">
                          <Users className="w-3 h-3 mr-1" />swarm {session.swarmPeerCount || 0}
                        </Badge>
                      )}
                      {session.swarmEnabled && session.swarmRole && (
                        <Badge variant="outline" className="h-5 text-[10px] uppercase">
                          {session.swarmRole}
                        </Badge>
                      )}
                      {livePhaseLabel(session) && (
                        <Badge variant={session.livePhase === "chunking" ? "default" : "secondary"} className="h-5 text-[10px]">
                          <Sparkles className="w-3 h-3 mr-1" />{livePhaseLabel(session)}
                        </Badge>
                      )}
                    </div>
                    {session.subtitle && (
                      <div className="text-xs text-muted-foreground truncate">
                        {session.subtitle}
                      </div>
                    )}
                    {session.detail && (
                      <div className="text-xs text-muted-foreground/90 truncate">
                        {session.detail}
                      </div>
                    )}
                    {session.liveStatusDetail && (
                      <div className="text-xs text-muted-foreground truncate">
                        {session.liveStatusDetail}
                      </div>
                    )}
                    {session.previewLines && session.previewLines.length > 0 && (
                      <div className="space-y-0.5 pt-0.5">
                        {session.previewLines.slice(0, 2).map((line, index) => (
                          <div
                            key={`${session.sessionId}-preview-${index}`}
                            className="truncate font-mono text-[11px] text-muted-foreground"
                          >
                            {line}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <CommandShortcut>
                    {session.sessionId === activeSessionId ? "open" : "resume"}
                  </CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
