import { useMemo, useState } from "react";
import type { SessionInfo } from "@/types";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Search,
  Users,
  Sparkles,
  Circle,
  Loader2,
} from "lucide-react";

interface SessionSwitcherDialogProps {
  open: boolean;
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onOpenChange: (open: boolean) => void;
  onSelectSession: (session: SessionInfo) => void;
}

function workspaceLabel(path?: string): string {
  if (!path) return "Default";
  return path.split("/").pop() || path;
}

function sessionSearchText(session: SessionInfo): string {
  return [
    session.sessionId, session.title, session.subtitle, session.detail,
    session.workingDir, session.model, session.provider,
    ...(session.previewLines || []), ...(session.detailLines || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function statusBadge(session: SessionInfo): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } | null {
  const s = session.status?.toLowerCase() || "";
  if (s.includes("crash") || s.includes("error") || s.includes("fail")) return { label: session.status!, variant: "destructive" };
  if (session.livePhase === "chunking" || session.livePhase === "thinking") return { label: session.livePhase, variant: "default" };
  if (session.liveProcessing) return { label: "running", variant: "secondary" };
  if (s.includes("running")) return { label: "running", variant: "secondary" };
  return null;
}

function livePhaseBadge(session: SessionInfo) {
  const phase = session.livePhase;
  if (!phase) return null;
  return { label: phase === "chunking" ? "streaming" : phase };
}

export function SessionSwitcherDialog({
  open,
  sessions,
  activeSessionId,
  onOpenChange,
  onSelectSession,
}: SessionSwitcherDialogProps) {
  const [query, setQuery] = useState("");

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...sessions]
      .filter((s) => !q || sessionSearchText(s).includes(q))
      .sort((a, b) => {
        if (a.sessionId === activeSessionId) return -1;
        if (b.sessionId === activeSessionId) return 1;
        return (b.status?.localeCompare(a.status || "") || 0) || a.title.localeCompare(b.title);
      });
  }, [sessions, query, activeSessionId]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Switch Session"
      description="Search recent sessions"
      className="sm:max-w-xl"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder="Search sessions, prompts, models…"
          className="flex-1 text-[14px] text-foreground bg-transparent outline-none placeholder-muted-foreground/60"
        />
        {sessions.length > 0 && (
          <span className="text-[11px] text-muted-foreground/40 shrink-0">{filteredSessions.length} sessions</span>
        )}
      </div>

      <CommandList className="max-h-[60vh] p-2">
        <CommandEmpty>
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <Search className="w-8 h-8 opacity-30" />
            <span className="text-sm">No matching sessions</span>
          </div>
        </CommandEmpty>
        <CommandGroup>
          {filteredSessions.map((session) => {
            const isActive = session.sessionId === activeSessionId;
            const badge = statusBadge(session);
            const phase = livePhaseBadge(session);

            return (
              <CommandItem
                key={session.sessionId}
                value={session.sessionId}
                onSelect={() => {
                  onSelectSession(session);
                  onOpenChange(false);
                }}
                className="px-3 py-2.5 rounded-lg aria-selected:bg-primary/10 cursor-default"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      {isActive ? (
                        <Circle className="w-2 h-2 fill-primary text-primary shrink-0" />
                      ) : (
                        <Circle className="w-2 h-2 text-muted-foreground/30 shrink-0" />
                      )}
                      <span className={cn("text-[13px] font-medium truncate", isActive && "text-primary")}>
                        {session.title || "Untitled"}
                      </span>
                    </div>

                    {badge && (
                      <Badge variant={badge.variant} className="h-[18px] text-[9px] leading-none px-1.5">
                        {badge.label}
                      </Badge>
                    )}

                    {phase && (
                      <Badge variant="secondary" className="h-[18px] text-[9px] leading-none px-1.5">
                        <Sparkles className="w-2.5 h-2.5 mr-1" />
                        {phase.label}
                      </Badge>
                    )}

                    {session.swarmEnabled && (
                      <Badge variant="outline" className="h-[18px] text-[9px] leading-none px-1.5">
                        <Users className="w-2.5 h-2.5 mr-0.5" />
                        swarm
                      </Badge>
                    )}

                    <span className="text-[10px] text-muted-foreground/50 ml-auto">
                      {workspaceLabel(session.workingDir)}
                    </span>
                  </div>

                  {session.detail && (
                    <div className="text-[12px] text-muted-foreground/70 truncate pl-5">
                      {session.detail}
                    </div>
                  )}

                  {session.liveStatusDetail && (
                    <div className="text-[12px] text-primary/60 truncate pl-5 flex items-center gap-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      {session.liveStatusDetail}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-3">
                  {session.sessionId === activeSessionId ? (
                    <Badge variant="default" className="h-5 text-[9px]">active</Badge>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/40">switch</span>
                  )}
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
