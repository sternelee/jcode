import { useEffect, useMemo, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandList,
} from "@/components/ui/command";
import { LauncherCommandItem } from "@/components/LauncherCommandItem";
import { useLauncher, hideCurrentLauncher } from "@/hooks/useLauncher";
import { useTheme } from "@/hooks/useTheme";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
	AlertCircle,
	AppWindow,
	Loader2,
	RefreshCw,
	Search,
	Sparkles,
	X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppInfo, LauncherItem } from "@/lib/launcherTypes";

const AGENT_HINT = "Type 'ask ' followed by a question to ask JCode.";
const AGENT_PREFIX = "ask ";

type SectionLabel = "running" | "applications" | "recent" | "sessions" | "builtin";

type Section = {
	label: SectionLabel;
	heading: string;
	items: LauncherItem[];
};

/** Build ordered sections. Always ① Running ② Applications ③ Pages */
function buildSections(items: LauncherItem[]): Section[] {
	const running: LauncherItem[] = [];
	const applications: LauncherItem[] = [];
	const recent: LauncherItem[] = [];
	const sessions: LauncherItem[] = [];
	const builtin: LauncherItem[] = [];

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
				item.kind === "builtin")
		) {
			recent.push(item);
			continue;
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
		}
	}

	const out: Section[] = [];
	if (running.length) out.push({ label: "running", heading: "Running", items: running });
	out.push({ label: "applications", heading: "Applications", items: applications });
	if (recent.length) out.push({ label: "recent", heading: "Recent", items: recent });
	if (sessions.length) out.push({ label: "sessions", heading: "Sessions", items: sessions });
	if (builtin.length) out.push({ label: "builtin", heading: "Pages", items: builtin });

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
	} = useLauncher();

	// Listen for the global shortcut so the launcher resets state every time
	// it appears. Without this, a half-typed query from the previous
	// invocation would carry over.
	useEffect(() => {
		let unlisten: (() => void) | null = null;
		void listen<string>("global-shortcut", () => {
			setQuery("");
			setError(null);
			void refreshSessions();
			// Skip the app-index rescan if we already refreshed within the
			// cooldown window; the footer refresh button is the user-facing
			// way to force a fresh scan.
			void applications.refreshIfStale();
			// Re-focus the search input on the next frame so the user
			// can start typing immediately, regardless of which window
			// had focus when the launcher was summoned.
			requestAnimationFrame(() => {
				const input = document.querySelector<HTMLInputElement>(
					'[data-slot="command-input"]',
				);
				input?.focus();
			});
		}).then((fn) => {
			unlisten = fn;
		});
		return () => {
			if (unlisten) unlisten();
		};
	}, [setQuery, setError, refreshSessions, applications]);

	// Track which item the keyboard cursor is hovering so we can give a
	// visible hint. `cmdk` handles the actual selection state internally;
	// we just observe the `data-selected` attribute.
	const listRef = useRef<HTMLDivElement | null>(null);
	const [activeId, setActiveId] = useState<string | null>(null);

	useEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const onChange = () => {
			const selected = list.querySelector(
				"[data-slot=command-item][data-selected=true]",
			) as HTMLElement | null;
			if (selected) {
				const command = selected as HTMLElement;
				setActiveId(command.dataset.value ?? null);
			}
		};
		const observer = new MutationObserver(onChange);
		observer.observe(list, {
			attributes: true,
			attributeFilter: ["data-selected"],
			subtree: true,
		});
		onChange();
		return () => observer.disconnect();
	}, []);

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
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (event.altKey) return;
			if (!event.metaKey && !event.ctrlKey) return;
			const num = Number.parseInt(event.key, 10);
			if (!Number.isFinite(num) || num < 1 || num > 9) return;
			event.preventDefault();
			const target = items[num - 1];
			if (!target) return;
			// Don't bypass the "disabled" affordance on the agent prompt
			// row: pressing ⌘1 with an empty agent query should be a
			// no-op, not a silent round-trip through expand_to_workbench.
			if (target.kind === "agent" && !target.query.trim()) return;
			void selectItem(target);
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [items, selectItem]);

	const sections = useMemo(
		() => buildSections(items),
		[items],
	);
	const hasResults = items.length > 0;
	const itemIndexById = useMemo(() => {
		const map = new Map<string, number>();
		items.forEach((item, i) => map.set(item.id, i));
		return map;
	}, [items]);
	const showNoAppsHint =
		!applications.loading &&
		applications.apps.length === 0 &&
		!error;

	const handleSelect = (item: LauncherItem) => {
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

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			void hideCurrentLauncher();
		}
	};

	const handleClearQuery = () => setQuery("");

	const handleClearAgent = () => setQuery("");

	// Strip just the `ask ` prefix so the user can quickly pivot from
	// agent mode back to regular search without re-typing their query.
	const handleStripAgent = () => {
		setQuery((current) => current.replace(/^ask\s*/i, ""));
	};

	const handleRefreshApps = () => {
		void applications.refresh();
	};

	// In agent mode we want the single "Ask JCode" affordance rendered as its
	// own group, not mixed with the rest of the palette.
	if (isAgentMode) {
		const item = items[0];
		return (
			<div
				className="h-screen w-screen flex flex-col text-foreground p-2"
				onKeyDown={handleKeyDown}
			>
				<Command
					shouldFilter={false}
					className="flex-1 rounded-xl! bg-card/95 backdrop-blur-xl border border-primary/40 shadow-2xl overflow-hidden ring-1 ring-primary/20 animate-fade-in"
				>
					<LauncherInput
						autoFocus
						value={query}
						onChange={setQuery}
						placeholder="Ask JCode anything…"
						mode="agent"
						onClear={handleClearAgent}
						onStripAgent={handleStripAgent}
					/>
					<CommandList ref={listRef} className="max-h-[320px] p-2">
						<CommandEmpty>
							<div className="px-3 py-6 text-center text-xs text-muted-foreground">
								Press Enter to send
							</div>
						</CommandEmpty>
						<CommandGroup heading="Ask JCode">
							{item && (
								<LauncherCommandItem
									item={item}
									active={activeId === getValue(item)}
									onSelect={handleSelect}
									disabled={item.kind === "agent" && !item.query.trim()}
									index={itemIndexById.get(item.id)}
								/>
							)}
						</CommandGroup>
					</CommandList>
					<LauncherFooter
						applications={applications}
						error={error}
						dismissError={() => setError(null)}
						mode="agent"
						onRefreshApps={handleRefreshApps}
					/>
				</Command>
			</div>
		);
	}

	return (
		<div
			className="h-screen w-screen flex flex-col text-foreground p-2"
			onKeyDown={handleKeyDown}
		>
			<Command
				shouldFilter={false}
				className="flex-1 rounded-xl! bg-card/95 backdrop-blur-xl border border-border shadow-2xl overflow-hidden animate-fade-in"
			>
				<LauncherInput
					autoFocus
					value={query}
					onChange={setQuery}
					placeholder="Search apps, sessions, or type 'ask ' to chat…"
					mode="default"
					onClear={handleClearQuery}
				/>
				<CommandList ref={listRef} className="max-h-[320px] p-2">
					{!hasResults && (
						<CommandEmpty>
							{showNoAppsHint ? (
								<div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
									<AppWindow className="size-6 opacity-30" />
									<div className="text-center space-y-1">
										<div className="text-sm">No applications found</div>
										<div className="text-[11px] text-muted-foreground/60 max-w-[280px]">
											Grant Full Disk Access in System Settings, or refresh
											to rescan.
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
								<div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
									<Sparkles className="size-6 opacity-30" />
									<span className="text-sm">No matches</span>
									<span className="text-[11px] text-muted-foreground/60">
										{AGENT_HINT}
									</span>
								</div>
							)}
						</CommandEmpty>
					)}

					{sections.map((section) => (
						<CommandGroup key={section.label} heading={section.heading}>
							{section.items.map((item) => (
								<LauncherCommandItem
									key={item.id}
									item={item}
									active={activeId === getValue(item)}
									onSelect={handleSelect}
									highlight={query}
									onStopApp={
										section.label === "running" ||
										section.label === "applications" ||
										section.label === "recent"
											? handleStopApp
											: undefined
									}
									index={itemIndexById.get(item.id)}
								/>
							))}
						</CommandGroup>
					))}
				</CommandList>
				<LauncherFooter
					applications={applications}
					error={error}
					dismissError={() => setError(null)}
					mode="default"
					onRefreshApps={handleRefreshApps}
				/>
			</Command>
		</div>
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
		<div data-slot="command-input-wrapper" className="p-1 pb-0">
			<div
				data-slot="launcher-input-group"
				className={cn(
					"flex items-center gap-2 h-10 px-3 rounded-lg border transition-colors",
					mode === "agent"
						? "border-primary/30 bg-primary/5 ring-1 ring-primary/15"
						: "border-input/30 bg-input/30",
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
						className="size-4 shrink-0 text-muted-foreground/60"
						aria-hidden="true"
					/>
				)}
				<CommandPrimitive.Input
					data-slot="command-input"
					autoFocus={autoFocus}
					value={value}
					onValueChange={onChange}
					placeholder={placeholder}
					className="flex-1 bg-transparent text-sm text-foreground outline-hidden placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-50"
				/>
				{value && (
					<button
						type="button"
						onClick={onClear}
						className="size-5 rounded-md flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
						aria-label="Clear query"
					>
						<X className="size-3" />
					</button>
				)}
			</div>
		</div>
	);
}

