import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Info, Trash2 } from "lucide-react";

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

	useEffect(() => {
		setVisible(open);
	}, [open]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		},
		[onCancel],
	);

	useEffect(() => {
		if (visible) {
			document.addEventListener("keydown", handleKeyDown);
			return () => document.removeEventListener("keydown", handleKeyDown);
		}
	}, [visible, handleKeyDown]);

	if (!visible) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
			<div
				className="fixed inset-0 bg-black/40 backdrop-blur-sm"
				onClick={onCancel}
				aria-hidden="true"
			/>
			<div
				className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl"
				role="alertdialog"
				aria-modal="true"
			>
				<div className="flex items-start gap-3">
					<div
						className={cn(
							"w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
							variant === "destructive"
								? "bg-destructive/10 text-destructive"
								: "bg-primary/10 text-primary",
						)}
					>
						{variant === "destructive" ? <Trash2 className="w-4 h-4" /> : <Info className="w-4 h-4" />}
					</div>
					<div className="min-w-0 flex-1">
						<h2 className="text-[15px] font-semibold text-foreground">
							{title}
						</h2>
						<p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
							{message}
						</p>
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
