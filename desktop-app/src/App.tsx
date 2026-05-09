import { useJcodeSession } from "@/hooks/useJcodeSession";
import { ChatView } from "@/components/ChatView";
import { SessionSidebar } from "@/components/SessionSidebar";
import { ModelSelector } from "@/components/ModelSelector";
import { StdinInputModal } from "@/components/StdinInputModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect } from "react";
import { FolderOpen, Zap, ZapOff, Loader2, AlertCircle } from "lucide-react";

export default function App() {
  const {
    state,
    connect,
    resumeSession,
    sendMessage,
    cancel,
    setModel,
    listSessions,
    sendStdinResponse,
    setWorkingDir,
    clearChat,
    rewindChat,
    setReasoningEffort,
    compactContext,
    setActiveWorkspace,
    toggleWorkspace,
  } = useJcodeSession();
  const [preferredModel, setPreferredModel] = useState("");

  useEffect(() => {
    if (state.connected) listSessions();
  }, [state.connected]);

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
    setActiveWorkspace(workspaceId);
    setWorkingDir(workspaceId === "default" ? null : workspaceId);
  };

  const handleStart = () => {
    if (state.workingDir)
      connect(state.workingDir, preferredModel || undefined);
  };
  const handleResume = (sid: string) => resumeSession(sid, state.workingDir);

  return (
    <div className="flex flex-col h-screen bg-background">
      {state.stdinPrompt && (
        <StdinInputModal
          prompt={state.stdinPrompt}
          onSubmit={sendStdinResponse}
        />
      )}

      <header className="flex items-center justify-between px-4 py-2 bg-card border-b min-h-12 gap-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm text-primary">
            JCode Desktop
          </span>
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
              {state.workingDir && (
                <>
                  <Input
                    value={preferredModel}
                    onChange={(e) => setPreferredModel(e.target.value)}
                    placeholder="Model (optional)"
                    className="h-8 text-xs w-48"
                    onKeyDown={(e) => e.key === "Enter" && handleStart()}
                  />
                  <Button
                    size="sm"
                    onClick={handleStart}
                    className="h-8 text-xs"
                  >
                    Start Session
                  </Button>
                </>
              )}
            </>
          ) : (
            <ModelSelector
              currentModel={state.providerModel}
              onSelectModel={setModel}
              disabled={state.isProcessing}
            />
          )}
        </div>

        <div className="flex items-center gap-2">
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
          onSelectSession={handleResume}
          onRefresh={listSessions}
          onToggleWorkspace={toggleWorkspace}
          onSelectWorkspace={(id) => {
            setActiveWorkspace(id);
            setWorkingDir(id === "default" ? null : id);
          }}
          onCreateWorkspace={handleCreateWorkspace}
          onCreateSession={handleCreateSession}
          isConnected={state.connected}
        />
        <Separator orientation="vertical" />
        <ChatView
          messages={state.messages}
          isProcessing={state.isProcessing}
          connectionPhase={state.connectionPhase}
          connected={state.connected}
          reasoningEffort={state.reasoningEffort}
          connectionType={state.connectionType}
          statusDetail={state.statusDetail}
          onSend={sendMessage}
          onCancel={cancel}
          onClearChat={clearChat}
          onRewindChat={() => {
            if (state.messages.length > 0) {
              rewindChat(state.messages.length - 1);
            }
          }}
          onSetReasoningEffort={setReasoningEffort}
          onCompactContext={compactContext}
          onSelectWorkspace={pickWorkspace}
        />
      </div>
    </div>
  );
}
