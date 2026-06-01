import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
	ModelRoute,
	ProviderCatalogEntry,
	ProviderAuthPrompt,
	AuthDoctorReport,
	ExternalAuthCandidate,
	ExternalAuthCandidatesResult,
	CursorAuthStatus,
	ProviderDoctorReport,
	ProviderConnectionTest,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
	Key,
	Globe,
	CheckCircle2,
	AlertCircle,
	ExternalLink,
	RefreshCw,
	ShieldCheck,
	Plus,
	Stethoscope,
	Loader2,
	Wifi,
	Bot,
	Cloud,
	BarChart3,
} from "lucide-react";
import type { UsageInfo } from "@/types";

interface ProviderConfigPageProps {
	onAuthStatusChange?: () => void;
	onGetUsageInfo?: () => Promise<UsageInfo>;
}

/** Provider branding icons */
function ProviderIcon({
	providerKey,
	className,
}: {
	providerKey: string;
	className?: string;
}) {
	const key = providerKey.toLowerCase();
	if (key.includes("openai")) {
		return (
			<svg viewBox="0 0 24 24" fill="currentColor" className={className}>
				<path d="M22.281 9.821l-2.174-.905a6.515 6.515 0 00-.514-1.242l.667-2.132a.525.525 0 00-.23-.624l-2.011-1.21a.518.518 0 00-.652.134l-1.555 1.76a6.395 6.395 0 00-1.338-.18l-1.054-2.032a.5.5 0 00-.455-.286h-2.33a.5.5 0 00-.455.286l-1.054 2.032a6.395 6.395 0 00-1.338.18L7.44 3.75a.518.518 0 00-.652-.134L4.777 4.826a.525.525 0 00-.23.624l.667 2.132a6.515 6.515 0 00-.514 1.242l-2.174.905a.525.525 0 00-.34.528l.173 2.358a.518.518 0 00.426.47l2.249.375c.115.44.283.862.502 1.257l-1.11 1.973a.5.5 0 00.044.553l1.605 1.878a.5.5 0 00.572.158l2.068-.7a6.56 6.56 0 001.286.664l.508 2.116a.5.5 0 00.487.387h2.33a.5.5 0 00.487-.387l.508-2.116a6.56 6.56 0 001.286-.664l2.068.7a.5.5 0 00.572-.158l1.605-1.878a.5.5 0 00.044-.553l-1.11-1.973c.219-.395.387-.817.502-1.257l2.249-.375a.518.518 0 00.426-.47l.173-2.358a.525.525 0 00-.34-.528zM12 15.6a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2z" />
			</svg>
		);
	}
	if (key.includes("anthropic") || key.includes("claude")) {
		return (
			<svg viewBox="0 0 24 24" fill="currentColor" className={className}>
				<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-4-4 1.41-1.41L11 14.17l5.59-5.59L18 10l-7 7z" />
			</svg>
		);
	}
	if (key.includes("gemini") || key.includes("google")) {
		return (
			<svg viewBox="0 0 24 24" fill="currentColor" className={className}>
				<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
			</svg>
		);
	}
	if (key.includes("openrouter")) {
		return <Globe className={className} />;
	}
	if (key.includes("bedrock") || key.includes("aws")) {
		return <Cloud className={className} />;
	}
	if (key.includes("ollama")) {
		return <Bot className={className} />;
	}
	if (key.includes("azure")) {
		return <Cloud className={className} />;
	}
	if (key.includes("copilot") || key.includes("github")) {
		return (
			<svg viewBox="0 0 24 24" fill="currentColor" className={className}>
				<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
			</svg>
		);
	}
	return <Globe className={className} />;
}

