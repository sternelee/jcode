import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Smartphone } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { PairedDeviceInfo } from "@/types";

interface DevicePairingSectionProps {
	pairedDevices: PairedDeviceInfo[] | null;
	refreshDevices: () => Promise<void>;
}

export function DevicePairingSection({
	pairedDevices,
	refreshDevices,
}: DevicePairingSectionProps) {
	const [pairingCode, setPairingCode] = useState<string | null>(null);

	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
					<Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
					Devices
				</div>
				<Badge variant="outline" className="text-[10px]">
					{pairedDevices?.length ?? "—"}
				</Badge>
			</div>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-7 text-[10px]"
					onClick={async () => {
						try {
							const code = await invoke<string>("generate_pairing_code");
							setPairingCode(code);
							void refreshDevices();
						} catch {
							// ignore
						}
					}}
				>
					Generate pairing code
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 text-[10px]"
					onClick={() => void refreshDevices()}
				>
					Refresh
				</Button>
			</div>
			{pairingCode && (
				<div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
					<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
						Pairing code
					</div>
					<div className="text-2xl font-mono font-bold tracking-widest text-center">
						{pairingCode}
					</div>
					<div className="text-[10px] text-muted-foreground text-center">
						Valid for 5 minutes
					</div>
				</div>
			)}
			{pairedDevices && pairedDevices.length > 0 ? (
				<div className="space-y-2">
					{pairedDevices.map((device) => (
						<div
							key={device.id}
							className="rounded border bg-secondary px-2 py-2 space-y-1 text-xs"
						>
							<div className="flex items-start justify-between gap-2">
								<div className="font-medium">{device.name}</div>
								<Button
									variant="ghost"
									size="sm"
									className="h-5 px-1.5 text-[10px] text-destructive"
									onClick={async () => {
										try {
											await invoke("revoke_device", {
												deviceId: device.id,
											});
											void refreshDevices();
										} catch {
											// ignore
										}
									}}
								>
									Revoke
								</Button>
							</div>
							<div className="text-[10px] text-muted-foreground font-mono">
								{device.id}
							</div>
							<div className="text-[10px] text-muted-foreground">
								Last seen {device.last_seen}
							</div>
						</div>
					))}
				</div>
			) : (
				<div className="rounded-lg border border p-3 text-xs text-muted-foreground">
					No paired devices.
				</div>
			)}
		</section>
	);
}
