import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
	ModelRoute,
	ProviderCatalogEntry,
	ProviderAuthPrompt,
	AuthDoctorReport,
} from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
	Key,
	Globe,
	CheckCircle2,
	XCircle,
	AlertCircle,
	ExternalLink,
	RefreshCw,
	ShieldCheck,
	Network,
	Plus,
	Stethoscope,
	Loader2,
} from "lucide-react";

interface ProviderConfigPageProps {
	onAuthStatusChange?: () => void;
}

export function ProviderConfigPage({
	onAuthStatusChange,
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
			// ignore
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const startAuthFlow = useCallback(async (providerId: string) => {
		setAuthBusy(true);
		setAuthPrompt(null);
		setAuthMessage(null);
		try {
			const prompt = await invoke<ProviderAuthPrompt>(
				"start_provider_auth_flow",
				{
					providerId,
				},
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
			setAuthMessage({
				text: `Authenticated: ${result.provider}`,
				type: "ok",
			});
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
				setAuthMessage({
					text: `API key saved for ${providerId}`,
					type: "ok",
				});
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
			const report = await invoke<AuthDoctorReport>("run_auth_doctor");
			setDoctorReport(report);
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
			setAuthMessage({
				text: `Profile "${result.profile}" added at ${result.config_path}`,
				type: "ok",
			});
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
			<div className="flex items-center justify-between px-6 py-4 border-b border-border">
				<div className="flex items-center gap-3">
					<Network className="w-5 h-5 text-primary" />
					<h1 className="text-lg font-semibold">Providers</h1>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						className="text-xs gap-1.5"
						onClick={runDoctor}
						disabled={doctorBusy}
					>
						{doctorBusy ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : (
							<Stethoscope className="w-3.5 h-3.5" />
						)}
						Auth Doctor
					</Button>
					<Button
						variant="default"
						size="sm"
						className="text-xs gap-1.5"
						onClick={() => setAddProfileOpen(true)}
					>
						<Plus className="w-3.5 h-3.5" />
						Add Profile
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="text-xs"
						onClick={refresh}
					>
						<RefreshCw className="w-3.5 h-3.5" />
					</Button>
				</div>
			</div>

			<ScrollArea className="flex-1">
				<div className="p-6 max-w-3xl mx-auto space-y-6">
					{/* ── Auth Doctor Report ── */}
					{doctorReport && (
						<section className="rounded-xl border bg-card p-4 space-y-3">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<ShieldCheck className="w-4 h-4 text-emerald-500" />
									<h2 className="text-sm font-semibold">Auth Doctor Report</h2>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-xs"
									onClick={() => setDoctorReport(null)}
								>
									Dismiss
								</Button>
							</div>
							<div className="flex items-center gap-2 text-sm">
								<span className="text-muted-foreground">
									Providers checked:
								</span>
								<Badge variant="secondary">{doctorReport.provider_count}</Badge>
								{doctorReport.needs_attention_count > 0 && (
									<Badge variant="destructive" className="ml-2">
										{doctorReport.needs_attention_count} need attention
									</Badge>
								)}
							</div>
							{doctorReport.providers
								.filter((p) => p.needs_attention)
								.map((provider) => (
									<div
										key={provider.id}
										className="rounded-lg border bg-secondary/50 p-3 space-y-2"
									>
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<AlertCircle className="w-4 h-4 text-amber-500" />
												<span className="font-medium text-sm">
													{provider.display_name}
												</span>
											</div>
											<Badge variant="outline" className="text-xs">
												{provider.status}
											</Badge>
										</div>
										{provider.diagnostics.length > 0 && (
											<ul className="space-y-1">
												{provider.diagnostics.map((d, i) => (
													<li
														key={i}
														className="text-xs text-muted-foreground flex items-start gap-2"
													>
														<span className="mt-1 w-1 h-1 rounded-full bg-muted-foreground flex-shrink-0" />
														{d}
													</li>
												))}
											</ul>
										)}
										{provider.recommended_actions.length > 0 && (
											<div className="space-y-1">
												<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
													Recommended
												</div>
												{provider.recommended_actions.map((action, i) => (
													<Badge
														key={i}
														variant="outline"
														className="text-[10px]"
													>
														{action}
													</Badge>
												))}
											</div>
										)}
									</div>
								))}
						</section>
					)}

					{/* ── Auth Message Banner ── */}
					{authMessage && (
						<div
							className={cn(
								"flex items-center gap-2 px-4 py-3 rounded-xl border text-sm",
								authMessage.type === "error"
									? "bg-red-500/5 border-red-200 text-red-600 dark:border-red-800"
									: "bg-emerald-500/5 border-emerald-200 text-emerald-600 dark:border-emerald-800",
							)}
						>
							{authMessage.type === "error" ? (
								<XCircle className="w-4 h-4 flex-shrink-0" />
							) : (
								<CheckCircle2 className="w-4 h-4 flex-shrink-0" />
							)}
							{authMessage.text}
						</div>
					)}

					{/* ── Auth Flow Prompt ── */}
					{authPrompt && (
						<section className="rounded-xl border bg-card p-4 space-y-4">
							<div className="flex items-center justify-between">
								<h2 className="text-sm font-semibold">
									Configure {selectedProvider}
								</h2>
								<Button
									variant="ghost"
									size="sm"
									className="text-xs"
									onClick={() => {
										setAuthPrompt(null);
										authInputKind !== "complete" && setAuthInput("");
									}}
								>
									Cancel
								</Button>
							</div>

							{authPrompt.status === "pending" && (
								<div className="space-y-3">
									{authPrompt.auth_url && (
										<div className="space-y-2">
											<div className="text-xs text-muted-foreground">
												Open this URL to authorize:
											</div>
											<div className="flex items-center gap-2">
												<code className="flex-1 rounded border bg-secondary px-3 py-2 text-xs break-all font-mono select-all">
													{authPrompt.auth_url}
												</code>
												<Button
													variant="outline"
													size="sm"
													className="text-xs shrink-0"
													onClick={() => {
														void navigator.clipboard.writeText(
															authPrompt.auth_url,
														);
													}}
												>
													Copy URL
												</Button>
											</div>
										</div>
									)}
									{authPrompt.user_code && (
										<div className="space-y-1">
											<div className="text-xs text-muted-foreground">
												Device code:
											</div>
											<div className="font-mono text-lg font-bold tracking-wider select-all">
												{authPrompt.user_code}
											</div>
										</div>
									)}

									{authInputKind !== "complete" && (
										<div className="space-y-2">
											<label className="text-xs text-muted-foreground">
												{authInputKind === "callback_url"
													? "Paste the callback URL:"
													: authInputKind === "auth_code"
														? "Paste the authorization code:"
														: "Paste the callback URL or authorization code:"}
											</label>
											<div className="flex gap-2">
												<Input
													value={authInput}
													onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
														setAuthInput(e.target.value)
													}
													placeholder={
														authInputKind === "callback_url"
															? "https://..."
															: "..."
													}
													className="flex-1 font-mono text-xs"
												/>
												<Button
													variant="default"
													size="sm"
													className="text-xs"
													onClick={completeAuthFlow}
													disabled={authBusy || !authInput.trim()}
												>
													{authBusy ? (
														<Loader2 className="w-3 h-3 animate-spin mr-1" />
													) : null}
													Submit
												</Button>
											</div>
										</div>
									)}
									{authInputKind === "complete" && (
										<Button
											variant="default"
											size="sm"
											className="text-xs"
											onClick={completeAuthFlow}
											disabled={authBusy}
										>
											{authBusy ? (
												<Loader2 className="w-3 h-3 animate-spin mr-1" />
											) : null}
											Complete Authentication
										</Button>
									)}
								</div>
							)}
						</section>
					)}

					{/* ── Add Profile Form ── */}
					{addProfileOpen && (
						<section className="rounded-xl border bg-card p-4 space-y-4">
							<div className="flex items-center justify-between">
								<h2 className="text-sm font-semibold">
									Add Custom Provider Profile
								</h2>
								<Button
									variant="ghost"
									size="sm"
									className="text-xs"
									onClick={() => setAddProfileOpen(false)}
								>
									Cancel
								</Button>
							</div>
							<div className="grid grid-cols-1 gap-3">
								<div className="space-y-1">
									<label className="text-xs text-muted-foreground">Name</label>
									<Input
										value={profileForm.name}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
											setProfileForm((f) => ({ ...f, name: e.target.value }))
										}
										placeholder="my-custom-provider"
										className="font-mono text-xs"
									/>
								</div>
								<div className="space-y-1">
									<label className="text-xs text-muted-foreground">
										Base URL
									</label>
									<Input
										value={profileForm.base_url}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
											setProfileForm((f) => ({
												...f,
												base_url: e.target.value,
											}))
										}
										placeholder="https://api.openai.com/v1"
										className="font-mono text-xs"
									/>
								</div>
								<div className="space-y-1">
									<label className="text-xs text-muted-foreground">Model</label>
									<Input
										value={profileForm.model}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
											setProfileForm((f) => ({ ...f, model: e.target.value }))
										}
										placeholder="gpt-4o"
										className="font-mono text-xs"
									/>
								</div>
								<div className="space-y-1">
									<label className="text-xs text-muted-foreground">
										API Key (optional)
									</label>
									<Input
										type="password"
										value={profileForm.api_key}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
											setProfileForm((f) => ({ ...f, api_key: e.target.value }))
										}
										placeholder="sk-..."
										className="font-mono text-xs"
									/>
								</div>
								<Button
									variant="default"
									size="sm"
									className="text-xs self-start"
									onClick={addProfile}
									disabled={
										authBusy ||
										!profileForm.name ||
										!profileForm.base_url ||
										!profileForm.model
									}
								>
									{authBusy ? (
										<Loader2 className="w-3 h-3 animate-spin mr-1" />
									) : null}
									Add Profile
								</Button>
							</div>
						</section>
					)}

					{/* ── Configured Providers ── */}
					<section className="space-y-3">
						<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
							<CheckCircle2 className="w-3.5 h-3.5" />
							Configured
							<Badge variant="secondary" className="text-[10px]">
								{configuredProviders.length}
							</Badge>
						</h2>
						{configuredProviders.length === 0 ? (
							<div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
								No providers configured yet. Configure a provider below or add a
								custom profile.
							</div>
						) : (
							<div className="grid grid-cols-1 gap-2">
								{configuredProviders.map((provider) => (
									<div
										key={provider.provider_key}
										className={cn(
											"rounded-xl border bg-card p-4 transition-colors hover:bg-secondary/30",
											provider.is_current_provider && "ring-1 ring-primary/30",
										)}
									>
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<Key className="w-4 h-4 text-emerald-500" />
												<div>
													<div className="text-sm font-medium">
														{provider.display_name}
													</div>
													<div className="text-xs text-muted-foreground">
														{provider.method_detail}
													</div>
												</div>
											</div>
											<div className="flex items-center gap-2">
												<Badge variant="secondary" className="text-[10px]">
													{provider.route_count} routes
												</Badge>
												{provider.is_current_provider && (
													<Badge className="text-[10px]">current</Badge>
												)}
											</div>
										</div>
									</div>
								))}
							</div>
						)}
					</section>

					<Separator />

					{/* ── Available Providers ── */}
					<section className="space-y-3">
						<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							Available Providers
						</h2>
						<div className="grid grid-cols-1 gap-2">
							{unconfiguredProviders.map((provider) => (
								<div
									key={provider.provider_key}
									className="rounded-xl border bg-card p-4 space-y-3"
								>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<Globe className="w-4 h-4 text-muted-foreground" />
											<div>
												<div className="text-sm font-medium">
													{provider.display_name}
												</div>
												<div className="text-xs text-muted-foreground">
													{provider.method_detail}
												</div>
											</div>
										</div>
										<Badge
											variant="outline"
											className={cn(
												"text-[10px]",
												provider.status === "expired" &&
													"text-amber-500 border-amber-200",
											)}
										>
											{provider.status}
										</Badge>
									</div>
									{provider.options.length > 0 && (
										<div className="flex flex-wrap gap-2">
											{provider.options.map((option) => (
												<Button
													key={option.provider_id}
													variant="outline"
													size="sm"
													className={cn(
														"text-xs gap-1.5",
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
														} else {
															void startAuthFlow(option.provider_id);
														}
													}}
												>
													{option.kind === "oauth"
														? "OAuth Login"
														: option.kind === "device_code"
															? "Device Login"
															: "Save API Key"}
													<ExternalLink className="w-3 h-3" />
												</Button>
											))}
										</div>
									)}

									{/* Inline API key input */}
									{selectedProvider ===
										provider.options.find((o) => o.kind === "api_key")
											?.provider_id &&
										authInputKind === "api_key" &&
										!authPrompt && (
											<div className="flex gap-2 items-center">
												<Input
													type="password"
													value={authInput}
													onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
														setAuthInput(e.target.value)
													}
													placeholder="Paste API key"
													className="flex-1 font-mono text-xs"
												/>
												<Button
													variant="default"
													size="sm"
													className="text-xs"
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
					</section>

					{/* ── Model Routes ── */}
					<Separator />
					<section className="space-y-3">
						<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
							<Network className="w-3.5 h-3.5" />
							Model Routes
							<Badge variant="secondary" className="text-[10px]">
								{modelRoutes.length}
							</Badge>
						</h2>
						{modelRoutes.length === 0 ? (
							<div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
								No model routes available. Configure a provider first.
							</div>
						) : (
							<div className="grid grid-cols-1 gap-1.5">
								{modelRoutes.slice(0, 50).map((route, i) => (
									<div
										key={`${route.provider}-${route.model}-${i}`}
										className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-xs"
									>
										<div className="flex items-center gap-2 min-w-0">
											<span
												className={cn(
													"w-1.5 h-1.5 rounded-full flex-shrink-0",
													route.available
														? "bg-emerald-500"
														: "bg-muted-foreground",
												)}
											/>
											<span className="font-medium truncate">
												{route.model}
											</span>
											<span className="text-muted-foreground shrink-0">
												via {route.provider}
											</span>
										</div>
										<span className="text-muted-foreground shrink-0 ml-2">
											{route.api_method || "api"}
											{route.context_window &&
												` · ${(route.context_window / 1000).toFixed(0)}k`}
										</span>
									</div>
								))}
								{modelRoutes.length > 50 && (
									<div className="text-xs text-muted-foreground text-center py-2">
										+{modelRoutes.length - 50} more routes (not shown)
									</div>
								)}
							</div>
						)}
					</section>

					<div className="h-8" />
				</div>
			</ScrollArea>
		</div>
	);
}
