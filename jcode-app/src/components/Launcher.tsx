import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { motion } from "motion/react";
import {
  Command,
  CommandList,
} from "@/components/ui/command";
import { LauncherCommandItem } from "@/components/LauncherCommandItem";
import { LauncherChat } from "@/components/LauncherChat";
import { ClipboardManager } from "@/components/ClipboardManager";
import { TodoManager } from "@/components/TodoManager";
import { FileSearch } from "@/components/FileSearch";
import { Calculator } from "@/components/Calculator";
import { useLauncher, hideCurrentLauncher } from "@/hooks/useLauncher";
import { useClipboard } from "@/hooks/useClipboard";
import { useTodos } from "@/hooks/useTodos";
import { useFileSearch } from "@/hooks/useFileSearch";
import { useTheme } from "@/hooks/useTheme";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import {
  AlertCircle,
  AppWindow,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AppInfo,
  LauncherChatProvider,
  LauncherItem,
} from "@/lib/launcherTypes";

const AGENT_HINT = "Type 'ask ' followed by a question to ask JFlow.";
const AGENT_PREFIX = "ask ";

type SectionLabel =
  | "running"
  | "applications"
  | "recent"
  | "providers"
  | "sessions"
  | "builtin"
  | "tools"
  | "a2ui";

type Section = {
  label: SectionLabel;
  heading: string;
  items: LauncherItem[];
};

/** Build ordered sections. Recent/Pages first, Applications last. */
function buildSections(items: LauncherItem[]): Section[] {
  const running: LauncherItem[] = [];
  const applications: LauncherItem[] = [];
  const recent: LauncherItem[] = [];
  const sessions: LauncherItem[] = [];
  const builtin: LauncherItem[] = [];
  const tools: LauncherItem[] = [];
  const a2ui: LauncherItem[] = [];
  const providers: LauncherItem[] = [];

  for (const item of items) {
    if (item.kind === "agent") continue;
    if (item.kind === "application" && item.id.startsWith("running:")) {
      running.push(item);
      continue;
    }
    if (
      "recent" in item &&
      item.recent &&
      (item.kind === "application" ||
        item.kind === "session" ||
        item.kind === "builtin" ||
        item.kind === "a2ui" ||
        item.kind === "chat-provider")
    ) {
      recent.push(item);
      continue;
    }
    // Built-in tools are always shown in their own section, even when
    // they also appear in Recent, so the category is discoverable.
    if ("recent" in item && item.recent && item.kind === "builtin-tool") {
      recent.push(item);
    }
    switch (item.kind) {
      case "application":
        applications.push(item);
        break;
      case "session":
        sessions.push(item);
        break;
      case "builtin":
        builtin.push(item);
        break;
      case "builtin-tool":
        tools.push(item);
        break;
      case "a2ui":
        a2ui.push(item);
        break;
      case "chat-provider":
        providers.push(item);
        break;
    }
  }

  const out: Section[] = [];
  if (running.length)
    out.push({ label: "running", heading: "Running", items: running });
  if (recent.length)
    out.push({ label: "recent", heading: "Recent", items: recent });
  if (providers.length)
    out.push({ label: "providers", heading: "AI Providers", items: providers });
  if (a2ui.length)
    out.push({ label: "a2ui", heading: "A2UI Pages", items: a2ui });
  if (sessions.length)
    out.push({ label: "sessions", heading: "Sessions", items: sessions });
  if (builtin.length)
    out.push({ label: "builtin", heading: "Built-in Pages", items: builtin });
  if (tools.length)
    out.push({ label: "tools", heading: "Built-in Tools", items: tools });
  if (applications.length)
    out.push({
      label: "applications",
      heading: "Applications",
      items: applications,
    });

  return out;
}

