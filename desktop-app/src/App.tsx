import { invoke } from "@tauri-apps/api/core";
import { useJcodeSession } from "@/hooks/useJcodeSession";
import { ChatView } from "@/components/ChatView";
import { SessionSidebar } from "@/components/SessionSidebar";
import { ModelSelector } from "@/components/ModelSelector";
import { StdinInputModal } from "@/components/StdinInputModal";
import { SessionSwitcherDialog } from "@/components/SessionSwitcherDialog";
import { ActivityPanel } from "@/components/ActivityPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect } from "react";
import type { SessionInfo } from "@/types";
import {
  FolderOpen,
  Zap,
  ZapOff,
  Loader2,
  AlertCircle,
  Search,
  Brain,
  Wrench,
} from "lucide-react";

export default function App() {
  const {
    state,
    connect,
    resumeSession,
    sendMessage,
    queueMessage,
    cancel,
    setModel,
    listSessions,
    sendStdinResponse,
    setWorkingDir,
    clearChat,
    rewindChat,
    setReasoningEffort,
    setMemoryEnabled,
    compactContext,
    deleteSession,
    deleteWorkspaceSessions,
    setActiveWorkspace,
    toggleWorkspace,
  } = useJcodeSession();
  const [preferredModel, setPreferredModel] = useState("");
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  );
  const [workspaceMemoryPrefs, setWorkspaceMemoryPrefs] = useState<
    Record<string, boolean>
  >({});
  const [defaultWorkspaceMemoryEnabled, setDefaultWorkspaceMemoryEnabled] =
    useState(true);

  useEffect(() => {
    if (state.connected) listSessions();
  }, [state.connected, state.sessionId]);

  useEffect(() => {
    if (!state.connected) return;
    const timer = window.setInterval(() => {
      void listSessions();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [state.connected, listSessions]);

  useEffect(() => {
    const loadMemoryPreferences = async () => {
      try {
        const prefs = await invoke<{
          default_enabled: boolean;
          workspaces: Record<string, boolean>;
        }>("get_workspace_memory_preferences");
        setDefaultWorkspaceMemoryEnabled(prefs.default_enabled);
        setWorkspaceMemoryPrefs(prefs.workspaces || {});
      } catch {
        // ignore; UI will fall back to in-memory defaults
      }
    };
    void loadMemoryPreferences();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isEditable =
        target?.isContentEditable ||
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT";

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (!sessionSwitcherOpen) {
          listSessions();
        }
        setSessionSwitcherOpen((open) => !open);
        return;
      }

      if (isEditable) return;
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        listSessions();
        setSessionSwitcherOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [listSessions, sessionSwitcherOpen]);

  const pickWorkspace = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select workspace folder",
      });
      if (selected)
        setWorkingDir(typeof selected === "string" ? selected : selected[0]);
    } catch {}
  };

  const handleCreateWorkspace = () => {
    pickWorkspace();
  };

  const handleCreateSession = (workspaceId: string) => {
    const workingDir = workspaceId === "default" ? null : workspaceId;
    setActiveWorkspace(workspaceId);
    setWorkingDir(workingDir);
    void connect(
      workingDir,
      preferredModel || undefined,
      workspaceId === "default"
        ? defaultWorkspaceMemoryEnabled
        : (workspaceMemoryPrefs[workspaceId] ?? defaultWorkspaceMemoryEnabled),
    );
  };

  const handleDeleteSession = async (session: SessionInfo) => {
    const confirmed = window.confirm(
      `Delete session "${session.title}"? This cannot be undone.`,
    );
    if (!confirmed) return;
    await deleteSession(session.sessionId);
  };

  const handleDeleteWorkspace = async (workspaceId: string) => {
    const label = workspaceId === "default" ? "Default" : workspaceId;
    const confirmed = window.confirm(
      `Delete all sessions in workspace "${label}"? This cannot be undone.`,
    );
    if (!confirmed) return;
    await deleteWorkspaceSessions(workspaceId === "default" ? null : workspaceId);
  };

  const visibleConversationCount = state.messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  ).length;
  const canStartSession = !state.connected && !state.connecting;
  const currentWorkspaceKey =
    state.workingDir || state.activeWorkspaceId || "default";
  const effectiveMemoryEnabled = state.connected
    ? state.memoryEnabled
    : (workspaceMemoryPrefs[currentWorkspaceKey] ??
      defaultWorkspaceMemoryEnabled);

  const updateWorkspaceMemoryPreference = async (
    workspaceKey: string,
    enabled: boolean,
  ) => {
    if (workspaceKey === "default") {
      setDefaultWorkspaceMemoryEnabled(enabled);
    } else {
      setWorkspaceMemoryPrefs((current) => ({
        ...current,
        [workspaceKey]: enabled,
      }));
    }
    try {
      await invoke("set_workspace_memory_preference", {
        workingDir: workspaceKey === "default" ? null : workspaceKey,
        enabled,
      });
    } catch {
      // keep optimistic UI state; session toggle still applies immediately
    }
  };

  const handleSetMemoryEnabled = async (enabled: boolean) => {
    await updateWorkspaceMemoryPreference(currentWorkspaceKey, enabled);
    if (state.connected) {
      await setMemoryEnabled(enabled);
    }
  };

  const handleStart = () => {
    if (!canStartSession) return;
    connect(
      state.workingDir,
      preferredModel || undefined,
      effectiveMemoryEnabled,
    );
  };

  const handleStartDefaultWorkspace = () => {
    setActiveWorkspace("default");
    setWorkingDir(null);
    if (!canStartSession) return;
    connect(null, preferredModel || undefined, defaultWorkspaceMemoryEnabled);
  };

  const handleResume = (session: SessionInfo) => {
    setActiveWorkspace(session.workingDir || "default");
    setWorkingDir(session.workingDir || null);
    setSessionSwitcherOpen(false);
    resumeSession(session.sessionId, session.workingDir || null);
  };

  const openSessionSwitcher = () => {
    listSessions();
    setSessionSwitcherOpen(true);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {state.stdinPrompt && (
        <StdinInputModal
          prompt={state.stdinPrompt}
          onSubmit={sendStdinResponse}
        />
      )}
      <SessionSwitcherDialog
        open={sessionSwitcherOpen}
        sessions={state.sessions}
        activeSessionId={state.sessionId}
        onOpenChange={setSessionSwitcherOpen}
        onSelectSession={handleResume}
      />

      <header className="flex items-center justify-between px-4 py-2 bg-card border-b min-h-12 gap-3">
        <div className="flex items-center gap-3">
          {state.connected && (
            <Badge variant="default" className="h-5 text-[10px] gap-1">
              <Zap className="w-2.5 h-2.5" />
              connected
            </Badge>
          )}
          {state.connecting && (
            <Badge variant="secondary" className="h-5 text-[10px] gap-1">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              connecting
            </Badge>
          )}
          {!state.connected && !state.connecting && (
            <Badge variant="outline" className="h-5 text-[10px] gap-1">
              <ZapOff className="w-2.5 h-2.5" />
              disconnected
            </Badge>
          )}
          {state.workingDir && (
            <span
              className="text-[11px] text-muted-foreground font-mono bg-secondary px-2 py-0.5 rounded truncate max-w-[220px]"
              title={state.workingDir}
            >
              {state.workingDir.length > 30
                ? "..." + state.workingDir.slice(-27)
                : state.workingDir}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!state.connected ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={pickWorkspace}
                className="gap-1.5 h-8 text-xs"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {state.workingDir ? "Change" : "Select Workspace"}
              </Button>
              <>
                <Input
                  value={preferredModel}
                  onChange={(e) => setPreferredModel(e.target.value)}
                  placeholder="Model (optional)"
                  className="h-8 text-xs w-48"
                  onKeyDown={(e) => e.key === "Enter" && handleStart()}
                />
                <Button
                  variant={effectiveMemoryEnabled ? "secondary" : "outline"}
                  size="sm"
                  onClick={() =>
                    void handleSetMemoryEnabled(!effectiveMemoryEnabled)
                  }
                  className="h-8 text-xs gap-1.5"
                >
                  <Brain className="w-3.5 h-3.5" />
                  Memory default {effectiveMemoryEnabled ? "on" : "off"}
                </Button>
                <Button
                  size="sm"
                  onClick={handleStart}
                  className="h-8 text-xs"
                  disabled={!canStartSession}
                >
                  Start Session
                </Button>
              </>
            </>
          ) : (
            <>
              <ModelSelector
                currentModel={state.providerModel}
                currentProvider={state.providerName}
                onSelectModel={setModel}
                disabled={state.isProcessing}
              />
              {state.providerName && (
                <Badge variant="outline" className="h-5 text-[10px] gap-1">
                  <Brain className="w-2.5 h-2.5" />
                  {state.providerName}
                </Badge>
              )}
              {state.availableModelRoutes.length > 0 && (
                <Badge variant="secondary" className="h-5 text-[10px]">
                  {state.availableModelRoutes.length} routes
                </Badge>
              )}
              {state.isProcessing && (
                <Badge variant="default" className="h-5 text-[10px] gap-1">
                  <Wrench className="w-2.5 h-2.5" />
                  running
                </Badge>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={openSessionSwitcher}
          >
            <Search className="w-3.5 h-3.5" />
            Sessions
          </Button>
          {state.totalTokens && (
            <span className="text-[10px] text-muted-foreground font-mono">
              ↑{state.totalTokens[0]} ↓{state.totalTokens[1]}
            </span>
          )}
          {state.error && (
            <Badge
              variant="destructive"
              className="h-5 text-[10px] gap-1 max-w-[200px] truncate"
              title={state.error}
            >
              <AlertCircle className="w-2.5 h-2.5" />
              {state.error.length > 30
                ? state.error.slice(0, 30) + "..."
                : state.error}
            </Badge>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <SessionSidebar
          sessions={state.sessions}
          activeSessionId={state.sessionId}
          expandedWorkspaces={state.expandedWorkspaces}
          activeWorkspaceId={state.activeWorkspaceId}
          activeMessages={state.messages}
          activeError={state.error}
          isProcessing={state.isProcessing}
          queuedDraftCount={state.queuedDrafts.length}
          stdinPromptActive={Boolean(state.stdinPrompt)}
          availableRouteCount={state.availableModelRoutes.length}
          onSelectSession={handleResume}
          onRefresh={listSessions}
          onToggleWorkspace={toggleWorkspace}
          onSelectWorkspace={(id) => {
            setActiveWorkspace(id);
            setWorkingDir(id === "default" ? null : id);
          }}
          onCreateWorkspace={handleCreateWorkspace}
          onCreateSession={handleCreateSession}
          onDeleteSession={(session) => {
            void handleDeleteSession(session);
          }}
          onDeleteWorkspace={(workspaceId) => {
            void handleDeleteWorkspace(workspaceId);
          }}
        />
        <Separator orientation="vertical" />
        <ChatView
          messages={state.messages}
          isProcessing={state.isProcessing}
          connectionPhase={state.connectionPhase}
          connected={state.connected}
          reasoningEffort={state.reasoningEffort}
          memoryEnabled={effectiveMemoryEnabled}
          connectionType={state.connectionType}
          statusDetail={state.statusDetail}
          queuedDraftCount={state.queuedDrafts.length}
          stdinPromptActive={Boolean(state.stdinPrompt)}
          selectedMessageId={selectedMessageId}
          onSend={sendMessage}
          onQueueSend={queueMessage}
          onCancel={cancel}
          onClearChat={clearChat}
          onRewindChat={() => {
            if (visibleConversationCount > 0) {
              rewindChat(visibleConversationCount);
            }
          }}
          onSetReasoningEffort={setReasoningEffort}
          onSetMemoryEnabled={handleSetMemoryEnabled}
          onCompactContext={compactContext}
          onSelectWorkspace={pickWorkspace}
          onStartDefaultSession={handleStartDefaultWorkspace}
        />
        <Separator orientation="vertical" className="hidden xl:flex" />
        <ActivityPanel
          messages={state.messages}
          isProcessing={state.isProcessing}
          queuedDraftCount={state.queuedDrafts.length}
          stdinPrompt={state.stdinPrompt}
          providerName={state.providerName}
          providerModel={state.providerModel}
          availableModels={state.availableModels}
          availableModelRoutes={state.availableModelRoutes}
          sessionId={state.sessionId}
          reasoningEffort={state.reasoningEffort}
          connectionType={state.connectionType}
          statusDetail={state.statusDetail}
          totalTokens={state.totalTokens}
          sessions={state.sessions}
          activeWorkspaceId={state.activeWorkspaceId}
          activeSessionId={state.sessionId}
          onSelectSession={(sessionId) => {
            const session = state.sessions.find(
              (item) => item.sessionId === sessionId,
            );
            if (session) handleResume(session);
          }}
          selectedMessageId={selectedMessageId}
          onSelectMessage={setSelectedMessageId}
        />
      </div>
    </div>
  );
}
