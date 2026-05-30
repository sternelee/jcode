import { useEffect } from "react";
import { Keyboard, X } from "lucide-react";

interface ShortcutsHelpModalProps {
	open: boolean;
	onClose: () => void;
}

const shortcuts = [
	{ keys: ["Cmd", "P"], action: "Session switcher" },
	{ keys: ["/"], action: "Open session switcher" },
	{ keys: ["Cmd", "F"], action: "Search messages" },
	{ keys: ["Enter"], action: "Send message" },
	{ keys: ["Shift", "Enter"], action: "New line in input" },
	{ keys: ["@"], action: "Mention agent in input" },
	{ keys: ["/"], action: "Slash commands in input" },
	{ keys: ["↑", "↓"], action: "Navigate dropdowns" },
	{ keys: ["Esc"], action: "Close panels / cancel" },
	{ keys: ["O"], action: "Toggle side panel" },
	{ keys: ["?"], action: "This help" },
];

export function ShortcutsHelpModal({ open, onClose }: ShortcutsHelpModalProps) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
			onClick={onClose}
		>
			<div
				className="w-[400px] max-w-[90vw] bg-card rounded-2xl shadow-2xl border border-border overflow-hidden animate-scale-in"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="px-5 py-4 border-b border-border flex items-center justify-between">
					<div className="flex items-center gap-2.5">
						<div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
							<Keyboard className="w-4 h-4" />
						</div>
						<h3 className="text-[15px] font-semibold text-foreground">
							Keyboard Shortcuts
						</h3>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-all"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				{/* List */}
				<div className="px-5 py-3 space-y-1 max-h-[60vh] overflow-y-auto">
					{shortcuts.map((s, i) => (
						<div key={i} className="flex items-center justify-between py-1.5">
							<span className="text-[13px] text-foreground">{s.action}</span>
							<div className="flex items-center gap-1 shrink-0">
								{s.keys.map((k, j) => (
									<span key={j}>
										{k === "↑" || k === "↓" ? (
											<span className="inline-flex items-center justify-center min-w-[28px] h-6 px-1 rounded-md bg-muted border border-border text-[11px] font-medium text-muted-foreground">
												{k}
											</span>
										) : (
											<span className="inline-flex items-center justify-center min-w-[28px] h-6 px-1.5 rounded-md bg-muted border border-border text-[11px] font-medium text-muted-foreground">
												{k}
											</span>
										)}
									</span>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