function getValue(item: LauncherItem): string {
	switch (item.kind) {
		case "application":
			return `app:${item.app.name} ${item.app.bundleId ?? ""} ${item.app.appPath}`;
		case "session":
			return `session:${item.session.title} ${item.session.subtitle ?? ""} ${item.session.workingDir ?? ""}`;
		case "builtin":
			return `builtin:${item.title} ${item.keyword} ${item.page}`;
		case "agent":
			return `agent:${item.query}`;
	}
}

interface LauncherFooterProps {
	applications: ReturnType<typeof useLauncher>["applications"];
	error: string | null;
	dismissError: () => void;
	mode: "default" | "agent";
	onRefreshApps: () => void;
}

function LauncherFooter({
	applications,
	error,
	dismissError,
	mode,
	onRefreshApps,
}: LauncherFooterProps) {
	return (
		<div className="border-t border-border px-3 py-1.5 flex items-center justify-between text-[11px] text-muted-foreground gap-3">
			<div className="flex items-center gap-3 min-w-0">
				{mode === "agent" ? (
					<span className="flex items-center gap-1.5">
						<Sparkles className="size-3" />
						Ask JCode
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
				<KbdHint label="quick pick" keys={["⌘", "1–9"]} />
				<KbdHint label="close" keys={["esc"]} />
			</div>
		</div>
	);
}

function KbdHint({ keys, label }: { keys: string[]; label: string }) {
	return (
		<span className="inline-flex items-center gap-1 text-[10px]">
			{keys.map((key, idx) => (
				<kbd
					key={`${key}-${idx}`}
					className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded border border-border bg-muted/50 text-foreground/80 font-mono text-[10px] leading-none"
				>
					{key}
				</kbd>
			))}
			<span className="text-muted-foreground/70">{label}</span>
		</span>
	);
}

// Re-export for consumers that want to compute the agent prefix.
export { AGENT_PREFIX };
