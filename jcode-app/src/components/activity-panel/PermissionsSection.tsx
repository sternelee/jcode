import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import type { PermissionRequest } from "@/types";

interface PermissionsSectionProps {
	permissionRequests: PermissionRequest[] | null;
	refreshPermissions: () => Promise<void>;
	respondToPermission?: (
		requestId: string,
		approved: boolean,
	) => Promise<boolean>;
}

export function PermissionsSection({
	permissionRequests,
	refreshPermissions,
	respondToPermission,
}: PermissionsSectionProps) {
	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Permissions
				</div>
				<div className="flex items-center gap-1.5">
					<Badge variant="outline" className="text-[10px]">
						{permissionRequests?.length ?? "–"}
					</Badge>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[10px]"
						onClick={() => void refreshPermissions()}
					>
						<RotateCcw className="w-3 h-3 mr-1" />
						Refresh
					</Button>
				</div>
			</div>
			{permissionRequests === null ? (
				<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
					Click "Refresh" to load pending permission requests.
				</div>
			) : permissionRequests.length === 0 ? (
				<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
					No pending permission requests.
				</div>
			) : (
				<div className="space-y-2">
					{permissionRequests.map((req) => (
						<div
							key={req.id}
							className="rounded-lg border bg-card p-3 space-y-2 text-xs"
						>
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0">
									<div className="font-medium">{req.action}</div>
									<div className="text-[11px] text-muted-foreground">
										{req.description}
									</div>
								</div>
								<Badge
									variant={
										req.urgency === "high"
											? "destructive"
											: req.urgency === "normal"
												? "secondary"
												: "outline"
									}
									className="text-[10px] uppercase"
								>
									{req.urgency}
								</Badge>
							</div>
							{req.rationale && (
								<div className="rounded border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground">
									{req.rationale}
								</div>
							)}
							<div className="flex items-center gap-2">
								<Button
									variant="default"
									size="sm"
									className="h-6 px-2 text-[10px]"
									onClick={() => {
										if (respondToPermission) {
											void respondToPermission(req.id, true).then(
												(ok) => {
													if (ok) void refreshPermissions();
												},
											);
										}
									}}
								>
									Approve
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="h-6 px-2 text-[10px]"
									onClick={() => {
										if (respondToPermission) {
											void respondToPermission(req.id, false).then(
												(ok) => {
													if (ok) void refreshPermissions();
												},
											);
										}
									}}
								>
									Deny
								</Button>
								<span className="text-[10px] text-muted-foreground ml-auto">
									{new Date(req.created_at).toLocaleString()}
								</span>
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
