import { cn } from "@/lib/utils";
import { AgentAvatar } from "./AgentAvatar";

interface NavBarProps {
	activeTab: string;
	onTabChange: (tab: string) => void;
	unreadCount: number;
	onLogout?: () => void;
}

const navItems = [
	{ id: "chat", icon: ChatIcon },
	{ id: "network", icon: NetworkIcon },
	{ id: "media", icon: MediaIcon },
	{ id: "tasks", icon: TasksIcon },
	{ id: "monitor", icon: MonitorIcon },
	{ id: "team", icon: TeamIcon },
	{ id: "settings", icon: SettingsIcon },
];

export function NavBar({
	activeTab,
	onTabChange,
	unreadCount,
	onLogout,
}: NavBarProps) {
	return (
		<nav className="w-[60px] min-w-[60px] bg-sidebar border-r border-sidebar-border flex flex-col items-center py-3 select-none">
			{/* User avatar */}
			<div className="relative mb-6">
				<AgentAvatar name="You" size="lg" />
				<span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full" />
			</div>

			{/* Navigation icons */}
			<div className="flex flex-col items-center gap-1 flex-1">
				{navItems.map((item) => (
					<button
						key={item.id}
						type="button"
						onClick={() => onTabChange(item.id)}
						className={cn(
							"relative w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
							activeTab === item.id
								? "bg-sidebar-accent text-sidebar-primary"
								: "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
						)}
						title={item.id}
					>
						<item.icon className="w-5 h-5" />
						{item.id === "chat" && unreadCount > 0 && (
							<span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
								{unreadCount > 9 ? "9+" : unreadCount}
							</span>
						)}
					</button>
				))}
			</div>

			{/* Logout */}
			<button
				type="button"
				onClick={onLogout}
				className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
				title="Logout / Collapse"
			>
				<LogoutIcon className="w-5 h-5" />
			</button>
		</nav>
	);
}

// Inline SVG icon components
function ChatIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</svg>
	);
}

function NetworkIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<circle cx="12" cy="12" r="10" />
			<circle cx="12" cy="12" r="4" />
			<circle cx="12" cy="12" r="1" fill="currentColor" />
			<path d="M12 2v4M22 12h-4M12 18v4M4 12H2" />
			<path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M19.07 4.93l-2.83 2.83M7.76 16.24l-2.83 2.83" />
		</svg>
	);
}

function MediaIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<polygon points="5 3 19 12 5 21 5 3" />
		</svg>
	);
}

function TasksIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
			<path d="M9 12l2 2 4-4" />
		</svg>
	);
}

function MonitorIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	);
}

function TeamIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
			<circle cx="9" cy="7" r="4" />
			<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
			<path d="M16 3.13a4 4 0 0 1 0 7.75" />
		</svg>
	);
}

function SettingsIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
		</svg>
	);
}

function LogoutIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
			<polyline points="16 17 21 12 16 7" />
			<line x1="21" y1="12" x2="9" y2="12" />
		</svg>
	);
}
