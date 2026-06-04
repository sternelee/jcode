import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wrench, ShieldCheck, Shield, TriangleAlert } from "lucide-react";
import type { AuthDoctorReport } from "@/types";

interface AuthDoctorSectionProps {
	authDoctor: AuthDoctorReport | null;
	refreshAuthDoctor: () => Promise<void>;
}

export function AuthDoctorSection({
	authDoctor,
	refreshAuthDoctor,
}: AuthDoctorSectionProps) {
	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Auth doctor
				</div>
				<div className="flex items-center gap-2">
					<Badge variant="outline" className="text-[10px]">
						{authDoctor?.needs_attention_count ?? "–"}
					</Badge>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[10px]"
						onClick={() => void refreshAuthDoctor()}
					>
						<Wrench className="w-3 h-3 mr-1" />
						Run
					</Button>
				</div>
			</div>
			{authDoctor ? (
				<div className="space-y-2">
					{authDoctor.needs_attention_count > 0 && (
						<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
							<div className="flex items-center gap-2">
								<TriangleAlert className="w-3.5 h-3.5 text-destructive" />
								<span className="font-medium">
									{authDoctor.needs_attention_count} provider
									{authDoctor.needs_attention_count === 1 ? "" : "s"} need
									attention
								</span>
							</div>
						</div>
					)}
					{authDoctor.providers.map((provider) => (
						<div
							key={provider.id}
							className="rounded-lg border bg-card p-3 space-y-1.5 text-xs"
						>
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-1.5">
									{provider.configured ? (
										<ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
									) : (
										<Shield className="w-3.5 h-3.5 text-muted-foreground" />
									)}
									<span className="font-medium">
										{provider.display_name}
									</span>
								</div>
								<Badge
									variant={
										provider.needs_attention
											? "destructive"
											: provider.configured
												? "secondary"
												: "outline"
									}
									className="text-[10px]"
								>
									{provider.status}
								</Badge>
							</div>
							{provider.diagnostics.length > 0 && (
								<div className="space-y-1">
									{provider.diagnostics.map((diag, i) => (
										<div
											key={i}
											className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"
										>
											<TriangleAlert className="w-3 h-3 mt-0.5 shrink-0" />
											<span>{diag}</span>
										</div>
									))}
								</div>
							)}
							{provider.recommended_actions.length > 0 && (
								<div className="space-y-1 pt-1">
									<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
										Recommended actions
									</div>
									{provider.recommended_actions.map((action, i) => (
										<div
											key={i}
											className="text-[11px] text-muted-foreground font-mono bg-secondary px-2 py-1 rounded"
										>
											{action}
										</div>
									))}
								</div>
							)}
							<div className="flex flex-wrap gap-1 pt-1">
								<Badge variant="outline" className="text-[10px]">
									{provider.credential_source}
								</Badge>
								<Badge variant="outline" className="text-[10px]">
									{provider.refresh_support}
								</Badge>
								<Badge variant="outline" className="text-[10px]">
									{provider.validation_method}
								</Badge>
							</div>
						</div>
					))}
				</div>
			) : (
				<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
					Click "Run" to generate an auth diagnostic report.
				</div>
			)}
		</section>
	);
}
