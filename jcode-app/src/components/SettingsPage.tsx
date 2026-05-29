import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AuthStatus, VersionInfo } from "@/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Moon, Sun, Key, Cpu } from "lucide-react";

interface SettingsPageProps {
	theme: "light" | "dark";
	onThemeChange: (theme: "light" | "dark") => void;
}

export function SettingsPage({ theme, onThemeChange }: SettingsPageProps) {
	const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
	const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
	const [copiedText, setCopiedText] = useState<string | null>(null);

	useEffect(() => {
		void invoke<VersionInfo>("get_version_info")
			.then(setVersionInfo)
			.catch(() => {});
	}, []);

	useEffect(() => {
		void invoke<AuthStatus>("get_auth_status")
			.then(setAuthStatus)
			.catch(() => {});
	}, []);

	const copyToClipboard = useCallback(async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedText(label);
			setTimeout(() => setCopiedText(null), 2000);
		} catch {
			/* ignore */
		}
	}, []);

	return (
		<div className="flex flex-col h-full bg-background">
			<div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
				<div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
					<svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
						<path d="M8 1.5c.35 0 .65.23.73.57l.5 2.19a.9.9 0 00.58.65l2.14.75c.42.15.6.62.44 1.05l-1 2.02a.9.9 0 00.08.86l1.33 1.96c.32.47.17 1.1-.33 1.37l-1.73 1a.9.9 0 01-.98-.27l-1.3-1.6a.9.9 0 00-.98-.27l-2.14.75a.9.9 0 01-1.05-.44l-1-2.02a.9.9 0 01.44-1.2l2.14-.75a.9.9 0 00.58-.65l.5-2.19A.75.75 0 018 1.5z" />
					</svg>
				</div>
				<div>
					<h1 className="text-[15px] font-semibold text-foreground">
						Settings
					</h1>
					<p className="text-[12px] text-muted-foreground">
						Appearance, authentication, version info
					</p>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto min-h-0">
				<div className="p-6 max-w-xl mx-auto space-y-6">
					{/* Theme */}
					<SettingsCard
						icon={<Sun className="w-4 h-4" />}
						title="Theme"
						action={
							<div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-muted/30">
								<button
									type="button"
									onClick={() => onThemeChange("light")}
									className={cn(
										"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-150",
										theme === "light"
											? "bg-card text-foreground shadow-sm"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									<Sun className="w-3.5 h-3.5" /> Light
								</button>
								<button
									type="button"
									onClick={() => onThemeChange("dark")}
									className={cn(
										"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-150",
										theme === "dark"
											? "bg-card text-foreground shadow-sm"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									<Moon className="w-3.5 h-3.5" /> Dark
								</button>
							</div>
						}
					>
						<p className="text-[12px] text-muted-foreground">
							Switch between light and dark mode
						</p>
					</SettingsCard>

					{/* Auth */}
					<SettingsCard
						icon={<Key className="w-4 h-4" />}
						title="Authentication"
						action={
							<Badge
								variant={authStatus?.any_available ? "default" : "outline"}
								className="text-[10px]"
							>
								{authStatus?.any_available ? "Available" : "Not configured"}
							</Badge>
						}
					>
						<div className="text-[12px] text-muted-foreground mb-3">
							{authStatus?.any_available
								? "At least one provider is authenticated"
								: "No providers configured yet"}
						</div>
						{authStatus?.providers && authStatus.providers.length > 0 && (
							<div className="space-y-1.5">
								{authStatus.providers.map((p) => (
									<div
										key={p.id}
										className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2"
									>
										<div className="flex items-center gap-2">
											<span className="text-[13px] font-medium text-foreground">
												{p.display_name}
											</span>
											<Badge
												variant={p.configured ? "secondary" : "outline"}
												className="text-[9px] h-[18px]"
											>
												{p.configured ? "configured" : p.status}
											</Badge>
										</div>
										<span className="text-[11px] text-muted-foreground">
											{p.method}
										</span>
									</div>
								))}
							</div>
						)}
					</SettingsCard>

					{/* Version */}
					<SettingsCard icon={<Cpu className="w-4 h-4" />} title="Version">
						{versionInfo ? (
							<div className="space-y-1.5">
								{(
									[
										["Version", versionInfo.version],
										["Semver", versionInfo.semver],
										["Git Hash", versionInfo.git_hash],
										["Git Tag", versionInfo.git_tag],
										["Git Date", versionInfo.git_date],
										["Build", versionInfo.release_build ? "Release" : "Debug"],
									] as const
								).map(([label, value]) => (
									<div
										key={label}
										className="flex items-center justify-between py-0.5"
									>
										<span className="text-[12px] text-muted-foreground">
											{label}
										</span>
										<button
											type="button"
											onClick={() => copyToClipboard(value, label)}
											className={cn(
												"font-mono text-[12px] px-2 py-0.5 rounded-md hover:bg-muted transition-colors",
												copiedText === label
													? "text-emerald-500"
													: "text-foreground",
											)}
										>
											{value}
											{copiedText === label && (
												<span className="ml-1.5 text-emerald-500">✓</span>
											)}
										</button>
									</div>
								))}
							</div>
						) : (
							<div className="text-[13px] text-muted-foreground animate-pulse">
								Loading…
							</div>
						)}
					</SettingsCard>

					<div className="h-8" />
				</div>
				</div>
			</div>
	);
}

function SettingsCard({
	icon,
	title,
	action,
	children,
}: {
	icon: React.ReactNode;
	title: string;
	action?: React.ReactNode;
	children?: React.ReactNode;
}) {
	return (
		<div className="rounded-xl border border-border bg-card overflow-hidden">
			<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
				<div className="flex items-center gap-2.5">
					<span className="text-muted-foreground shrink-0">{icon}</span>
					<h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
				</div>
				{action}
			</div>
			{children && <div className="px-4 py-3">{children}</div>}
		</div>
	);
}
