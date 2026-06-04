import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wrench } from "lucide-react";
import type { BrowserStatus } from "@/types";

interface BrowserSectionProps {
	getBrowserStatus?: () => Promise<BrowserStatus | null>;
	setupBrowser?: () => Promise<string | null>;
}

export function BrowserSection({
	getBrowserStatus,
	setupBrowser,
}: BrowserSectionProps) {
	const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(
		null,
	);
	const [browserBusy, setBrowserBusy] = useState(false);

	const refreshBrowserStatus = async () => {
		if (!getBrowserStatus) return;
		try {
			const status = await getBrowserStatus();
			setBrowserStatus(status);
		} catch {
			setBrowserStatus(null);
		}
	};

	useEffect(() => {
		void refreshBrowserStatus();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Browser
				</div>
				{browserBusy && (
					<Badge variant="secondary" className="text-[10px]">
						setting up…
					</Badge>
				)}
			</div>
			{browserStatus ? (
				<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
					<div className="flex items-center justify-between gap-2">
						<span className="inline-flex items-center gap-1.5 text-muted-foreground">
							<Wrench className="w-3.5 h-3.5" />
							Status
						</span>
						<Badge
							variant={browserStatus.ready ? "default" : "destructive"}
							className="text-[10px]"
						>
							{browserStatus.ready ? "ready" : "not ready"}
						</Badge>
					</div>
					<div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
						<div className="text-muted-foreground">Backend</div>
						<div className="font-mono">{browserStatus.backend}</div>
						<div className="text-muted-foreground">Browser</div>
						<div className="font-mono">{browserStatus.browser}</div>
						<div className="text-muted-foreground">Setup</div>
						<div className="font-mono">
							{browserStatus.setup_complete ? "complete" : "incomplete"}
						</div>
						<div className="text-muted-foreground">Binary</div>
						<div className="font-mono">
							{browserStatus.binary_installed ? "installed" : "missing"}
						</div>
						<div className="text-muted-foreground">Responding</div>
						<div className="font-mono">
							{browserStatus.responding ? "yes" : "no"}
						</div>
						<div className="text-muted-foreground">Compatible</div>
						<div className="font-mono">
							{browserStatus.compatible ? "yes" : "no"}
						</div>
					</div>
					{browserStatus.missing_actions.length > 0 && (
						<div className="rounded border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground">
							Missing: {browserStatus.missing_actions.join(", ")}
						</div>
					)}
					{!browserStatus.ready && setupBrowser && (
						<Button
							variant="default"
							size="sm"
							className="h-7 px-3 text-[11px]"
							disabled={browserBusy}
							onClick={() => {
								setBrowserBusy(true);
								void setupBrowser().then((log) => {
									setBrowserBusy(false);
									if (log) {
										void refreshBrowserStatus();
									}
								});
							}}
						>
							Setup Browser
						</Button>
					)}
				</div>
			) : (
				<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
					No browser status available. Click refresh or check the backend
					logs.
				</div>
			)}
		</section>
	);
}
