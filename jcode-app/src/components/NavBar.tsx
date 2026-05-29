import { cn } from "@/lib/utils";

interface NavBarProps {
	activeTab: string;
	onTabChange: (tab: string) => void;
	unreadCount: number;
	onLogout?: () => void;
}

const navItems = [
	{ id: "chat", icon: MessageIcon, label: "Chat" },
	{ id: "network", icon: NetworkIcon, label: "Network" },
	{ id: "media", icon: ImageIcon, label: "Media" },
	{ id: "tasks", icon: CheckIcon, label: "Tasks" },
	{ id: "monitor", icon: EyeIcon, label: "Monitor" },
	{ id: "team", icon: UsersIcon, label: "Swarm" },
];

export function NavBar({
	activeTab,
	onTabChange,
	unreadCount,
	onLogout,
}: NavBarProps) {
	return (
		<nav className="w-[56px] min-w-[56px] bg-sidebar border-r border-sidebar-border flex flex-col items-center py-3 select-none gap-1">
			{/* Logo / avatar */}
			<div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center mb-3 shadow-sm">
				<span className="text-white text-[15px] font-bold">J</span>
			</div>

			{/* Nav items */}
			<div className="flex flex-col items-center gap-0.5 flex-1">
				{navItems.map((item) => {
					const isActive = activeTab === item.id;
					return (
						<button
							key={item.id}
							type="button"
							onClick={() => onTabChange(item.id)}
							className={cn(
								"relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150",
								isActive
									? "bg-sidebar-accent text-sidebar-primary shadow-sm"
									: "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
							)}
							title={item.label}
						>
							<item.icon className="w-[20px] h-[20px]" />
							{item.id === "chat" && unreadCount > 0 && (
								<span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm">
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
					"w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150",
					activeTab === "settings"
						? "bg-sidebar-accent text-sidebar-primary shadow-sm"
						: "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
				)}
				title="Settings"
			>
				<SettingsIcon className="w-[20px] h-[20px]" />
			</button>

			{/* Logout / collapse — bottom */}
			{onLogout && (
				<button
					type="button"
					onClick={onLogout}
					className="w-10 h-10 rounded-xl flex items-center justify-center text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-150"
					title="Logout"
				>
					<LogoutIcon className="w-[18px] h-[18px]" />
				</button>
			)}
		</nav>
	);
}

/* ── Icons ─────────────────────────────────────────────────────────────── */

function MessageIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 22 22" fill="none" className={className}>
			<path
				d="M2 4a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H7.5l-3.75 3V4z"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function NetworkIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 22 22" fill="none" className={className}>
			<circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.6" />
			<circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1.6" />
			<path d="M11 3v3M19 11h-3M11 16v3M6 11H3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
		</svg>
	);
}

function ImageIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 22 22" fill="none" className={className}>
			<rect x="2" y="3" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
			<circle cx="7.5" cy="8.5" r="1.5" fill="currentColor" />
			<path d="M2 16l4-4 3 3 3-4 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
		</svg>
	);
}

function CheckIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 22 22" fill="none" className={className}>
			<rect x="3" y="3" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
			<path d="M7 11l3 3 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function EyeIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 22 22" fill="none" className={className}>
			<path
				d="M2.5 11s3.5-6 8.5-6 8.5 6 8.5 6-3.5 6-8.5 6-8.5-6-8.5-6z"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinejoin="round"
			/>
			<circle cx="11" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.6" />
		</svg>
	);
}

function UsersIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 22 22" fill="none" className={className}>
			<circle cx="8" cy="7" r="3" stroke="currentColor" strokeWidth="1.6" />
			<path d="M3 18v-1a4 4 0 014-4h2a4 4 0 014 4v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
			<circle cx="15" cy="8" r="2" stroke="currentColor" strokeWidth="1.6" />
			<path d="M15 14a4 4 0 014 3v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
		</svg>
	);
}

function SettingsIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 22 22" fill="none" className={className}>
			<circle cx="11" cy="11" r="2" stroke="currentColor" strokeWidth="1.6" />
			<path
				d="M11 3c.5 0 .94.33 1.05.81l.5 2.19a.9.9 0 00.58.65l2.14.75a.9.9 0 00.98-.27l1.3-1.6a1.1 1.1 0 011.68 1.43l-1.33 1.96a.9.9 0 00-.08.86l1 2.02a.9.9 0 00-.44 1.2l-.75 2.14a.9.9 0 00-.65.58l-.5 2.19a1.1 1.1 0 01-2.1.24l-1-1.83a.9.9 0 00-.78-.46h-2.12a.9.9 0 00-.78.46l-1 1.83a1.1 1.1 0 01-2.1-.24l-.5-2.19a.9.9 0 00-.58-.65l-2.14-.75a.9.9 0 01-.44-1.2l1-2.02a.9.9 0 00-.08-.86L3.74 8.4a1.1 1.1 0 011.68-1.43l1.3 1.6a.9.9 0 00.98.27l2.14-.75a.9.9 0 00.58-.65l.5-2.19A1.1 1.1 0 0111 3z"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function LogoutIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 20 20" fill="none" className={className}>
			<path
				d="M7 17H5a2 2 0 01-2-2V5a2 2 0 012-2h2M14 14l4-4-4-4M18 10H8"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