export function Launcher() {
  // Subscribe to the shared theme so the launcher window follows the
  // user's light/dark/system choice in real time, including changes
  // made from inside the workbench window.
  useTheme();

  const {
    query,
    setQuery,
    items,
    isAgentMode,
    selectItem,
    error,
    setError,
    applications,
    refreshSessions,
    chatProviders,
    recent,
    recordRecent,
    recordUsage,
  } = useLauncher();
  const [mode, setMode] = useState<
    "palette" | "chat" | "clipboard" | "todo" | "search" | "calc"
  >("palette");
  const [chatProvider, setChatProvider] = useState<LauncherChatProvider | null>(
    null,
  );
  const [chatInitialQuery, setChatInitialQuery] = useState<string>("");
  const [inputValue, setInputValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Built-in tool state
  const [searchInitialQuery, setSearchInitialQuery] = useState("");
  const [calcInitialExpression, setCalcInitialExpression] = useState("");
  const [fileSearchKeyword, setFileSearchKeyword] = useState("");
  const [fileSearchPath, setFileSearchPath] = useState("");
  const [clipboardQuery, setClipboardQuery] = useState("");
  const clipboard = useClipboard();
  const todos = useTodos();
  const fileSearch = useFileSearch();

  useEffect(() => {
    void homeDir().then((dir) => {
      if (dir) setFileSearchPath(dir);
    });
  }, []);

  // Prefix routing: only exact tool prefixes switch modes.
  useEffect(() => {
    if (mode !== "palette") return;
    const trimmed = inputValue.trimStart();
    if (!trimmed.startsWith("/")) return;
    const rest = trimmed.slice(1);
    const match = /^(clip|todo|calc|search)(?:\s+(.*))?$/i.exec(rest);
    if (!match) return;
    const tool = match[1].toLowerCase();
    const arg = (match[2] ?? "").trim();
    switch (tool) {
      case "clip":
        setMode("clipboard");
        break;
      case "todo":
        setMode("todo");
        break;
      case "calc":
        setMode("calc");
        setCalcInitialExpression(arg);
        break;
      case "search":
        setMode("search");
        setSearchInitialQuery(arg);
        break;
    }
    setInputValue("");
    setQuery("");
  }, [inputValue, mode, setQuery]);

  // Hide the launcher on blur (click outside) only when in palette mode.
  // In chat mode the window stays visible so the user can interact with
  // other windows without losing the conversation.
  useEffect(() => {
    const handleBlur = () => {
      if (mode === "palette") {
        void hideCurrentLauncher();
      }
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [mode]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<string>("global-shortcut", () => {
      // Keep active tool/chat windows visible when the launcher is
      // re-summoned so ongoing work is not interrupted. Only reset
      // palette state and clear its search input.
      if (mode === "palette") {
        setChatProvider(null);
        setChatInitialQuery("");
        setQuery("");
        setInputValue("");
        setError(null);
        void refreshSessions();
        void applications.refreshIfStale();
        requestAnimationFrame(() => {
          const input = document.querySelector<HTMLInputElement>(
            '[data-slot="command-input"]',
          );
          input?.focus();
        });
      } else {
        void refreshSessions();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [mode, setQuery, setError, refreshSessions, applications]);
  // Debounce typing so we only ask the backend to filter/score apps once
  // the user pauses. This keeps the launcher responsive and avoids a
  // command invocation per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(inputValue);
      void applications.search(inputValue);
    }, 150);
    return () => clearTimeout(timer);
  }, [inputValue, setQuery, applications.search]);

  const listRef = useRef<HTMLDivElement | null>(null);

  // Periodically refresh the session list while the launcher is open so
  // brand-new sessions appear in the palette.
  useEffect(() => {
    const interval = setInterval(() => {
      void refreshSessions();
    }, 4000);
    return () => clearInterval(interval);
  }, [refreshSessions]);

  // ⌘1-⌘9 (Ctrl+1-9 on non-mac) jump-select the first nine visible
  // items, matching the muscle memory of users coming from Raycast,
  // Spotlight, Alfred, etc. We attach to `document` so the keydown
  // fires before the search input consumes the digit.
  const displayItems = useMemo(() => items, [items]);
  const sections = useMemo(() => buildSections(displayItems), [displayItems]);
  const hasResults = displayItems.length > 0;
  useEffect(() => {
    if (selectedIndex === null) return;
    const selected = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`,
    );
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.altKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const num = Number.parseInt(event.key, 10);
      if (!Number.isFinite(num) || num < 1 || num > 9) return;
      event.preventDefault();
      const target = displayItems[num - 1];
      if (!target) return;
      // Don't bypass the "disabled" affordance on the agent prompt
      // row: pressing ⌘1 with an empty agent query should be a
      // no-op, not a silent round-trip through expand_to_workbench.
      if (target.kind === "agent" && !target.query.trim()) return;
      void selectItem(target);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [displayItems, selectItem]);

  const showNoAppsHint =
    !applications.loading && applications.apps.length === 0 && !error;

  const startChat = useCallback(
    (provider: LauncherChatProvider, initialQuery = "") => {
      setChatProvider(provider);
      setChatInitialQuery(initialQuery);
      setMode("chat");
      recordRecent({
        kind: "chat-provider",
        id: `provider:${provider.providerKey}`,
        providerKey: provider.providerKey,
        displayName: provider.displayName,
      });
      recordUsage(`provider:${provider.providerKey}`);
    },
    [recordRecent, recordUsage],
  );

  // Tab in palette → switch to chat; Escape in tool/chat mode → back to palette.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Tab" && mode === "palette" && chatProviders.length > 0) {
        e.preventDefault();
        // Use the most recently used provider, or fall back to the
        // first configured provider.
        const lastProviderKey = recent.find(
          (r) => r.kind === "chat-provider",
        )?.providerKey;
        const provider =
          (lastProviderKey &&
            chatProviders.find((p) => p.providerKey === lastProviderKey)) ||
          chatProviders[0];
        startChat(provider);
      }
      if (e.key === "Escape" && mode !== "palette") {
        e.preventDefault();
        setMode("palette");
        setChatProvider(null);
        setChatInitialQuery("");
        setCalcInitialExpression("");
        setSearchInitialQuery("");
        // Focus the search input after returning to palette.
        requestAnimationFrame(() => {
          const input = document.querySelector<HTMLInputElement>(
            '[data-slot="command-input"]',
          );
          input?.focus();
        });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mode, chatProviders, recent, startChat]);

  const handleSelect = (item: LauncherItem) => {
    if (item.kind === "chat-provider") {
      startChat(item.provider);
      return;
    }
    if (item.kind === "agent") {
      const text = item.query.trim();
      const provider = chatProviders[0];
      if (provider) {
        startChat(provider, text);
      }
      return;
    }
    if (item.kind === "builtin-tool") {
      const toolId = `builtin-tool:${item.tool}`;
      recordRecent({
        kind: "builtin-tool",
        id: toolId,
        tool: item.tool,
        title: item.title,
      });
      recordUsage(toolId);
      if (item.tool === "chat") {
        const provider = chatProviders[0];
        if (provider) startChat(provider);
      } else {
        setMode(item.tool);
      }
      return;
    }
    void selectItem(item);
  };
  const handleStopApp = (app: AppInfo) => {
    if (!app.bundleId) {
      setError(`${app.name} has no bundle id; cannot quit it via osascript.`);
      return;
    }
    void invoke("quit_application", { bundleId: app.bundleId })
      .then(() => {
        void applications.refresh();
      })
      .catch((e: unknown) => {
        setError(`Failed to quit ${app.name}: ${String(e)}`);
      });
  };

  const handleFileSearch = useCallback(() => {
    fileSearch.search(fileSearchKeyword, fileSearchPath);
  }, [fileSearch.search, fileSearchKeyword, fileSearchPath]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!displayItems.length) return;
      event.preventDefault();
      const currentIndex = selectedIndex ?? -1;
      const nextIndex = event.key === "ArrowDown"
        ? currentIndex < 0
          ? 0
          : (currentIndex + 1) % displayItems.length
        : currentIndex < 0
          ? displayItems.length - 1
          : (currentIndex - 1 + displayItems.length) % displayItems.length;
      setSelectedIndex(nextIndex);
      return;
    }
    if (event.key === "Enter" && selectedIndex !== null) {
      const selectedItem = displayItems[selectedIndex];
      if (selectedItem) {
        if (selectedItem.kind === "agent" && !selectedItem.query.trim()) return;
        event.preventDefault();
        handleSelect(selectedItem);
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      void hideCurrentLauncher();
    }
  };

  const handleClearQuery = () => {
    setInputValue("");
    setQuery("");
  };

  const handleClearAgent = () => {
    setInputValue("");
    setQuery("");
  };

  // Strip just the `ask ` prefix so the user can quickly pivot from
  // agent mode back to regular search without re-typing their query.
  const handleStripAgent = () => {
    setInputValue((current) => current.replace(/^ask\s*/i, ""));
    setQuery((current) => current.replace(/^ask\s*/i, ""));
  };

  const handleRefreshApps = () => {
    void applications.refresh();
  };

  // In agent mode we want the single "Ask JFlow" affordance rendered as its
  // own group, not mixed with the rest of the palette.
  if (isAgentMode) {
    const item = items[0];
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="h-screen w-screen flex flex-col text-foreground"
        onKeyDown={handleKeyDown}
      >
        <Command
          filter={() => 1}
          className="flex flex-col flex-1 h-full launcher-glass overflow-hidden"
        >
          <LauncherInput
            autoFocus
            value={inputValue}
            onChange={setInputValue}
            placeholder="Ask JFlow anything…"
            mode="agent"
            onClear={handleClearAgent}
            onStripAgent={handleStripAgent}
          />
          <CommandList
            ref={listRef}
            className="flex-1 min-h-0 p-2 overflow-y-auto"
          >
            {!item && (
              <div className="px-3 py-6 text-center text-xs launcher-muted">
                Press Enter to send
              </div>
            )}
            <div role="presentation" className="launcher-group">
              <div className="launcher-group-heading">Ask JFlow</div>
              {item && (
                <LauncherCommandItem
                  item={item}
                  onSelect={handleSelect}
                  onClickSelect={() => setSelectedIndex(displayItems.indexOf(item))}
                  selected={selectedIndex === displayItems.indexOf(item)}
                  disabled={item.kind === "agent" && !item.query.trim()}
                  index={displayItems.indexOf(item)}
                />
              )}
            </div>
          </CommandList>
          <LauncherFooter
            applications={applications}
            error={error}
            dismissError={() => setError(null)}
            mode="agent"
            onRefreshApps={handleRefreshApps}
          />
        </Command>
      </motion.div>
    );
  }

  // Minimal AI chat mode for the launcher window.
  if (mode === "chat" && chatProvider) {
    return (
      <LauncherChat
        provider={chatProvider}
        initialQuery={chatInitialQuery}
        onClose={() => {
          setMode("palette");
          setChatProvider(null);
          setChatInitialQuery("");
          // If the window is unfocused (e.g. user clicked outside
          // then closed chat via keyboard), hide immediately since
          // the blur handler won't fire on an already-blurred window.
          if (!document.hasFocus()) {
            void hideCurrentLauncher();
          }
        }}
      />
    );
  }

  const closeTool = () => {
    setMode("palette");
    setInputValue("");
    setQuery("");
    setCalcInitialExpression("");
    setSearchInitialQuery("");
    setFileSearchKeyword("");
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-slot="command-input"]',
      );
      input?.focus();
    });
  };

  if (mode === "clipboard") {
    return (
      <ClipboardManager
        items={clipboard.items}
        loading={clipboard.loading}
        error={clipboard.error}
        query={clipboardQuery}
        onQueryChange={setClipboardQuery}
        onCopy={clipboard.copyItem}
        onDelete={clipboard.deleteItem}
        onTogglePin={clipboard.togglePin}
        onClear={clipboard.clearHistory}
        onClose={closeTool}
      />
    );
  }

  if (mode === "todo") {
    return (
      <TodoManager
        items={todos.items}
        loading={todos.loading}
        error={todos.error}
        onAdd={todos.addTodo}
        onToggle={todos.toggleTodo}
        onDelete={todos.deleteTodo}
        onClearCompleted={todos.clearCompleted}
        onClose={closeTool}
      />
    );
  }

  if (mode === "search") {
    return (
      <FileSearch
        results={fileSearch.results}
        searching={fileSearch.searching}
        done={fileSearch.done}
        error={fileSearch.error}
        keyword={fileSearchKeyword}
        path={fileSearchPath}
        initialQuery={searchInitialQuery}
        onKeywordChange={setFileSearchKeyword}
        onPathChange={setFileSearchPath}
        onSearch={handleFileSearch}
        onClear={fileSearch.clear}
        onClose={() => {
          fileSearch.clear();
          closeTool();
        }}
      />
    );
  }

  if (mode === "calc") {
    return (
      <Calculator
        initialExpression={calcInitialExpression}
        onClose={closeTool}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="h-screen w-screen flex flex-col text-foreground"
      onKeyDown={handleKeyDown}
    >
      <Command
        filter={() => 1}
        className="flex flex-col flex-1 h-full launcher-glass overflow-hidden"
      >
        <LauncherInput
          autoFocus
          value={inputValue}
          onChange={setInputValue}
          placeholder="Search apps, sessions, 'ask ' to chat, or /clip /todo /search /calc"
          mode="default"
          onClear={handleClearQuery}
        />
        <CommandList
          ref={listRef}
          className="flex-1 min-h-0 p-2 overflow-y-auto"
        >
          {!hasResults && (
            showNoAppsHint ? (
              <div className="flex flex-col items-center gap-3 py-8 launcher-muted">
                <AppWindow className="size-6 opacity-30" />
                <div className="text-center space-y-1">
                  <div className="text-sm">No applications found</div>
                  <div className="text-[11px] text-[var(--launcher-muted-fg)]/60 max-w-[280px]">
                    Grant Full Disk Access in System Settings, or refresh to
                    rescan.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRefreshApps}
                  className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 hover:bg-muted text-foreground px-2.5 py-1 text-[11px] transition-colors"
                >
                  <RefreshCw className="size-3" />
                  Refresh
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 launcher-muted">
                <Sparkles className="size-6 opacity-30" />
                <span className="text-sm">No matches</span>
                <span className="text-[11px] text-[var(--launcher-muted-fg)]/60">
                  {AGENT_HINT}
                </span>
              </div>
            )
          )}

          {sections.map((section) => (
            <div key={section.label} role="presentation" className="launcher-group">
              <div className="launcher-group-heading">{section.heading}</div>
              {section.items.map((item, idx) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{
                    delay: Math.min(idx * 0.004, 0.04),
                    duration: 0.08,
                  }}
                >
                  <LauncherCommandItem
                    item={item}
                    onSelect={handleSelect}
                    onClickSelect={() => setSelectedIndex(displayItems.indexOf(item))}
                    selected={selectedIndex === displayItems.indexOf(item)}
                    highlight={query}
                    onStopApp={
                      section.label === "running" ||
                      section.label === "applications" ||
                      section.label === "recent"
                        ? handleStopApp
                        : undefined
                    }
                    index={displayItems.indexOf(item)}
                  />
                </motion.div>
              ))}
            </div>
          ))}
        </CommandList>
        <LauncherFooter
          applications={applications}
          error={error}
          dismissError={() => setError(null)}
          mode="default"
          onRefreshApps={handleRefreshApps}
          showTabHint={chatProviders.length > 0}
        />
      </Command>
    </motion.div>
  );
}

interface LauncherInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  mode: "default" | "agent";
  onClear: () => void;
  /** When provided, the leading `Ask` chip becomes a button that
   * removes just the `ask ` prefix instead of clearing the whole query. */
  onStripAgent?: () => void;
}

function LauncherInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  mode,
  onClear,
  onStripAgent,
}: LauncherInputProps) {
  return (
    <div data-slot="command-input-wrapper" className="p-2 pb-2">
      <div
        data-slot="launcher-input-group"
        className={cn(
          "launcher-input flex items-center gap-2 px-3",
          mode === "agent" &&
            "border-primary/30 bg-primary/[0.07] focus-within:border-primary/50 focus-within:ring-primary/20",
        )}
      >
        {mode === "agent" ? (
          <button
            type="button"
            onClick={onStripAgent}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-primary shrink-0 select-none rounded px-1.5 py-0.5 hover:bg-primary/10 transition-colors"
            title="Remove `ask` prefix and return to search"
          >
            <Sparkles className="size-3" />
            Ask
          </button>
        ) : (
          <Search
            className="size-4 shrink-0 text-[var(--launcher-muted-fg)]/60"
            aria-hidden="true"
          />
        )}
        <CommandPrimitive.Input
          data-slot="command-input"
          autoFocus={autoFocus}
          value={value}
          onValueChange={onChange}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-foreground outline-hidden placeholder:text-[var(--launcher-muted-fg)]/60 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {value && (
          <button
            type="button"
            onClick={onClear}
            className="size-5 rounded-md flex items-center justify-center text-[var(--launcher-muted-fg)]/60 hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
            aria-label="Clear query"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}

interface LauncherFooterProps {
  applications: ReturnType<typeof useLauncher>["applications"];
  error: string | null;
  dismissError: () => void;
  mode: "default" | "agent";
  onRefreshApps: () => void;
  showTabHint?: boolean;
}

function LauncherFooter({
  applications,
  error,
  dismissError,
  mode,
  onRefreshApps,
  showTabHint,
}: LauncherFooterProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="launcher-footer border-t border-[var(--launcher-glass-border)] px-3 py-1.5 flex items-center justify-between text-[11px] gap-3"
    >
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={() => {
            void invoke("open_pages_window", { page: "settings" });
            void hideCurrentLauncher();
          }}
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          title="Open settings"
        >
          <Settings className="size-3" />
          Settings
        </button>
        {mode === "agent" ? (
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3" />
            Ask JFlow
          </span>
        ) : applications.loading ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" />
            Scanning apps…
          </span>
        ) : (
          <button
            type="button"
            onClick={onRefreshApps}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            title="Refresh application index"
          >
            <AppWindow className="size-3" />
            {applications.apps.length > 0
              ? `${applications.apps.length} apps`
              : "0 apps"}
            <RefreshCw
              className={cn(
                "size-3 ml-0.5",
                applications.loading && "animate-spin",
              )}
            />
          </button>
        )}
      </div>
      {error && (
        <button
          type="button"
          onClick={dismissError}
          className="flex items-center gap-1.5 text-destructive max-w-[40%] truncate"
          title={error}
        >
          <AlertCircle className="size-3 shrink-0" />
          <span className="truncate">{error}</span>
        </button>
      )}
      <div className="flex items-center gap-2 shrink-0">
        <KbdHint label="navigate" keys={["↑", "↓"]} />
        <KbdHint label="select" keys={["↵"]} />
        {showTabHint && <KbdHint label="chat" keys={["⇥"]} />}
        <KbdHint label="quick pick" keys={["⌘", "1–9"]} />
        <KbdHint label="close" keys={["esc"]} />
      </div>
    </motion.div>
  );
}

function KbdHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px]">
      {keys.map((key, idx) => (
        <kbd
          key={`${key}-${idx}`}
          className="launcher-kbd inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded text-foreground/80 font-mono text-[10px] leading-none"
        >
          {key}
        </kbd>
      ))}
      <span className="launcher-muted opacity-70">{label}</span>
    </span>
  );
}

// Re-export for consumers that want to compute the agent prefix.
export { AGENT_PREFIX };