export function ProviderConfigPage({
	onAuthStatusChange,
	onGetUsageInfo,
}: ProviderConfigPageProps) {
	const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
	const [modelRoutes, setModelRoutes] = useState<ModelRoute[]>([]);
	const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
	const [authPrompt, setAuthPrompt] = useState<ProviderAuthPrompt | null>(null);
	const [authInput, setAuthInput] = useState("");
	const [authInputKind, setAuthInputKind] = useState<string>("");
	const [authBusy, setAuthBusy] = useState(false);
	const [authMessage, setAuthMessage] = useState<{
		text: string;
		type: "ok" | "error";
	} | null>(null);
	const [doctorReport, setDoctorReport] = useState<AuthDoctorReport | null>(
		null,
	);
	const [doctorBusy, setDoctorBusy] = useState(false);
	const [addProfileOpen, setAddProfileOpen] = useState(false);
	const [profileForm, setProfileForm] = useState({
		name: "",
		base_url: "",
		model: "",
		api_key: "",
		auth: "bearer",
	});
	const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null);
	const [usageLoading, setUsageLoading] = useState(false);
	const [externalCandidates, setExternalCandidates] = useState<
		ExternalAuthCandidate[]
	>([]);
	const [cursorAuthStatus, setCursorAuthStatus] =
		useState<CursorAuthStatus | null>(null);
	const [importBusy, setImportBusy] = useState<number | null>(null);
	const [providerDoctorReport, setProviderDoctorReport] =
		useState<ProviderDoctorReport | null>(null);
	const [providerDoctorBusy, setProviderDoctorBusy] = useState<string | null>(
		null,
	);
	const [connectionTest, setConnectionTest] =
		useState<ProviderConnectionTest | null>(null);
	const [connectionTestBusy, setConnectionTestBusy] = useState<string | null>(
		null,
	);

	const refresh = useCallback(async () => {
		try {
			const result = await invoke<{
				routes: ModelRoute[];
				providers: ProviderCatalogEntry[];
				current: string;
			}>("get_models");
			setModelRoutes(result.routes);
			setProviders(result.providers);
		} catch {
			/* ignore */
		}
	}, []);

	const loadUsage = useCallback(async () => {
		if (!onGetUsageInfo) return;
		setUsageLoading(true);
		const info = await onGetUsageInfo();
		setUsageInfo(info);
		setUsageLoading(false);
	}, [onGetUsageInfo]);

	useEffect(() => {
		void refresh();
		void loadUsage();
		void loadExternalAuth();
	}, [refresh, loadUsage]);

	const loadExternalAuth = useCallback(async () => {
		try {
			const result = await invoke<ExternalAuthCandidatesResult>(
				"get_external_auth_candidates",
			);
			setExternalCandidates(result.candidates);
		} catch {
			/* ignore */
		}
		try {
			const status = await invoke<CursorAuthStatus>("check_cursor_auth_status");
			setCursorAuthStatus(status);
		} catch {
			/* ignore */
		}
	}, []);

	const importExternalAuth = useCallback(
		async (index: number) => {
			setImportBusy(index);
			try {
				const result = await invoke<{
					imported: boolean;
					provider: string;
					detail: string;
				}>("approve_external_auth_candidate", { index });
				setAuthMessage({
					text: `Imported ${result.provider}: ${result.detail}`,
					type: "ok",
				});
				void refresh();
				void loadExternalAuth();
			} catch (e) {
				setAuthMessage({ text: String(e), type: "error" });
			} finally {
				setImportBusy(null);
			}
		},
		[refresh],
	);

	const testConnection = useCallback(async (providerId: string) => {
		setConnectionTestBusy(providerId);
		setConnectionTest(null);
		try {
			const result = await invoke<ProviderConnectionTest>(
				"test_provider_connection",
				{
					providerId,
				},
			);
			setConnectionTest(result);
		} catch (e) {
			setAuthMessage({ text: String(e), type: "error" });
		} finally {
			setConnectionTestBusy(null);
		}
	}, []);

	const runProviderDoctor = useCallback(
		async (providerId: string, model?: string) => {
			setProviderDoctorBusy(providerId);
			setProviderDoctorReport(null);
			try {
				const report = await invoke<ProviderDoctorReport>(
					"run_provider_doctor",
					{
						providerId,
						model: model || null,
						tier: "catalog",
					},
				);
				setProviderDoctorReport(report);
			} catch (e) {
				setAuthMessage({ text: String(e), type: "error" });
			} finally {
				setProviderDoctorBusy(null);
			}
		},
		[],
	);

	const startAuthFlow = useCallback(async (providerId: string) => {
		setAuthBusy(true);
		setAuthPrompt(null);
		setAuthMessage(null);
		try {
			const prompt = await invoke<ProviderAuthPrompt>(
				"start_provider_auth_flow",
				{ providerId },
			);
			setAuthPrompt(prompt);
			setSelectedProvider(providerId);
			setAuthInputKind(prompt.input_kind);
		} catch (e) {
			setAuthMessage({ text: String(e), type: "error" });
		} finally {
			setAuthBusy(false);
		}
	}, []);

	const completeAuthFlow = useCallback(async () => {
		if (!selectedProvider || !authPrompt) return;
		setAuthBusy(true);
		setAuthMessage(null);
		try {
			const result = await invoke<{ status: string; provider: string }>(
				"complete_provider_auth_flow",
				{
					providerId: selectedProvider,
					inputKind: authInputKind,
					input: authInput || null,
				},
			);
			setAuthMessage({ text: `Authenticated: ${result.provider}`, type: "ok" });
			setAuthPrompt(null);
			setAuthInput("");
			onAuthStatusChange?.();
			void refresh();
		} catch (e) {
			setAuthMessage({ text: String(e), type: "error" });
		} finally {
			setAuthBusy(false);
		}
	}, [
		selectedProvider,
		authPrompt,
		authInputKind,
		authInput,
		onAuthStatusChange,
		refresh,
	]);

	const saveApiKey = useCallback(
		async (providerId: string) => {
			setAuthBusy(true);
			setAuthMessage(null);
			try {
				await invoke("save_provider_api_key", {
					providerId,
					apiKey: authInput,
					region: null,
					apiBase: null,
				});
				setAuthMessage({ text: `API key saved for ${providerId}`, type: "ok" });
				setAuthInput("");
				onAuthStatusChange?.();
				void refresh();
			} catch (e) {
				setAuthMessage({ text: String(e), type: "error" });
			} finally {
				setAuthBusy(false);
			}
		},
		[authInput, onAuthStatusChange, refresh],
	);

	const runDoctor = useCallback(async () => {
		setDoctorBusy(true);
		try {
			setDoctorReport(await invoke<AuthDoctorReport>("run_auth_doctor"));
		} catch (e) {
			setAuthMessage({ text: String(e), type: "error" });
		} finally {
			setDoctorBusy(false);
		}
	}, []);

	const addProfile = useCallback(async () => {
		setAuthBusy(true);
		setAuthMessage(null);
		try {
			const result = await invoke<{
				profile: string;
				config_path: string;
				api_base: string;
				model: string;
				api_key_stored: boolean;
				auth: string;
				default_set: boolean;
			}>("add_provider_profile", profileForm);
			setAuthMessage({ text: `Profile "${result.profile}" added`, type: "ok" });
			setAddProfileOpen(false);
			setProfileForm({
				name: "",
				base_url: "",
				model: "",
				api_key: "",
				auth: "bearer",
			});
			void refresh();
		} catch (e) {
			setAuthMessage({ text: String(e), type: "error" });
		} finally {
			setAuthBusy(false);
		}
	}, [profileForm, refresh]);

	const configuredProviders = providers.filter((p) => p.configured);
	const unconfiguredProviders = providers.filter((p) => !p.configured);

	return (
		<div className="flex flex-col h-full bg-background">
			{/* Header */}
			<div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
				<div className="flex items-center gap-3">
					<div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
						<Wifi className="w-4 h-4" />
					</div>
					<div>
						<h1 className="text-[15px] font-semibold text-foreground">
							Providers
						</h1>
						<p className="text-[12px] text-muted-foreground">
							{providers.length} providers · {modelRoutes.length} model routes
						</p>
					</div>
				</div>
				<div className="flex items-center gap-1.5">
					<Button
						variant="outline"
						size="sm"
						className="text-[11px] h-8 gap-1.5"
						onClick={runDoctor}
						disabled={doctorBusy}
					>
						{doctorBusy ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : (
							<Stethoscope className="w-3.5 h-3.5" />
						)}
						Doctor
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="text-[11px] h-8 gap-1.5"
						onClick={() => setAddProfileOpen(true)}
					>
						<Plus className="w-3.5 h-3.5" /> Profile
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-8 w-8 p-0"
						onClick={refresh}
					>
						<RefreshCw className="w-3.5 h-3.5" />
					</Button>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto min-h-0">
				<div className="p-6 space-y-5">
					{/* Message */}
					{authMessage && (
						<div
							className={cn(
								"flex items-center gap-2 px-4 py-3 rounded-xl border text-[13px]",
								authMessage.type === "error"
									? "bg-destructive/5 border-destructive/20 text-destructive"
									: "bg-emerald-500/5 border-emerald-500/20 text-emerald-600",
							)}
						>
							<AlertCircle className="w-4 h-4 shrink-0" />
							{authMessage.text}
						</div>
					)}

					{/* Auth Doctor */}
					{doctorReport && (
						<div className="rounded-xl border border-border bg-card overflow-hidden">
							<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
								<div className="flex items-center gap-2">
									<ShieldCheck className="w-4 h-4 text-emerald-500" />
									<span className="text-[14px] font-semibold text-foreground">
										Auth Doctor
									</span>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-[11px] h-7"
									onClick={() => setDoctorReport(null)}
								>
									Dismiss
								</Button>
							</div>
							<div className="p-4 space-y-3">
								<div className="flex items-center gap-2 text-[13px]">
									<span className="text-muted-foreground">
										{doctorReport.provider_count} providers checked
									</span>
									{doctorReport.needs_attention_count > 0 && (
										<Badge variant="destructive" className="text-[9px]">
											{doctorReport.needs_attention_count} need attention
										</Badge>
									)}
								</div>
								{doctorReport.providers
									.filter((p) => p.needs_attention)
									.map((provider) => (
										<div
											key={provider.id}
											className="rounded-lg border border-border bg-muted/20 p-3 space-y-2"
										>
											<div className="flex items-center justify-between">
												<div className="flex items-center gap-2">
													<AlertCircle className="w-4 h-4 text-amber-500" />
													<span className="text-[13px] font-medium text-foreground">
														{provider.display_name}
													</span>
												</div>
												<Badge variant="outline" className="text-[9px]">
													{provider.status}
												</Badge>
											</div>
											{provider.diagnostics.length > 0 && (
												<ul className="space-y-1">
													{provider.diagnostics.map((d, i) => (
														<li
															key={i}
															className="text-[12px] text-muted-foreground flex items-start gap-2"
														>
															<span className="mt-1.5 w-1 h-1 rounded-full bg-muted-foreground shrink-0" />
															{d}
														</li>
													))}
												</ul>
											)}
										</div>
									))}
							</div>
						</div>
					)}

					{/* Auth Flow */}
					{authPrompt && (
						<div className="rounded-xl border border-border bg-card overflow-hidden">
							<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
								<span className="text-[14px] font-semibold text-foreground">
									Configure {selectedProvider}
								</span>
								<Button
									variant="ghost"
									size="sm"
									className="text-[11px] h-7"
									onClick={() => {
										setAuthPrompt(null);
										if (authInputKind !== "complete") setAuthInput("");
									}}
								>
									Cancel
								</Button>
							</div>
							<div className="p-4 space-y-4">
								{authPrompt.status === "pending" && (
									<>
										{authPrompt.auth_url && (
											<div className="space-y-2">
												<div className="text-[12px] text-muted-foreground">
													Open URL to authorize:
												</div>
												<div className="flex items-center gap-2">
													<code className="flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px] break-all font-mono select-all">
														{authPrompt.auth_url}
													</code>
													<Button
														variant="outline"
														size="sm"
														className="text-[11px] shrink-0"
														onClick={() =>
															navigator.clipboard.writeText(authPrompt.auth_url)
														}
													>
														Copy
													</Button>
												</div>
											</div>
										)}
										{authPrompt.user_code && (
											<div className="space-y-1">
												<div className="text-[12px] text-muted-foreground">
													Device code:
												</div>
												<div className="font-mono text-lg font-bold tracking-wider text-foreground select-all">
													{authPrompt.user_code}
												</div>
											</div>
										)}
										{authInputKind !== "complete" && (
											<div className="space-y-2">
												<div className="text-[12px] text-muted-foreground">
													{authInputKind === "callback_url"
														? "Callback URL:"
														: authInputKind === "auth_code"
															? "Authorization code:"
															: "Callback URL or code:"}
												</div>
												<div className="flex gap-2">
													<Input
														value={authInput}
														onChange={(e) => setAuthInput(e.target.value)}
														placeholder={
															authInputKind === "callback_url"
																? "https://…"
																: "…"
														}
														className="font-mono text-[12px]"
													/>
													<Button
														size="sm"
														className="text-[11px]"
														onClick={completeAuthFlow}
														disabled={authBusy || !authInput.trim()}
													>
														{authBusy && (
															<Loader2 className="w-3 h-3 animate-spin mr-1" />
														)}
														Submit
													</Button>
												</div>
											</div>
										)}
										{authInputKind === "complete" && (
											<Button
												size="sm"
												className="text-[11px]"
												onClick={completeAuthFlow}
												disabled={authBusy}
											>
												{authBusy && (
													<Loader2 className="w-3 h-3 animate-spin mr-1" />
												)}
												Complete Authentication
											</Button>
										)}
									</>
								)}
							</div>
						</div>
					)}

					{/* Add Profile */}
					{addProfileOpen && (
						<div className="rounded-xl border border-border bg-card overflow-hidden">
							<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
								<span className="text-[14px] font-semibold text-foreground">
									Custom Profile
								</span>
								<Button
									variant="ghost"
									size="sm"
									className="text-[11px] h-7"
									onClick={() => setAddProfileOpen(false)}
								>
									Cancel
								</Button>
							</div>
							<div className="p-4 space-y-3">
								<div className="grid grid-cols-2 gap-3">
									<div className="space-y-1">
										<div className="text-[11px] text-muted-foreground font-medium">
											Name
										</div>
										<Input
											value={profileForm.name}
											onChange={(e) =>
												setProfileForm((f) => ({ ...f, name: e.target.value }))
											}
											placeholder="my-provider"
											className="font-mono text-[12px]"
										/>
									</div>
									<div className="space-y-1">
										<div className="text-[11px] text-muted-foreground font-medium">
											Model
										</div>
										<Input
											value={profileForm.model}
											onChange={(e) =>
												setProfileForm((f) => ({ ...f, model: e.target.value }))
											}
											placeholder="gpt-4o"
											className="font-mono text-[12px]"
										/>
									</div>
								</div>
								<div className="space-y-1">
									<div className="text-[11px] text-muted-foreground font-medium">
										Base URL
									</div>
									<Input
										value={profileForm.base_url}
										onChange={(e) =>
											setProfileForm((f) => ({
												...f,
												base_url: e.target.value,
											}))
										}
										placeholder="https://api.openai.com/v1"
										className="font-mono text-[12px]"
									/>
								</div>
								<div className="space-y-1">
									<div className="text-[11px] text-muted-foreground font-medium">
										API Key{" "}
										<span className="text-muted-foreground/50">(optional)</span>
									</div>
									<Input
										type="password"
										value={profileForm.api_key}
										onChange={(e) =>
											setProfileForm((f) => ({ ...f, api_key: e.target.value }))
										}
										placeholder="sk-…"
										className="font-mono text-[12px]"
									/>
								</div>
								<Button
									size="sm"
									className="text-[11px]"
									onClick={addProfile}
									disabled={
										authBusy ||
										!profileForm.name ||
										!profileForm.base_url ||
										!profileForm.model
									}
								>
									{authBusy && (
										<Loader2 className="w-3 h-3 animate-spin mr-1" />
									)}
									Add Profile
								</Button>
							</div>
						</div>
					)}

					{/* Configured */}
					<div className="rounded-xl border border-border bg-card overflow-hidden">
						<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
							<div className="flex items-center gap-2">
								<CheckCircle2 className="w-4 h-4 text-emerald-500" />
								<span className="text-[14px] font-semibold text-foreground">
									Configured
								</span>
							</div>
							<Badge variant="secondary" className="text-[9px]">
								{configuredProviders.length}
							</Badge>
						</div>
						<div className="p-4">
							{configuredProviders.length === 0 ? (
								<div className="text-[13px] text-muted-foreground text-center py-6">
									No providers configured yet.
								</div>
							) : (
								<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
									{configuredProviders.map((p) => (
										<div
											key={p.provider_key}
											className={cn(
												"flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5",
												p.is_current_provider && "ring-1 ring-primary/30",
											)}
										>
											<div className="flex items-center gap-2.5">
												<Key className="w-4 h-4 text-emerald-500 shrink-0" />
												<div className="min-w-0">
													<div className="text-[13px] font-medium text-foreground truncate">
														{p.display_name}
													</div>
													<div className="text-[11px] text-muted-foreground truncate">
														{p.method_detail}
													</div>
												</div>
											</div>
											<div className="flex items-center gap-2">
												<Badge variant="secondary" className="text-[9px]">
													{p.route_count} routes
												</Badge>
												{p.is_current_provider && (
													<Badge className="text-[9px]">current</Badge>
												)}
											</div>
											<Button
												variant="outline"
												size="sm"
												className="text-[10px] h-6 gap-1"
												onClick={() => runProviderDoctor(p.provider_key)}
												disabled={providerDoctorBusy !== null}
											>
												{providerDoctorBusy === p.provider_key ? (
													<Loader2 className="w-3 h-3 animate-spin" />
												) : (
													<Stethoscope className="w-3 h-3" />
												)}
												Diagnose
											</Button>
											<Button
												variant="outline"
												size="sm"
												className="text-[10px] h-6 gap-1"
												onClick={() => testConnection(p.provider_key)}
												disabled={connectionTestBusy !== null}
											>
												{connectionTestBusy === p.provider_key ? (
													<Loader2 className="w-3 h-3 animate-spin" />
												) : (
													<Wifi className="w-3 h-3" />
												)}
												Test
											</Button>
										</div>
									))}
								</div>
							)}
						</div>
					</div>

					{/* Provider Doctor Results */}
					{providerDoctorReport && (
						<div className="rounded-xl border border-border bg-card overflow-hidden">
							<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
								<div className="flex items-center gap-2">
									<Stethoscope className="w-4 h-4 text-primary" />
									<span className="text-[14px] font-semibold text-foreground">
										Provider Doctor: {providerDoctorReport.provider_label}
									</span>
									<Badge
										variant={
											providerDoctorReport.tier_passed
												? "default"
												: "destructive"
										}
										className="text-[9px]"
									>
										{providerDoctorReport.tier_passed ? "PASSED" : "FAILED"}
									</Badge>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-[11px] h-7"
									onClick={() => setProviderDoctorReport(null)}
								>
									Dismiss
								</Button>
							</div>
							<div className="p-4 space-y-2">
								<div className="text-[12px] text-muted-foreground mb-3">
									Model: {providerDoctorReport.model} · Tier:{" "}
									{providerDoctorReport.tier}
								</div>
								{providerDoctorReport.checks.map((check, i) => (
									<div
										key={i}
										className={cn(
											"flex items-start gap-2 p-2 rounded-lg text-[12px]",
											check.status === "passed" && "bg-emerald-500/5",
											check.status === "failed" && "bg-destructive/5",
											check.status === "skipped" && "bg-muted/50",
										)}
									>
										<span className="mt-0.5">
											{check.status === "passed" && "✓"}
											{check.status === "failed" && "✗"}
											{check.status === "skipped" && "⊘"}
											{check.status === "blocked" && "⊘"}
											{check.status === "not_run" && "○"}
										</span>
										<div className="min-w-0">
											<div className="font-medium text-foreground">
												{check.label}
											</div>
											{check.detail && (
												<div className="text-muted-foreground truncate">
													{check.detail}
												</div>
											)}
										</div>
									</div>
								))}
								{providerDoctorReport.spend_summary && (
									<div className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border">
										{providerDoctorReport.spend_summary}
									</div>
								)}
							</div>
						</div>
					)}

					{/* Connection Test Results */}
					{connectionTest && (
						<div className="rounded-xl border border-border bg-card overflow-hidden">
							<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
								<div className="flex items-center gap-2">
									<Wifi className="w-4 h-4 text-emerald-500" />
									<span className="text-[14px] font-semibold text-foreground">
										Connection Test: {connectionTest.provider_id}
									</span>
									<Badge
										variant={connectionTest.success ? "default" : "destructive"}
										className="text-[9px]"
									>
										{connectionTest.success ? "OK" : "FAILED"}
									</Badge>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-[11px] h-7"
									onClick={() => setConnectionTest(null)}
								>
									Dismiss
								</Button>
							</div>
							<div className="p-4 space-y-2">
								<div className="text-[12px] text-muted-foreground">
									{connectionTest.model_count} models available ·{" "}
									{connectionTest.elapsed_ms}ms
								</div>
								{connectionTest.models.length > 0 && (
									<div className="flex flex-wrap gap-1.5">
										{connectionTest.models.map((model) => (
											<Badge
												key={model}
												variant="secondary"
												className="text-[10px]"
											>
												{model}
											</Badge>
										))}
										{connectionTest.model_count > 10 && (
											<Badge variant="outline" className="text-[10px]">
												+{connectionTest.model_count - 10} more
											</Badge>
										)}
									</div>
								)}
							</div>
						</div>
					)}

					{/* Available */}
					<div className="rounded-xl border border-border bg-card overflow-hidden">
						<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
							<div className="flex items-center gap-2">
								<Globe className="w-4 h-4 text-primary" />
								<span className="text-[14px] font-semibold text-foreground">
									Available
								</span>
							</div>
						</div>
						<div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
							{unconfiguredProviders.map((provider) => (
								<div
									key={provider.provider_key}
									className="rounded-lg border border-border p-3 space-y-3"
								>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<ProviderIcon
												providerKey={provider.provider_key}
												className="w-4 h-4 shrink-0"
											/>
											<div>
												<div className="text-[13px] font-medium text-foreground">
													{provider.display_name}
												</div>
												<div className="text-[11px] text-muted-foreground">
													{provider.method_detail}
												</div>
											</div>
										</div>
										<Badge
											variant="outline"
											className={cn(
												"text-[9px]",
												provider.status === "expired" &&
													"text-amber-500 border-amber-500/30",
											)}
										>
											{provider.status}
										</Badge>
									</div>
									{provider.options.length > 0 && (
										<div className="flex flex-wrap gap-1.5">
											{provider.options.map((option) => (
												<Button
													key={option.provider_id}
													variant="outline"
													size="sm"
													className={cn(
														"text-[11px] gap-1.5 h-7",
														option.kind === "oauth"
															? "text-primary"
															: option.kind === "device_code"
																? "text-amber-600"
																: "",
													)}
													onClick={() => {
														if (option.kind === "api_key") {
															setSelectedProvider(option.provider_id);
															setAuthInputKind("api_key");
															setAuthPrompt(null);
														} else void startAuthFlow(option.provider_id);
													}}
												>
													{option.kind === "oauth"
														? "OAuth"
														: option.kind === "device_code"
															? "Device"
															: "API Key"}
													<ExternalLink className="w-3 h-3" />
												</Button>
											))}
										</div>
									)}
									{/* Inline API key */}
									{selectedProvider ===
										provider.options.find((o) => o.kind === "api_key")
											?.provider_id &&
										authInputKind === "api_key" &&
										!authPrompt && (
											<div className="flex gap-2">
												<Input
													type="password"
													value={authInput}
													onChange={(e) => setAuthInput(e.target.value)}
													placeholder="Paste API key"
													className="flex-1 font-mono text-[12px]"
												/>
												<Button
													size="sm"
													className="text-[11px]"
													onClick={() =>
														saveApiKey(
															provider.options.find((o) => o.kind === "api_key")
																?.provider_id || provider.provider_key,
														)
													}
													disabled={authBusy || !authInput.trim()}
												>
													Save
												</Button>
											</div>
										)}
								</div>
							))}
						</div>
					</div>

					{/* External Auth Import */}
					{externalCandidates.length > 0 && (
						<div className="rounded-xl border border-border bg-card overflow-hidden">
							<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
								<div className="flex items-center gap-2">
									<ShieldCheck className="w-4 h-4 text-emerald-500" />
									<span className="text-[14px] font-semibold text-foreground">
										External Logins Found
									</span>
								</div>
								<Badge variant="secondary" className="text-[9px]">
									{externalCandidates.length}
								</Badge>
							</div>
							<div className="p-4 space-y-3">
								<p className="text-[12px] text-muted-foreground">
									Found existing logins from other tools. Import them to reuse
									credentials.
								</p>
								{externalCandidates.map((candidate) => (
									<div
										key={candidate.index}
										className="flex items-center justify-between rounded-lg border border-border p-3"
									>
										<div className="min-w-0">
											<div className="text-[13px] font-medium text-foreground">
												{candidate.provider_summary}
											</div>
											<div className="text-[11px] text-muted-foreground truncate">
												via {candidate.source_name}
											</div>
										</div>
										<Button
											variant="outline"
											size="sm"
											className="text-[11px] gap-1.5"
											onClick={() => importExternalAuth(candidate.index)}
											disabled={importBusy !== null}
										>
											{importBusy === candidate.index ? (
												<Loader2 className="w-3 h-3 animate-spin" />
											) : (
												<Plus className="w-3 h-3" />
											)}
											Import
										</Button>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Cursor Native Auth */}
					{cursorAuthStatus && (
						<div className="rounded-xl border border-border bg-card overflow-hidden">
							<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
								<div className="flex items-center gap-2">
									<Bot className="w-4 h-4 text-primary" />
									<span className="text-[14px] font-semibold text-foreground">
										Cursor IDE Auth
									</span>
								</div>
								<Badge
									variant={cursorAuthStatus.available ? "default" : "outline"}
									className="text-[9px]"
								>
									{cursorAuthStatus.available ? "connected" : "not found"}
								</Badge>
							</div>
							<div className="p-4 space-y-3">
								<div className="grid grid-cols-2 gap-3">
									<div className="flex items-center gap-2">
										<span
											className={cn(
												"w-2 h-2 rounded-full",
												cursorAuthStatus.has_api_key
													? "bg-emerald-500"
													: "bg-muted-foreground/30",
											)}
										/>
										<span className="text-[12px] text-muted-foreground">
											API Key
										</span>
									</div>
									<div className="flex items-center gap-2">
										<span
											className={cn(
												"w-2 h-2 rounded-full",
												cursorAuthStatus.has_auth_file_token
													? "bg-emerald-500"
													: "bg-muted-foreground/30",
											)}
										/>
										<span className="text-[12px] text-muted-foreground">
											auth.json
										</span>
									</div>
									<div className="flex items-center gap-2">
										<span
											className={cn(
												"w-2 h-2 rounded-full",
												cursorAuthStatus.has_vscdb_token
													? "bg-emerald-500"
													: "bg-muted-foreground/30",
											)}
										/>
										<span className="text-[12px] text-muted-foreground">
											IDE State
										</span>
									</div>
								</div>
								{cursorAuthStatus.preferred_source && (
									<div className="text-[11px] text-muted-foreground">
										Preferred source: {cursorAuthStatus.preferred_source}
									</div>
								)}
							</div>
						</div>
					)}

					{/* Usage */}
					{onGetUsageInfo && (
						<div className="rounded-xl border border-border bg-card overflow-hidden">
							<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
								<div className="flex items-center gap-2">
									<BarChart3 className="w-4 h-4 text-primary" />
									<span className="text-[14px] font-semibold text-foreground">
										Usage
									</span>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="h-8 w-8 p-0"
									onClick={loadUsage}
									disabled={usageLoading}
								>
									{usageLoading ? (
										<Loader2 className="w-3.5 h-3.5 animate-spin" />
									) : (
										<RefreshCw className="w-3.5 h-3.5" />
									)}
								</Button>
							</div>
							<div className="p-4">
								{!usageInfo || usageInfo.providers.length === 0 ? (
									<div className="text-[13px] text-muted-foreground text-center py-6">
										No usage data available.
									</div>
								) : (
									<div className="space-y-3">
										{usageInfo.providers.map((provider) => (
											<div
												key={provider.provider_name}
												className="rounded-lg border border-border p-3 space-y-2"
											>
												<div className="flex items-center justify-between">
													<span className="text-[13px] font-medium text-foreground">
														{provider.provider_name}
													</span>
													{provider.hard_limit_reached && (
														<Badge variant="destructive" className="text-[9px]">
															Limit reached
														</Badge>
													)}
													{provider.error && (
														<Badge
															variant="outline"
															className="text-[9px] text-amber-500 border-amber-500/30"
														>
															Error
														</Badge>
													)}
												</div>
												{provider.limits.map((limit) => (
													<div key={limit.name} className="space-y-1">
														<div className="flex items-center justify-between text-[11px]">
															<span className="text-muted-foreground">
																{limit.name}
															</span>
															<span className="text-foreground font-medium">
																{limit.usage_percent.toFixed(1)}%
															</span>
														</div>
														<div className="h-1.5 rounded-full bg-muted overflow-hidden">
															<div
																className={cn(
																	"h-full rounded-full transition-all",
																	limit.usage_percent >= 90
																		? "bg-destructive"
																		: limit.usage_percent >= 70
																			? "bg-amber-500"
																			: "bg-emerald-500",
																)}
																style={{
																	width: `${Math.min(limit.usage_percent, 100)}%`,
																}}
															/>
														</div>
														{limit.resets_at && (
															<span className="text-[10px] text-muted-foreground">
																Resets{" "}
																{new Date(limit.resets_at).toLocaleDateString()}
															</span>
														)}
													</div>
												))}
												{provider.extra_info.length > 0 && (
													<div className="flex flex-wrap gap-1.5 pt-1">
														{provider.extra_info.map(([k, v], i) => (
															<Badge
																key={i}
																variant="secondary"
																className="text-[9px]"
															>
																{k}: {v}
															</Badge>
														))}
													</div>
												)}
											</div>
										))}
									</div>
								)}
							</div>
						</div>
					)}

					{/* Model Routes */}
					<div className="rounded-xl border border-border bg-card overflow-hidden">
						<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
							<div className="flex items-center gap-2">
								<Wifi className="w-4 h-4 text-primary" />
								<span className="text-[14px] font-semibold text-foreground">
									Model Routes
								</span>
							</div>
							<Badge variant="secondary" className="text-[9px]">
								{modelRoutes.length}
							</Badge>
						</div>
						<div className="p-4">
							{modelRoutes.length === 0 ? (
								<div className="text-[13px] text-muted-foreground text-center py-6">
									No model routes yet.
								</div>
							) : (
								<div className="space-y-1">
									{modelRoutes.slice(0, 50).map((route, i) => (
										<div
											key={`${route.provider}-${route.model}-${i}`}
											className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[12px]"
										>
											<div className="flex items-center gap-2 min-w-0">
												<span
													className={cn(
														"w-1.5 h-1.5 rounded-full shrink-0",
														route.available
															? "bg-emerald-500"
															: "bg-muted-foreground/30",
													)}
												/>
												<span className="font-medium text-foreground truncate">
													{route.model}
												</span>
												<span className="text-muted-foreground shrink-0">
													via {route.provider}
												</span>
											</div>
											<span className="text-muted-foreground shrink-0 ml-2">
												{route.api_method || "api"}
												{route.context_window
													? ` · ${(route.context_window / 1000).toFixed(0)}k`
													: ""}
											</span>
										</div>
									))}
									{modelRoutes.length > 50 && (
										<div className="text-[12px] text-muted-foreground text-center py-2">
											+{modelRoutes.length - 50} more
										</div>
									)}
								</div>
							)}
						</div>
					</div>

					<div className="h-8" />
				</div>
			</div>
		</div>
	);
}
