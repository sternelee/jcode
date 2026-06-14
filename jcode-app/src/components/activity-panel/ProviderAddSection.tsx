import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProviderSetupReport } from "@/types";

interface ProviderAddSectionProps {
	addProviderProfile?: (params: {
		name: string;
		base_url: string;
		model: string;
		api_key?: string;
		auth?: string;
	}) => Promise<ProviderSetupReport | null>;
}

export function ProviderAddSection({
	addProviderProfile,
}: ProviderAddSectionProps) {
	const [providerAddOpen, setProviderAddOpen] = useState(false);
	const [providerAddBusy, setProviderAddBusy] = useState(false);
	const [providerAddResult, setProviderAddResult] = useState<
		ProviderSetupReport | null
	>(null);
	const [providerAddForm, setProviderAddForm] = useState({
		name: "",
		base_url: "",
		model: "",
		api_key: "",
		auth: "bearer",
	});

	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Add provider
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 px-2 text-[10px]"
					onClick={() => setProviderAddOpen((v) => !v)}
				>
					{providerAddOpen ? "Cancel" : "Add"}
				</Button>
			</div>
			{providerAddOpen && (
				<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
					<div className="space-y-1">
						<label className="text-[10px] text-muted-foreground">Name</label>
						<input
							className="w-full rounded border bg-background px-2 py-1 text-xs"
							value={providerAddForm.name}
							onChange={(e) =>
								setProviderAddForm((f) => ({
									...f,
									name: e.target.value,
								}))
							}
							placeholder="my-api"
						/>
					</div>
					<div className="space-y-1">
						<label className="text-[10px] text-muted-foreground">
							Base URL
						</label>
						<input
							className="w-full rounded border bg-background px-2 py-1 text-xs"
							value={providerAddForm.base_url}
							onChange={(e) =>
								setProviderAddForm((f) => ({
									...f,
									base_url: e.target.value,
								}))
							}
							placeholder="https://api.example.com/v1"
						/>
					</div>
					<div className="space-y-1">
						<label className="text-[10px] text-muted-foreground">Model</label>
						<input
							className="w-full rounded border bg-background px-2 py-1 text-xs"
							value={providerAddForm.model}
							onChange={(e) =>
								setProviderAddForm((f) => ({
									...f,
									model: e.target.value,
								}))
							}
							placeholder="gpt-4o"
						/>
					</div>
					<div className="space-y-1">
						<label className="text-[10px] text-muted-foreground">
							API Key
						</label>
						<input
							className="w-full rounded border bg-background px-2 py-1 text-xs"
							type="password"
							value={providerAddForm.api_key}
							onChange={(e) =>
								setProviderAddForm((f) => ({
									...f,
									api_key: e.target.value,
								}))
							}
							placeholder="sk-..."
						/>
					</div>
					<div className="space-y-1">
						<label className="text-[10px] text-muted-foreground">
							Auth mode
						</label>
						<select
							className="w-full rounded border bg-background px-2 py-1 text-xs"
							value={providerAddForm.auth}
							onChange={(e) =>
								setProviderAddForm((f) => ({
									...f,
									auth: e.target.value,
								}))
							}
						>
							<option value="bearer">Bearer</option>
							<option value="api-key">API Key header</option>
							<option value="none">None</option>
						</select>
					</div>
					<Button
						variant="secondary"
						size="sm"
						className="h-6 px-2 text-[10px] w-full"
						disabled={
							providerAddBusy ||
							!providerAddForm.name ||
							!providerAddForm.base_url ||
							!providerAddForm.model
						}
						onClick={() => {
							if (!addProviderProfile) return;
							setProviderAddBusy(true);
							void addProviderProfile(providerAddForm)
								.then((report) => {
									setProviderAddResult(report);
									if (report) {
										setProviderAddForm({
											name: "",
											base_url: "",
											model: "",
											api_key: "",
											auth: "bearer",
										});
									}
								})
								.finally(() => setProviderAddBusy(false));
						}}
					>
						{providerAddBusy ? "Adding..." : "Add provider"}
					</Button>
					{providerAddResult && (
						<div className="rounded border bg-secondary px-2 py-1.5 space-y-1">
							<div className="font-medium">{providerAddResult.profile}</div>
							<div className="text-[10px] text-muted-foreground">
								{providerAddResult.api_base}
							</div>
							<div className="text-[10px] text-muted-foreground">
								model {providerAddResult.model}
							</div>
						</div>
					)}
				</div>
			)}
			{!providerAddOpen && (
				<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
					Add OpenAI-compatible provider profiles for custom endpoints.
				</div>
			)}
		</section>
	);
}
