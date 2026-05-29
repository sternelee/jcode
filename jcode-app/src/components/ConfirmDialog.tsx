import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
	open: boolean;
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: "default" | "destructive";
	onConfirm: () => void;
	onCancel: () => void;
}

export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	variant = "default",
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const [visible, setVisible] = useState(open);

	useEffect(() => { setVisible(open); }, [open]);

	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		if (e.key === "Escape") onCancel();
	}, [onCancel]);

	useEffect(() => {
		if (visible) {
			document.addEventListener("keydown", handleKeyDown);
			return () => document.removeEventListener("keydown", handleKeyDown);
		}
	}, [visible, handleKeyDown]);

	if (!visible) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
			<div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} aria-hidden="true" />
			<div
				className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl"
				role="alertdialog"
				aria-modal="true"
			>
				<div className="flex items-start gap-3">
					<div className={cn(
						"w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
						variant === "destructive" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
					)}>
						{variant === "destructive" ? (
							<svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
								<path d="M4.5 2.5a.5.5 0 01.5-.5h6a.5.5 0 01.5.5V4h-7V2.5z" />
								<path d="M2 4a1 1 0 011-1h10a1 1 0 110 2H3a1 1 0 01-1-1z" />
								<path fillRule="evenodd" d="M3.5 6l.58 7.56a1 1 0 001 .94h5.84a1 1 0 001-.94L12.5 6h-9zM8 7.5a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 7.5z" clipRule="evenodd" />
							</svg>
						) : (
							<svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
								<path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-1.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0V7.25A.75.75 0 018 5.5zm0-2a.75.75 0 100 1.5.75.75 0 000-1.5z" clipRule="evenodd" />
							</svg>
						)}
					</div>
					<div className="min-w-0 flex-1">
						<h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
						<p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">{message}</p>
					</div>
				</div>
				<div className="mt-5 flex justify-end gap-2">
					<button
						type="button"
						className="px-4 py-1.5 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150"
						onClick={onCancel}
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						className={cn(
							"px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150",
							variant === "destructive"
								? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
								: "bg-primary text-primary-foreground hover:bg-primary/90",
						)}
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
