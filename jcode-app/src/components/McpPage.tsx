import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import type { McpServerInfo } from "@/types";
import {
	Server,
	Loader2,
	RefreshCw,
	Terminal,
	Share2,
	X,
	AlertCircle,
	Plus,
	Pencil,
	Trash2,
} from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface McpFormData {
	name: string;
	transport: "stdio" | "sse";
	command: string;
	args: string;
	env: string;
	url: string;
	shared: boolean;
}

function serverToForm(server: McpServerInfo): McpFormData {
	const isSse = !!server.url;
	return {
		name: server.name,
		transport: isSse ? "sse" : "stdio",
		command: server.command ?? "",
		args: server.args?.join("\n") ?? "",
		env: Object.entries(server.env ?? {})
			.map(([k, v]) => `${k}=${v}`)
			.join("\n"),
		url: server.url ?? "",
		shared: server.shared,
	};
}

function formToServer(form: McpFormData): McpServerInfo {
	const env: Record<string, string> = {};
	for (const line of form.env.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const eq = trimmed.indexOf("=");
		if (eq > 0) {
			env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
		}
	}
	if (form.transport === "sse") {
		return {
			name: form.name.trim(),
			url: form.url.trim(),
			shared: form.shared,
		};
	}
	return {
		name: form.name.trim(),
		command: form.command.trim(),
		args: form.args
			.split("\n")
			.map((a) => a.trim())
			.filter(Boolean),
		env,
		shared: form.shared,
	};
}

