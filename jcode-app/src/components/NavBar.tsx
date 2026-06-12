import { cn } from "@/lib/utils";
import {
	MessageSquare,
	Globe,
	Image,
	CheckSquare,
	Eye,
	Users,
	Settings,
	LogOut,
	Menu,
	Server,
	Wrench,
} from "lucide-react";

interface NavBarProps {
	activeTab: string;
	onTabChange: (tab: string) => void;
	unreadCount: number;
	onLogout?: () => void;
	onToggleSidebar?: () => void;
}

const navItems = [
	{ id: "chat", icon: MessageSquare, label: "Chat" },
	{ id: "network", icon: Globe, label: "Network" },
	{ id: "media", icon: Image, label: "Media" },
	{ id: "tasks", icon: CheckSquare, label: "Tasks" },
	{ id: "monitor", icon: Eye, label: "Monitor" },
	{ id: "team", icon: Users, label: "Swarm" },
	{ id: "mcp", icon: Server, label: "MCP" },
	{ id: "skills", icon: Wrench, label: "Skills" },
];

export function NavBar({
	activeTab,
	onTabChange,
	unreadCount,
	onLogout,
	onToggleSidebar,
}: NavBarProps) {
	return (
		<nav className="w-[52px] min-w-[52px] bg-sidebar border-r border-sidebar-border flex flex-col items-center py-3 select-none gap-0.5">
			{/* Logo */}
			<div className="w-8 h-8 rounded-lg bg-foreground/90 flex items-center justify-center mb-2">
				<span className="text-background text-[13px] font-semibold">J</span>
			</div>

			{/* Mobile sidebar toggle */}
			{onToggleSidebar && (
				<button
					type="button"
					onClick={onToggleSidebar}
					className="w-9 h-9 rounded-lg flex items-center justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-all duration-150 lg:hidden"
					title="Toggle sidebar"
				>
					<Menu className="w-4.5 h-4.5" />
				</button>
			)}

			{/* Nav items */}
			<div className="flex flex-col items-center gap-0.5 flex-1">
				{navItems.map((item) => {
					const isActive = activeTab === item.id;
					const Icon = item.icon;
					return (
						<button
							key={item.id}
							type="button"
							onClick={() => onTabChange(item.id)}
							className={cn(
								"relative w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150",
								isActive
									? "bg-sidebar-accent text-sidebar-primary"
									: "text-sidebar-foreground/45 hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
							)}
							title={item.label}
						>
							<Icon className="w-[18px] h-[18px]" />
							{item.id === "chat" && unreadCount > 0 && (
								<span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full flex items-center justify-center px-1">
									{unreadCount > 9 ? "9+" : unreadCount}
								</span>
							)}
						</button>
					);
				})}
			</div>

			{/* Settings */}
			<button
				type="button"
				onClick={() => onTabChange("settings")}
				className={cn(
					"w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150",
					activeTab === "settings"
						? "bg-sidebar-accent text-sidebar-primary"
						: "text-sidebar-foreground/45 hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
				)}
				title="Settings"
			>
				<Settings className="w-[18px] h-[18px]" />
			</button>

			{/* Logout */}
			{onLogout && (
				<button
					type="button"
					onClick={onLogout}
					className="w-9 h-9 rounded-lg flex items-center justify-center text-sidebar-foreground/35 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-all duration-150"
					title="Logout"
				>
					<LogOut className="w-4 h-4" />
				</button>
			)}
		</nav>
	);
}
