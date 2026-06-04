import { Badge } from "@/components/ui/badge";
import type { UsageInfo } from "@/types";

interface UsageSectionProps {
	usageInfo: UsageInfo | null;
}

export function UsageSection({ usageInfo }: UsageSectionProps) {
	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Usage
				</div>
				<Badge variant="outline" className="text-[10px]">
					{usageInfo?.providers.length ?? 0}
				</Badge>
			</div>
			{usageInfo ? (
				<div className="space-y-2">
					{usageInfo.providers.map((provider) => (
						<div
							key={provider.provider_name}
							className="rounded-lg border bg-card p-3 space-y-1.5 text-xs"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-medium">
									{provider.provider_name}
								</span>
								{provider.hard_limit_reached && (
									<Badge variant="destructive" className="text-[10px]">
										limit reached
									</Badge>
								)}
								{provider.error && (
									<Badge variant="outline" className="text-[10px]">
										error
									</Badge>
								)}
							</div>
							{provider.error && (
								<div className="text-[11px] text-destructive">
									{provider.error}
								</div>
							)}
							{provider.limits.map((limit) => (
								<div key={limit.name} className="space-y-1">
									<div className="flex items-center justify-between gap-2">
										<span className="text-muted-foreground">
											{limit.name}
										</span>
										<span className="font-mono">
											{Math.round(limit.usage_percent)}%
										</span>
									</div>
									<div className="h-1.5 rounded-full bg-secondary overflow-hidden">
										<div
											className="h-full rounded-full bg-primary transition-all"
											style={{
												width: `${Math.min(limit.usage_percent, 100)}%`,
												backgroundColor:
													limit.usage_percent > 90
														? "#ef4444"
														: limit.usage_percent > 70
															? "#f59e0b"
															: undefined,
											}}
										/>
									</div>
									{limit.resets_at && (
										<div className="text-[10px] text-muted-foreground">
											resets at {limit.resets_at}
										</div>
									)}
								</div>
							))}
							{provider.extra_info.length > 0 && (
								<div className="flex flex-wrap gap-1.5 pt-1">
									{provider.extra_info.map(([key, value]) => (
										<Badge
											key={key}
											variant="outline"
											className="text-[10px]"
										>
											{key}: {value}
										</Badge>
									))}
								</div>
							)}
						</div>
					))}
				</div>
			) : (
				<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
					Usage info unavailable.
				</div>
			)}
		</section>
	);
}
