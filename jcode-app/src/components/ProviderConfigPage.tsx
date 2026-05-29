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
} from "lucide-react";

interface ProviderConfigPageProps {
	onAuthStatusChange?: () => void;
}

export function ProviderConfigPage({ onAuthStatusChange }: ProviderConfigPageProps) {
	const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
	const [modelRoutes, setModelRoutes] = useState<ModelRoute[]>([]);
	const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
	const [authPrompt, setAuthPrompt] = useState<ProviderAuthPrompt | null>(null);
	const [authInput, setAuthInput] = useState("");
	const [authInputKind, setAuthInputKind] = useState<string>("");
	const [authBusy, setAuthBusy] = useState(false);
	const [authMessage, setAuthMessage] = useState<{ text: string; type: "ok" | "error" } | null>(null);
	const [doctorReport, setDoctorReport] = useState<AuthDoctorReport | null>(null);
	const [doctorBusy, setDoctorBusy] = useState(false);
	const [addProfileOpen, setAddProfileOpen] = useState(false);
	const [profileForm, setProfileForm] = useState({ name: "", base_url: "", model: "", api_key: "", auth: "bearer" });

	const refresh = useCallback(async () => {
		try {
			const result = await invoke<{ routes: ModelRoute[]; providers: ProviderCatalogEntry[]; current: string }>("get_models");
			setModelRoutes(result.routes);
			setProviders(result.providers);
		} catch { /* ignore */ }
	}, []);

	useEffect(() => { void refresh(); }, [refresh]);

	const startAuthFlow = useCallback(async (providerId: string) => {
		setAuthBusy(true); setAuthPrompt(null); setAuthMessage(null);
		try {
			const prompt = await invoke<ProviderAuthPrompt>("start_provider_auth_flow", { providerId });
			setAuthPrompt(prompt); setSelectedProvider(providerId); setAuthInputKind(prompt.input_kind);
		} catch (e) { setAuthMessage({ text: String(e), type: "error" }); }
		finally { setAuthBusy(false); }
	}, []);

	const completeAuthFlow = useCallback(async () => {
		if (!selectedProvider || !authPrompt) return;
		setAuthBusy(true); setAuthMessage(null);
		try {
			const result = await invoke<{ status: string; provider: string }>("complete_provider_auth_flow", { providerId: selectedProvider, inputKind: authInputKind, input: authInput || null });
			setAuthMessage({ text: `Authenticated: ${result.provider}`, type: "ok" });
			setAuthPrompt(null); setAuthInput(""); onAuthStatusChange?.(); void refresh();
		} catch (e) { setAuthMessage({ text: String(e), type: "error" }); }
		finally { setAuthBusy(false); }
	}, [selectedProvider, authPrompt, authInputKind, authInput, onAuthStatusChange, refresh]);

	const saveApiKey = useCallback(async (providerId: string) => {
		setAuthBusy(true); setAuthMessage(null);
		try {
			await invoke("save_provider_api_key", { providerId, apiKey: authInput, region: null, apiBase: null });
			setAuthMessage({ text: `API key saved for ${providerId}`, type: "ok" });
			setAuthInput(""); onAuthStatusChange?.(); void refresh();
		} catch (e) { setAuthMessage({ text: String(e), type: "error" }); }
		finally { setAuthBusy(false); }
	}, [authInput, onAuthStatusChange, refresh]);

	const runDoctor = useCallback(async () => {
		setDoctorBusy(true);
		try { setDoctorReport(await invoke<AuthDoctorReport>("run_auth_doctor")); }
		catch (e) { setAuthMessage({ text: String(e), type: "error" }); }
		finally { setDoctorBusy(false); }
	}, []);

	const addProfile = useCallback(async () => {
		setAuthBusy(true); setAuthMessage(null);
		try {
			const result = await invoke<{ profile: string; config_path: string; api_base: string; model: string; api_key_stored: boolean; auth: string; default_set: boolean }>("add_provider_profile", profileForm);
			setAuthMessage({ text: `Profile "${result.profile}" added`, type: "ok" });
			setAddProfileOpen(false); setProfileForm({ name: "", base_url: "", model: "", api_key: "", auth: "bearer" }); void refresh();
		} catch (e) { setAuthMessage({ text: String(e), type: "error" }); }
		finally { setAuthBusy(false); }
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
						<h1 className="text-[15px] font-semibold text-foreground">Providers</h1>
						<p className="text-[12px] text-muted-foreground">{providers.length} providers · {modelRoutes.length} model routes</p>
					</div>
				</div>
				<div className="flex items-center gap-1.5">
					<Button variant="outline" size="sm" className="text-[11px] h-8 gap-1.5" onClick={runDoctor} disabled={doctorBusy}>
						{doctorBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5" />}
						Doctor
					</Button>
					<Button variant="outline" size="sm" className="text-[11px] h-8 gap-1.5" onClick={() => setAddProfileOpen(true)}>
						<Plus className="w-3.5 h-3.5" /> Profile
					</Button>
					<Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={refresh}>
						<RefreshCw className="w-3.5 h-3.5" />
					</Button>
				</div>
			</div>

			<ScrollArea className="flex-1">
				<div className="p-6 max-w-3xl mx-auto space-y-5">
					{/* Message */}
					{authMessage && (
						<div className={cn("flex items-center gap-2 px-4 py-3 rounded-xl border text-[13px]", authMessage.type === "error" ? "bg-destructive/5 border-destructive/20 text-destructive" : "bg-emerald-500/5 border-emerald-500/20 text-emerald-600")}>
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
									<span className="text-[14px] font-semibold text-foreground">Auth Doctor</span>
								</div>
								<Button variant="ghost" size="sm" className="text-[11px] h-7" onClick={() => setDoctorReport(null)}>Dismiss</Button>
							</div>
							<div className="p-4 space-y-3">
								<div className="flex items-center gap-2 text-[13px]">
									<span className="text-muted-foreground">{doctorReport.provider_count} providers checked</span>
									{doctorReport.needs_attention_count > 0 && <Badge variant="destructive" className="text-[9px]">{doctorReport.needs_attention_count} need attention</Badge>}
								</div>
								{doctorReport.providers.filter((p) => p.needs_attention).map((provider) => (
									<div key={provider.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<AlertCircle className="w-4 h-4 text-amber-500" />
												<span className="text-[13px] font-medium text-foreground">{provider.display_name}</span>
											</div>
											<Badge variant="outline" className="text-[9px]">{provider.status}</Badge>
										</div>
										{provider.diagnostics.length > 0 && (
											<ul className="space-y-1">
												{provider.diagnostics.map((d, i) => (
													<li key={i} className="text-[12px] text-muted-foreground flex items-start gap-2">
														<span className="mt-1.5 w-1 h-1 rounded-full bg-muted-foreground shrink-0" />{d}
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
								<span className="text-[14px] font-semibold text-foreground">Configure {selectedProvider}</span>
								<Button variant="ghost" size="sm" className="text-[11px] h-7"
									onClick={() => { setAuthPrompt(null); if (authInputKind !== "complete") setAuthInput(""); }}>
									Cancel
								</Button>
							</div>
							<div className="p-4 space-y-4">
								{authPrompt.status === "pending" && (
									<>
										{authPrompt.auth_url && (
											<div className="space-y-2">
												<div className="text-[12px] text-muted-foreground">Open URL to authorize:</div>
												<div className="flex items-center gap-2">
													<code className="flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px] break-all font-mono select-all">{authPrompt.auth_url}</code>
													<Button variant="outline" size="sm" className="text-[11px] shrink-0"
														onClick={() => navigator.clipboard.writeText(authPrompt.auth_url)}>Copy</Button>
												</div>
											</div>
										)}
										{authPrompt.user_code && (
											<div className="space-y-1">
												<div className="text-[12px] text-muted-foreground">Device code:</div>
												<div className="font-mono text-lg font-bold tracking-wider text-foreground select-all">{authPrompt.user_code}</div>
											</div>
										)}
										{authInputKind !== "complete" && (
											<div className="space-y-2">
												<div className="text-[12px] text-muted-foreground">
													{authInputKind === "callback_url" ? "Callback URL:" : authInputKind === "auth_code" ? "Authorization code:" : "Callback URL or code:"}
												</div>
												<div className="flex gap-2">
													<Input value={authInput} onChange={(e) => setAuthInput(e.target.value)}
														placeholder={authInputKind === "callback_url" ? "https://…" : "…"} className="font-mono text-[12px]" />
													<Button size="sm" className="text-[11px]" onClick={completeAuthFlow} disabled={authBusy || !authInput.trim()}>
														{authBusy && <Loader2 className="w-3 h-3 animate-spin mr-1" />}Submit
													</Button>
												</div>
											</div>
										)}
										{authInputKind === "complete" && (
											<Button size="sm" className="text-[11px]" onClick={completeAuthFlow} disabled={authBusy}>
												{authBusy && <Loader2 className="w-3 h-3 animate-spin mr-1" />}Complete Authentication
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
								<span className="text-[14px] font-semibold text-foreground">Custom Profile</span>
								<Button variant="ghost" size="sm" className="text-[11px] h-7" onClick={() => setAddProfileOpen(false)}>Cancel</Button>
							</div>
							<div className="p-4 space-y-3">
								<div className="grid grid-cols-2 gap-3">
									<div className="space-y-1">
										<div className="text-[11px] text-muted-foreground font-medium">Name</div>
										<Input value={profileForm.name} onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))} placeholder="my-provider" className="font-mono text-[12px]" />
									</div>
									<div className="space-y-1">
										<div className="text-[11px] text-muted-foreground font-medium">Model</div>
										<Input value={profileForm.model} onChange={(e) => setProfileForm((f) => ({ ...f, model: e.target.value }))} placeholder="gpt-4o" className="font-mono text-[12px]" />
									</div>
								</div>
								<div className="space-y-1">
									<div className="text-[11px] text-muted-foreground font-medium">Base URL</div>
									<Input value={profileForm.base_url} onChange={(e) => setProfileForm((f) => ({ ...f, base_url: e.target.value }))} placeholder="https://api.openai.com/v1" className="font-mono text-[12px]" />
								</div>
								<div className="space-y-1">
									<div className="text-[11px] text-muted-foreground font-medium">API Key <span className="text-muted-foreground/50">(optional)</span></div>
									<Input type="password" value={profileForm.api_key} onChange={(e) => setProfileForm((f) => ({ ...f, api_key: e.target.value }))} placeholder="sk-…" className="font-mono text-[12px]" />
								</div>
								<Button size="sm" className="text-[11px]" onClick={addProfile}
									disabled={authBusy || !profileForm.name || !profileForm.base_url || !profileForm.model}>
									{authBusy && <Loader2 className="w-3 h-3 animate-spin mr-1" />}Add Profile
								</Button>
							</div>
						</div>
					)}

					{/* Configured */}
					<div className="rounded-xl border border-border bg-card overflow-hidden">
						<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
							<div className="flex items-center gap-2">
								<CheckCircle2 className="w-4 h-4 text-emerald-500" />
								<span className="text-[14px] font-semibold text-foreground">Configured</span>
							</div>
							<Badge variant="secondary" className="text-[9px]">{configuredProviders.length}</Badge>
						</div>
						<div className="p-4">
							{configuredProviders.length === 0 ? (
								<div className="text-[13px] text-muted-foreground text-center py-6">No providers configured yet.</div>
							) : (
								<div className="space-y-2">
									{configuredProviders.map((p) => (
										<div key={p.provider_key} className={cn("flex items-center justify-between rounded-lg border border-border px-3 py-2.5", p.is_current_provider && "ring-1 ring-primary/30")}>
											<div className="flex items-center gap-2.5">
												<Key className="w-4 h-4 text-emerald-500" />
												<div>
													<div className="text-[13px] font-medium text-foreground">{p.display_name}</div>
													<div className="text-[11px] text-muted-foreground">{p.method_detail}</div>
												</div>
											</div>
											<div className="flex items-center gap-2">
												<Badge variant="secondary" className="text-[9px]">{p.route_count} routes</Badge>
												{p.is_current_provider && <Badge className="text-[9px]">current</Badge>}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>

					{/* Available */}
					<div className="rounded-xl border border-border bg-card overflow-hidden">
						<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
							<div className="flex items-center gap-2">
								<Globe className="w-4 h-4 text-primary" />
								<span className="text-[14px] font-semibold text-foreground">Available</span>
							</div>
						</div>
						<div className="p-4 space-y-2">
							{unconfiguredProviders.map((provider) => (
								<div key={provider.provider_key} className="rounded-lg border border-border p-3 space-y-3">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<Globe className="w-4 h-4 text-muted-foreground" />
											<div>
												<div className="text-[13px] font-medium text-foreground">{provider.display_name}</div>
												<div className="text-[11px] text-muted-foreground">{provider.method_detail}</div>
											</div>
										</div>
										<Badge variant="outline" className={cn("text-[9px]", provider.status === "expired" && "text-amber-500 border-amber-500/30")}>{provider.status}</Badge>
									</div>
									{provider.options.length > 0 && (
										<div className="flex flex-wrap gap-1.5">
											{provider.options.map((option) => (
												<Button key={option.provider_id} variant="outline" size="sm" className={cn("text-[11px] gap-1.5 h-7", option.kind === "oauth" ? "text-primary" : option.kind === "device_code" ? "text-amber-600" : "")}
													onClick={() => {
														if (option.kind === "api_key") { setSelectedProvider(option.provider_id); setAuthInputKind("api_key"); setAuthPrompt(null); }
														else void startAuthFlow(option.provider_id);
													}}>
													{option.kind === "oauth" ? "OAuth" : option.kind === "device_code" ? "Device" : "API Key"}
													<ExternalLink className="w-3 h-3" />
												</Button>
											))}
										</div>
									)}
									{/* Inline API key */}
									{selectedProvider === provider.options.find((o) => o.kind === "api_key")?.provider_id && authInputKind === "api_key" && !authPrompt && (
										<div className="flex gap-2">
											<Input type="password" value={authInput} onChange={(e) => setAuthInput(e.target.value)} placeholder="Paste API key" className="flex-1 font-mono text-[12px]" />
											<Button size="sm" className="text-[11px]" onClick={() => saveApiKey(provider.options.find((o) => o.kind === "api_key")?.provider_id || provider.provider_key)} disabled={authBusy || !authInput.trim()}>Save</Button>
										</div>
									)}
								</div>
							))}
						</div>
					</div>

					{/* Model Routes */}
					<div className="rounded-xl border border-border bg-card overflow-hidden">
						<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
							<div className="flex items-center gap-2">
								<Wifi className="w-4 h-4 text-primary" />
								<span className="text-[14px] font-semibold text-foreground">Model Routes</span>
							</div>
							<Badge variant="secondary" className="text-[9px]">{modelRoutes.length}</Badge>
						</div>
						<div className="p-4">
							{modelRoutes.length === 0 ? (
								<div className="text-[13px] text-muted-foreground text-center py-6">No model routes yet.</div>
							) : (
								<div className="space-y-1">
									{modelRoutes.slice(0, 50).map((route, i) => (
										<div key={`${route.provider}-${route.model}-${i}`} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[12px]">
											<div className="flex items-center gap-2 min-w-0">
												<span className={cn("w-1.5 h-1.5 rounded-full shrink-0", route.available ? "bg-emerald-500" : "bg-muted-foreground/30")} />
												<span className="font-medium text-foreground truncate">{route.model}</span>
												<span className="text-muted-foreground shrink-0">via {route.provider}</span>
											</div>
											<span className="text-muted-foreground shrink-0 ml-2">
												{route.api_method || "api"}{route.context_window ? ` · ${(route.context_window / 1000).toFixed(0)}k` : ""}
											</span>
										</div>
									))}
									{modelRoutes.length > 50 && (
										<div className="text-[12px] text-muted-foreground text-center py-2">+{modelRoutes.length - 50} more</div>
									)}
								</div>
							)}
						</div>
					</div>

					<div className="h-8" />
				</div>
			</ScrollArea>
		</div>
	);
}
