import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AuthStatus, VersionInfo } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
	Moon,
	Sun,
	Info,
	Key,
	Database,
	Smartphone,
	Cpu,
	Globe,
} from "lucide-react";

interface SettingsPageProps {
	theme: "light" | "dark";
	onThemeChange: (theme: "light" | "dark") => void;
}

export function SettingsPage({ theme, onThemeChange }: SettingsPageProps) {
	const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
	const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
	const [copiedText, setCopiedText] = useState<string | null>(null);

	useEffect(() => {
		void (async () => {
			try {
				const version = await invoke<VersionInfo>("get_version_info");
				setVersionInfo(version);
			} catch {
				// ignore
			}
		})();
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				const status = await invoke<AuthStatus>("get_auth_status");
				setAuthStatus(status);
			} catch {
				// ignore
			}
		})();
	}, []);

	const copyToClipboard = useCallback(async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedText(label);
			setTimeout(() => setCopiedText(null), 2000);
		} catch {
			// ignore
		}
	}, []);

	return (
		<div className="flex flex-col h-full bg-background">
			<div className="flex items-center justify-between px-6 py-4 border-b border-border">
				<div className="flex items-center gap-3">
					<Info className="w-5 h-5 text-primary" />
					<h1 className="text-lg font-semibold">Settings</h1>
				</div>
			</div>

			<ScrollArea className="flex-1">
				<div className="p-6 max-w-2xl space-y-8">
					{/* ── Appearance ── */}
					<section className="space-y-4">
						<div className="flex items-center gap-2">
							<Sun className="w-4 h-4 text-muted-foreground" />
							<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
								Appearance
							</h2>
						</div>
						<div className="rounded-xl border bg-card p-4 space-y-4">
							<div className="flex items-center justify-between">
								<div className="space-y-1">
									<div className="text-sm font-medium">Theme</div>
									<div className="text-xs text-muted-foreground">
										Switch between light and dark mode
									</div>
								</div>
								<div className="flex items-center gap-1.5 rounded-lg border p-1">
									<button
										type="button"
										onClick={() => onThemeChange("light")}
										className={cn(
											"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
											theme === "light"
												? "bg-primary text-primary-foreground"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										<Sun className="w-3.5 h-3.5" />
										Light
									</button>
									<button
										type="button"
										onClick={() => onThemeChange("dark")}
										className={cn(
											"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
											theme === "dark"
												? "bg-primary text-primary-foreground"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										<Moon className="w-3.5 h-3.5" />
										Dark
									</button>
								</div>
							</div>
						</div>
					</section>

					<Separator />

					{/* ── Provider Auth ── */}
					<section className="space-y-4">
						<div className="flex items-center gap-2">
							<Key className="w-4 h-4 text-muted-foreground" />
							<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
								Authentication
							</h2>
						</div>
						<div className="rounded-xl border bg-card p-4 space-y-3">
							<div className="flex items-center justify-between">
								<div className="space-y-1">
									<div className="text-sm font-medium">Provider Status</div>
									<div className="text-xs text-muted-foreground">
										{authStatus?.any_available
											? "At least one provider is authenticated"
											: "No providers configured yet"}
									</div>
								</div>
								<Badge
									variant={authStatus?.any_available ? "default" : "outline"}
									className={cn(
										"text-xs",
										authStatus?.any_available
											? "bg-emerald-500/10 text-emerald-600 border-emerald-200"
											: "",
									)}
								>
									{authStatus?.any_available ? "Available" : "Not configured"}
								</Badge>
							</div>
							{authStatus?.providers && authStatus.providers.length > 0 && (
								<div className="space-y-2">
									{authStatus.providers.map((provider) => (
										<div
											key={provider.id}
											className="flex items-center justify-between rounded-lg border bg-secondary/50 px-3 py-2"
										>
											<div className="flex items-center gap-2">
												<Globe className="w-3.5 h-3.5 text-muted-foreground" />
												<span className="text-sm">{provider.display_name}</span>
												<Badge
													variant={
														provider.configured ? "secondary" : "outline"
													}
													className="text-[10px]"
												>
													{provider.configured ? "configured" : provider.status}
												</Badge>
											</div>
											<span className="text-xs text-muted-foreground">
												{provider.method}
											</span>
										</div>
									))}
								</div>
							)}
						</div>
					</section>

					<Separator />

					{/* ── Version Info ── */}
					<section className="space-y-4">
						<div className="flex items-center gap-2">
							<Cpu className="w-4 h-4 text-muted-foreground" />
							<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
								Version
							</h2>
						</div>
						<div className="rounded-xl border bg-card p-4 space-y-3">
							{versionInfo ? (
								<div className="space-y-2 text-sm">
									{(
										[
											["Version", versionInfo.version],
											["Semver", versionInfo.semver],
											["Git Hash", versionInfo.git_hash],
											["Git Tag", versionInfo.git_tag],
											["Git Date", versionInfo.git_date],
											[
												"Build",
												versionInfo.release_build ? "Release" : "Debug",
											],
										] as const
									).map(([label, value]) => (
										<div
											key={label}
											className="flex items-center justify-between py-1"
										>
											<span className="text-muted-foreground">{label}</span>
											<button
												type="button"
												onClick={() => copyToClipboard(value, label)}
												className={cn(
													"font-mono text-xs px-2 py-0.5 rounded hover:bg-secondary transition-colors",
													copiedText === label
														? "text-emerald-500"
														: "text-foreground",
												)}
											>
												{value}
												{copiedText === label && (
													<span className="ml-1 text-emerald-500">✓</span>
												)}
											</button>
										</div>
									))}
									{versionInfo.update_semver && (
										<div className="flex items-center justify-between py-1">
											<span className="text-muted-foreground">
												Update Available
											</span>
											<Badge variant="default" className="text-xs">
												{versionInfo.update_semver}
											</Badge>
										</div>
									)}
								</div>
							) : (
								<div className="text-sm text-muted-foreground">Loading...</div>
							)}
						</div>
					</section>

					<Separator />

					{/* ── Memory ── */}
					<section className="space-y-4">
						<div className="flex items-center gap-2">
							<Database className="w-4 h-4 text-muted-foreground" />
							<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
								Memory
							</h2>
						</div>
						<div className="rounded-xl border bg-card p-4 space-y-3">
							<div className="text-xs text-muted-foreground">
								Memory is managed automatically by jcode. Use the Memory page to
								browse, search, import, and export memories.
							</div>
							<Button
								variant="outline"
								size="sm"
								className="text-xs"
								onClick={async () => {
									try {
										const stats = await invoke<{
											project_count: number;
											global_count: number;
											total: number;
											unique_tags: number;
										}>("get_memory_stats");
										// Show stats via a simple UI update
										alert(
											`Total memories: ${stats.total}\nProject: ${stats.project_count}\nGlobal: ${stats.global_count}\nUnique tags: ${stats.unique_tags}`,
										);
									} catch (e) {
										console.error(e);
									}
								}}
							>
								Show Memory Stats
							</Button>
						</div>
					</section>

					<Separator />

					{/* ── Device Pairing ── */}
					<section className="space-y-4">
						<div className="flex items-center gap-2">
							<Smartphone className="w-4 h-4 text-muted-foreground" />
							<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
								Paired Devices
							</h2>
						</div>
						<div className="rounded-xl border bg-card p-4 space-y-3">
							<DeviceManager />
						</div>
					</section>

					<div className="h-8" />
				</div>
			</ScrollArea>
		</div>
	);
}

function DeviceManager() {
	const [pairedDevices, setPairedDevices] = useState<
		Array<{ id: string; name: string; paired_at: string; last_seen: string }>
	>([]);
	const [pairingCode, setPairingCode] = useState<string | null>(null);
	const [message, setMessage] = useState<{
		text: string;
		type: "ok" | "error";
	} | null>(null);

	const refreshDevices = useCallback(async () => {
		try {
			const result = await invoke<{
				devices: Array<{
					id: string;
					name: string;
					paired_at: string;
					last_seen: string;
				}>;
			}>("list_paired_devices");
			setPairedDevices(result.devices);
		} catch {
			// ignore
		}
	}, []);

	const generateCode = useCallback(async () => {
		try {
			const code = await invoke<string>("generate_pairing_code");
			setPairingCode(code);
			setMessage({ text: "Pairing code generated", type: "ok" });
		} catch (e) {
			setMessage({ text: String(e), type: "error" });
		}
	}, []);

	const revokeDevice = useCallback(
		async (deviceId: string) => {
			try {
				await invoke("revoke_device", { deviceId });
				setMessage({ text: "Device revoked", type: "ok" });
				void refreshDevices();
			} catch (e) {
				setMessage({ text: String(e), type: "error" });
			}
		},
		[refreshDevices],
	);

	useEffect(() => {
		void refreshDevices();
	}, [refreshDevices]);

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<div className="text-xs text-muted-foreground">
					{pairedDevices.length > 0
						? `${pairedDevices.length} paired device(s)`
						: "No devices paired"}
				</div>
				<Button
					variant="outline"
					size="sm"
					className="text-xs"
					onClick={generateCode}
				>
					Generate Pairing Code
				</Button>
			</div>

			{pairingCode && (
				<div className="rounded-lg border bg-primary/5 px-3 py-2 space-y-1">
					<div className="text-xs text-muted-foreground">Pairing Code</div>
					<div className="font-mono text-sm font-bold tracking-wider select-all">
						{pairingCode}
					</div>
					<div className="text-[10px] text-muted-foreground">
						Enter this code on your mobile device
					</div>
				</div>
			)}

			{message && (
				<div
					className={cn(
						"text-xs px-2 py-1 rounded",
						message.type === "error"
							? "bg-red-500/10 text-red-600"
							: "bg-emerald-500/10 text-emerald-600",
					)}
				>
					{message.text}
				</div>
			)}

			{pairedDevices.length > 0 && (
				<div className="space-y-2">
					{pairedDevices.map((device) => (
						<div
							key={device.id}
							className="flex items-center justify-between rounded-lg border bg-secondary/50 px-3 py-2"
						>
							<div>
								<div className="text-sm font-medium">{device.name}</div>
								<div className="text-[10px] text-muted-foreground font-mono">
									{device.id.slice(0, 12)}…
								</div>
							</div>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10"
								onClick={() => revokeDevice(device.id)}
							>
								Revoke
							</Button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
