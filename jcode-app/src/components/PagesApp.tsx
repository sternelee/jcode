import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import {
	Globe,
	Server,
	Wrench,
	Users,
	Settings,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { SettingsPage } from "./SettingsPage";
import { ProviderConfigPage } from "./ProviderConfigPage";
import { McpPage } from "./McpPage";
import { SkillsPage } from "./SkillsPage";
import { TeamPage } from "./TeamPage";

type PageId = "settings" | "providers" | "mcp" | "skills" | "team";

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
	{ id: "team", label: "Swarm", icon: Users },
];

/**
 * Dedicated pages window with a clean tab layout — no left sidebar, no
 * execution timeline, no right panel. Just the page content and a top
 * tab bar for switching between Settings / Providers / MCP / Skills /
 * Swarm.
 *
 * Launched by the `open_pages_window` backend command (invoked from
 * the launcher or the workbench's sidebar). Listens for the
 * `pages:navigate` event to switch tabs programmatically.
 */
export function PagesApp() {
	useTheme();
	const [activePage, setActivePage] = useState<PageId>("settings");
	const [themeState, setThemeState] = useState<"light" | "dark">("light");

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
						theme={themeState}
						onThemeChange={setThemeState}
					/>
				)}
				{activePage === "providers" && (
					<ProviderConfigPage
						onAuthStatusChange={() => {}}
					/>
				)}
				{activePage === "mcp" && <McpPage />}
				{activePage === "skills" && <SkillsPage />}
				{activePage === "team" && <TeamPage sessions={[]} />}
			</div>
		</div>
	);
}
