import { useState, useEffect, useCallback } from "react";

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

	const confirmButtonClass =
		variant === "destructive"
			? "bg-red-600 hover:bg-red-700 text-white"
			: "bg-blue-600 hover:bg-blue-700 text-white";

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			{/* Backdrop */}
			<div
				className="fixed inset-0 bg-black/50"
				onClick={onCancel}
				aria-hidden="true"
			/>
			{/* Dialog */}
			<div
				className="relative z-10 w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="confirm-title"
				aria-describedby="confirm-message"
			>
				<h2 id="confirm-title" className="text-lg font-semibold text-zinc-100">
					{title}
				</h2>
				<p id="confirm-message" className="mt-2 text-sm text-zinc-400">
					{message}
				</p>
				<div className="mt-6 flex justify-end gap-3">
					<button
						className="rounded-md px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
						onClick={onCancel}
					>
						{cancelLabel}
					</button>
					<button
						className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${confirmButtonClass}`}
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
