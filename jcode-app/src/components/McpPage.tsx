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
} from "lucide-react";

export function McpPage() {
	const [servers, setServers] = useState<McpServerInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const fetchServers = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await invoke<McpServerInfo[]>("list_mcp_servers");
			setServers(result || []);
		} catch (e) {
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

	return (
		<div className="flex-1 flex flex-col bg-card overflow-hidden">
			{/* Header */}
			<div className="px-6 py-4 border-b border-border flex items-center gap-3 shrink-0">
				<div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
					<Server className="w-5 h-5" />
				</div>
				<div className="flex-1 min-w-0">
					<h1 className="text-[16px] font-semibold text-foreground">
						MCP Servers
					</h1>
					<p className="text-[12px] text-muted-foreground">
						{servers.length} configured server
						{servers.length !== 1 ? "s" : ""}
					</p>
				</div>
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

			{/* Content */}
			<div className="flex-1 overflow-y-auto px-6 py-4">
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
											{server.command}{" "}
											{server.args.join(" ")}
										</p>
									</div>
									{isExpanded ? (
										<X className="w-4 h-4 text-muted-foreground" />
									) : (
										<span className="text-[11px] text-muted-foreground">
											Details
										</span>
									)}
								</button>

								{isExpanded && (
									<div className="px-4 pb-3 pt-1 border-t border-border bg-muted/20">
										<div className="space-y-2 text-[12px]">
											<div className="flex gap-2">
												<span className="text-muted-foreground shrink-0 w-16">
													Command:
												</span>
												<code className="bg-muted px-1.5 py-0.5 rounded text-foreground font-mono">
													{server.command}
												</code>
											</div>
											{server.args.length > 0 && (
												<div className="flex gap-2">
													<span className="text-muted-foreground shrink-0 w-16">
														Args:
													</span>
													<div className="flex flex-wrap gap-1">
														{server.args.map((arg, i) => (
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
											{Object.keys(server.env).length > 0 && (
												<div className="flex gap-2">
													<span className="text-muted-foreground shrink-0 w-16">
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
												<span className="text-muted-foreground shrink-0 w-16">
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
		</div>
	);
}