export function McpPage() {
	const [servers, setServers] = useState<McpServerInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingServer, setEditingServer] = useState<McpServerInfo | null>(null);
	const [form, setForm] = useState<McpFormData>({
		name: "",
		transport: "stdio",
		command: "",
		args: "",
		env: "",
		url: "",
		shared: true,
	});
	const [saving, setSaving] = useState(false);

	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

	const fetchServers = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await invoke<McpServerInfo[]>("list_mcp_servers");
			console.log("[McpPage] list_mcp_servers result:", result);
			setServers(result || []);
		} catch (e) {
			console.error("[McpPage] list_mcp_servers error:", e);
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchServers();
	}, [fetchServers]);

	const toggleExpanded = (name: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(name)) {
				next.delete(name);
			} else {
				next.add(name);
			}
			return next;
		});
	};

	const openAdd = () => {
		setEditingServer(null);
		setForm({ name: "", transport: "stdio", command: "", args: "", env: "", url: "", shared: true });
		setDialogOpen(true);
	};

	const openEdit = (server: McpServerInfo) => {
		setEditingServer(server);
		setForm(serverToForm(server));
		setDialogOpen(true);
	};

	const handleSave = async () => {
		if (!form.name.trim()) return;
		if (form.transport === "stdio" && !form.command.trim()) return;
		if (form.transport === "sse" && !form.url.trim()) return;
		setSaving(true);
		try {
			const server = formToServer(form);
			await invoke("save_mcp_server", {
				name: server.name,
				command: server.command ?? null,
				args: server.args ?? null,
				env: server.env ?? null,
				url: server.url ?? null,
				shared: server.shared,
			});
			setDialogOpen(false);
			await fetchServers();
		} catch (e) {
			setError(String(e));
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (name: string) => {
		try {
			await invoke("delete_mcp_server", { name });
			setDeleteTarget(null);
			await fetchServers();
		} catch (e) {
			setError(String(e));
		}
	};

	return (
		<div className="flex-1 flex flex-col min-w-0 bg-card overflow-hidden overflow-x-hidden">
			{/* Header */}
			<div className="px-4 md:px-6 py-3 md:py-4 border-b border-border flex items-center gap-2 md:gap-3 shrink-0 flex-wrap">
				<div className="w-7 h-7 md:w-9 md:h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
					<Server className="w-4 h-4 md:w-5 md:h-5" />
				</div>
				<div className="flex-1 min-w-0">
					<h1 className="text-[14px] md:text-[16px] font-semibold text-foreground">
						MCP Servers
					</h1>
					<p className="text-[11px] md:text-[12px] text-muted-foreground">
						{servers.length} configured server
						{servers.length !== 1 ? "s" : ""}
					</p>
				</div>
				<div className="flex items-center gap-1.5 md:gap-2 shrink-0">
					<button
						type="button"
						onClick={openAdd}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
					>
						<Plus className="w-3.5 h-3.5" />
						Add
					</button>
					<button
						type="button"
						onClick={fetchServers}
						disabled={loading}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors disabled:opacity-50"
					>
						<RefreshCw
							className={cn("w-3.5 h-3.5", loading && "animate-spin")}
						/>
						Refresh
					</button>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 py-3 md:py-4 min-w-0">
				{loading && servers.length === 0 && (
					<div className="flex items-center justify-center py-12">
						<Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
						<span className="ml-2 text-sm text-muted-foreground">
							Loading servers...
						</span>
					</div>
				)}

				{error && (
					<div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-[13px]">
						<AlertCircle className="w-4 h-4 shrink-0" />
						{error}
					</div>
				)}

				{!loading && servers.length === 0 && !error && (
					<div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Server className="w-10 h-10 mb-3 opacity-40" />
						<p className="text-[14px] font-medium">No MCP servers configured</p>
						<p className="text-[12px] mt-1 opacity-70">
							Add servers to ~/.jcode/mcp.json
						</p>
					</div>
				)}

				<div className="space-y-2">
					{servers.map((server) => {
						const isExpanded = expanded.has(server.name);
						return (
							<div
								key={server.name}
								className="rounded-xl border border-border bg-card overflow-hidden"
							>
								<button
									type="button"
									onClick={() => toggleExpanded(server.name)}
									className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
								>
									<div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
										<Terminal className="w-4 h-4" />
									</div>
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-medium text-[13px] text-foreground truncate">
												{server.name}
											</span>
											{server.shared && (
												<span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-medium">
													<Share2 className="w-2.5 h-2.5" />
													Shared
												</span>
											)}
										</div>
										<p className="text-[11px] text-muted-foreground truncate">
											{server.url ?? `${server.command} ${server.args?.join(" ") ?? ""}`}
										</p>
									</div>
									<div className="flex items-center gap-1">
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												openEdit(server);
											}}
											className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
											title="Edit"
										>
											<Pencil className="w-3.5 h-3.5" />
										</button>
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												setDeleteTarget(server.name);
											}}
											className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
											title="Delete"
										>
											<Trash2 className="w-3.5 h-3.5" />
										</button>
										{isExpanded ? (
											<X className="w-4 h-4 text-muted-foreground ml-1" />
										) : (
											<span className="text-[11px] text-muted-foreground ml-1">
												Details
											</span>
										)}
									</div>
								</button>

								{isExpanded && (
									<div className="px-4 pb-3 pt-1 border-t border-border bg-muted/20">
								<div className="space-y-2 text-[11px] md:text-[12px]">
									<div className="flex gap-2">
										<span className="text-muted-foreground shrink-0 w-14 md:w-16">
											Command:
										</span>
										<code className="bg-muted px-1.5 py-0.5 rounded text-foreground font-mono text-[11px] md:text-[12px] truncate max-w-full">
													{server.command}
												</code>
											</div>
											{server.args && server.args.length > 0 && (
												<div className="flex gap-2">
												<span className="text-muted-foreground shrink-0 w-14 md:w-16">
													Args:
												</span>
													<div className="flex flex-wrap gap-1">
														{server.args?.map((arg, i) => (
															<code
																key={i}
																className="bg-muted px-1.5 py-0.5 rounded text-foreground font-mono"
															>
																{arg}
															</code>
														))}
													</div>
												</div>
											)}
											{server.env && Object.keys(server.env).length > 0 && (
												<div className="flex gap-2">
												<span className="text-muted-foreground shrink-0 w-14 md:w-16">
													Env:
												</span>
													<div className="flex flex-col gap-1">
														{Object.entries(server.env).map(
															([key, value]) => (
																<div
																	key={key}
																	className="flex gap-1 items-center"
																>
																	<code className="bg-muted px-1.5 py-0.5 rounded text-foreground font-mono">
																		{key}=
																	</code>
																	<span className="text-muted-foreground">
																		{value}
																	</span>
																</div>
															),
														)}
													</div>
												</div>
											)}
											<div className="flex gap-2">
												<span className="text-muted-foreground shrink-0 w-14 md:w-16">
													Shared:
												</span>
												<span
													className={cn(
														"font-medium",
														server.shared
															? "text-emerald-600"
															: "text-amber-600",
													)}
												>
													{server.shared ? "Yes" : "No"}
												</span>
											</div>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>

			{/* Add/Edit Dialog */}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle className="text-[15px]">
							{editingServer ? "Edit MCP Server" : "Add MCP Server"}
						</DialogTitle>
					</DialogHeader>
					<div className="space-y-3 py-2">
						<div className="space-y-1">
							<label className="text-[12px] font-medium text-muted-foreground">
								Name
							</label>
							<Input
								value={form.name}
								onChange={(e) => setForm({ ...form, name: e.target.value })}
								placeholder="e.g. filesystem"
								className="text-sm"
								disabled={!!editingServer}
							/>
						</div>
						<div className="space-y-1">
							<label className="text-[12px] font-medium text-muted-foreground">
								Command
							</label>
							<Input
								value={form.command}
								onChange={(e) => setForm({ ...form, command: e.target.value })}
								placeholder="e.g. npx"
								className="text-sm"
							/>
						</div>
						<div className="space-y-1">
							<label className="text-[12px] font-medium text-muted-foreground">
								Args (one per line)
							</label>
							<Textarea
								value={form.args}
								onChange={(e) => setForm({ ...form, args: e.target.value })}
								placeholder="-y&#10;@modelcontextprotocol/server-filesystem"
								className="min-h-[60px] resize-y text-sm"
							/>
						</div>
						<div className="space-y-1">
							<label className="text-[12px] font-medium text-muted-foreground">
								Env (KEY=VALUE, one per line)
							</label>
							<Textarea
								value={form.env}
								onChange={(e) => setForm({ ...form, env: e.target.value })}
								placeholder="HOME=/Users/me"
								className="min-h-[60px] resize-y text-sm"
							/>
						</div>
						<div className="flex items-center gap-2">
							<input
								type="checkbox"
								id="shared"
								checked={form.shared}
								onChange={(e) => setForm({ ...form, shared: e.target.checked })}
								className="rounded border-border"
							/>
							<label htmlFor="shared" className="text-[13px] text-foreground">
								Shared across sessions
							</label>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setDialogOpen(false)}
							size="sm"
						>
							Cancel
						</Button>
						<Button
							onClick={handleSave}
							disabled={saving || !form.name.trim() || (form.transport === "stdio" ? !form.command.trim() : !form.url.trim())}
							size="sm"
						>
							{saving ? "Saving..." : editingServer ? "Update" : "Save"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirm */}
			<ConfirmDialog
				open={!!deleteTarget}
				title="Delete MCP Server"
				message={`Are you sure you want to delete "${deleteTarget}"?`}
				confirmLabel="Delete"
				variant="destructive"
				onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
				onCancel={() => setDeleteTarget(null)}
			/>
		</div>
	);
}
