import { useState, useEffect, useCallback, type PointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import {
	Globe,
	Minus,
	Server,
	Settings,
	Square,
	Wrench,
	X,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { SettingsPage } from "./SettingsPage";
import { ProviderConfigPage } from "./ProviderConfigPage";
import { McpPage } from "./McpPage";
import { SkillsPage } from "./SkillsPage";

/** Top-level page IDs shown as tabs in the pages window. */
type PageId = "settings" | "providers" | "mcp" | "skills";


interface PageTab {
	id: PageId;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
}

const PAGE_TABS: PageTab[] = [
	{ id: "settings", label: "Settings", icon: Settings },
	{ id: "providers", label: "Providers", icon: Globe },
	{ id: "mcp", label: "MCP", icon: Server },
	{ id: "skills", label: "Skills", icon: Wrench },
];

/**
 * Custom macOS-style title bar for the pages window. The window runs with
 * `decorations: false` + `transparent: true`, so we draw the three
 * traffic-light buttons ourselves and implement dragging via Rust's
 * `drag_window()` command.
 */
function PagesTitleBar() {
	const handleDragStart = useCallback((e: PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		void invoke("drag_window");
	}, []);

	const handleClose = useCallback(() => {
		void invoke("hide_pages_window");
	}, []);

	const handleMinimize = useCallback(() => {
		void invoke("minimize_window");
	}, []);

	const handleMaximize = useCallback(() => {
		void invoke("toggle_maximize_window");
	}, []);

	return (
		<div className="relative h-7 w-full select-none border-b border-border bg-card shrink-0">
			{/* Draggable layer behind the buttons. */}
			<div
				className="absolute inset-0 z-0"
				onPointerDown={handleDragStart}
				onDoubleClick={handleMaximize}
			/>
			{/* Buttons sit above the drag layer so clicks don't start a drag. */}
			<div
				className="absolute left-3 top-0 z-10 flex h-7 items-center gap-2"
				onPointerDown={(e) => e.stopPropagation()}
			>
				<button
					type="button"
					aria-label="Close window"
					title="Close"
					onClick={handleClose}
					className="group/btn flex h-5 w-5 items-center justify-center rounded-full"
				>
					<span className="flex h-3 w-3 items-center justify-center rounded-full bg-[#ff5f57] group-hover/btn:brightness-90 group-active/btn:brightness-75">
						<X className="h-2 w-2 text-[#7a0010] opacity-0 group-hover/btn:opacity-100" />
					</span>
				</button>
				<button
					type="button"
					aria-label="Minimize window"
					title="Minimize"
					onClick={handleMinimize}
					className="group/btn flex h-5 w-5 items-center justify-center rounded-full"
				>
					<span className="flex h-3 w-3 items-center justify-center rounded-full bg-[#febc2e] group-hover/btn:brightness-90 group-active/btn:brightness-75">
						<Minus className="h-2 w-2 text-[#7a4a00] opacity-0 group-hover/btn:opacity-100" />
					</span>
				</button>
				<button
					type="button"
					aria-label="Maximize window"
					title="Maximize"
					onClick={handleMaximize}
					className="group/btn flex h-5 w-5 items-center justify-center rounded-full"
				>
					<span className="flex h-3 w-3 items-center justify-center rounded-full bg-[#28c840] group-hover/btn:brightness-90 group-active/btn:brightness-75">
						<Square className="h-2 w-2 rotate-180 text-[#0a4d12] opacity-0 group-hover/btn:opacity-100" />
					</span>
				</button>
			</div>
			{/* Centered window title, non-interactive. */}
			<div className="pointer-events-none absolute inset-0 z-[5] flex h-7 items-center justify-center text-[12px] font-medium text-muted-foreground/80">
        JFlow Settings
			</div>
		</div>
	);
}

/**
 * Dedicated pages window with a clean tab layout — no left sidebar, no
 * execution timeline, no right panel. Just the page content and a top
 * tab bar for switching between Settings / Providers / MCP / Skills /
 * Swarm.
 *
 * The window itself is undecorated and transparent; this component paints
 * its own background and title bar so light/dark theme and rounded corners
 * remain consistent with the workbench and launcher.
 *
 * Launched by the `open_pages_window` backend command (invoked from
 * the launcher or the workbench's sidebar). Listens for the
 * `pages:navigate` event to switch tabs programmatically.
 */
export function PagesApp() {
	const { effectiveTheme, setTheme } = useTheme();
	const [activePage, setActivePage] = useState<PageId>("settings");

	// Listen for navigation events from the backend
	useEffect(() => {
		let unlistener: (() => void) | null = null;
		void listen<string>("pages:navigate", (event) => {
			const page = event.payload as string;
			if (PAGE_TABS.some((t) => t.id === page)) {
				setActivePage(page as PageId);
			}
		}).then((fn) => {
			unlistener = fn;
		});
		return () => {
			if (unlistener) unlistener();
		};
	}, []);

	return (
		<div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
			<PagesTitleBar />
			{/* Tab bar */}
			<div className="flex items-center border-b border-border bg-card px-4 shrink-0">
				<div className="flex gap-1 py-2">
					{PAGE_TABS.map((tab) => {
						const isActive = activePage === tab.id;
						const Icon = tab.icon;
						return (
							<button
								key={tab.id}
								type="button"
								onClick={() => setActivePage(tab.id)}
								className={cn(
									"flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all",
									isActive
										? "bg-primary/10 text-primary shadow-sm"
										: "text-muted-foreground hover:text-foreground hover:bg-muted",
								)}
							>
								<Icon className="w-4 h-4" />
								{tab.label}
							</button>
						);
					})}
				</div>
			</div>

			{/* Page content */}
			<div className="flex-1 overflow-y-auto">
				{activePage === "settings" && (
					<SettingsPage
						theme={effectiveTheme}
						onThemeChange={setTheme}
					/>
				)}
				{activePage === "providers" && <ProviderConfigPage />}
				{activePage === "mcp" && <McpPage />}
				{activePage === "skills" && <SkillsPage />}
			</div>
		</div>
	);
}
