import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Custom macOS-style title bar for the workbench window. Renders three
 * traffic-light buttons (close, minimize, maximize) on the left, plus a
 * draggable region spanning the rest of the bar. We need this because
 * the workbench runs with `decorations: false` + `transparent: true` so
 * the whole window can be rounded.
 *
 * Tauri's `data-tauri-drag-region` is opt-in: only elements that carry
 * the attribute are draggable. We deliberately put the attribute on a
 * sibling <div> of the button group so the buttons themselves stay
 * clickable; otherwise the OS would treat the click as the start of a
 * window drag.
 */
export function TitleBar() {
	const [maximized, setMaximized] = useState(false);

	// Track the maximize state so the middle/right glyphs can flip
	// between maximize (plus) and restore (overlapping squares). The
	// initial value is best-effort: we re-query on every maximize click.
	useEffect(() => {
		const win = getCurrentWebviewWindow();
		void win.isMaximized().then(setMaximized).catch(() => undefined);
	}, []);

	const handleClose = useCallback(() => {
		void invoke("hide_workbench");
	}, []);

	const handleMinimize = useCallback(() => {
		void getCurrentWebviewWindow().minimize();
	}, []);

	const handleMaximize = useCallback(async () => {
		const win = getCurrentWebviewWindow();
		await win.toggleMaximize();
		try {
			const next = await win.isMaximized();
			setMaximized(next);
		} catch {
			// ignore — worst case the icon stays in its previous state
		}
	}, []);

	return (
		<div
			data-tauri-drag-region
			className="relative h-7 w-full select-none border-b border-border/40 bg-background/40 backdrop-blur-sm"
		>
			{/* Buttons sit OUTSIDE the drag region so a click never
			    becomes the start of a window drag. We position them
			    absolutely so the drag region (the rest of the bar) is
			    unobstructed and reaches all the way to the left edge
			    under them. */}
			<div className="absolute left-3 top-0 z-10 flex h-7 items-center gap-2">
				<button
					type="button"
					aria-label="Close window"
					title="Close"
					onClick={handleClose}
					className="group/btn flex h-3 w-3 items-center justify-center rounded-full bg-[#ff5f57] hover:brightness-90 active:brightness-75"
				>
					<X className="h-2 w-2 text-[#7a0010] opacity-0 group-hover/btn:opacity-100" />
				</button>
				<button
					type="button"
					aria-label="Minimize window"
					title="Minimize"
					onClick={handleMinimize}
					className="group/btn flex h-3 w-3 items-center justify-center rounded-full bg-[#febc2e] hover:brightness-90 active:brightness-75"
				>
					<Minus className="h-2 w-2 text-[#7a4a00] opacity-0 group-hover/btn:opacity-100" />
				</button>
				<button
					type="button"
					aria-label={maximized ? "Restore window" : "Maximize window"}
					title={maximized ? "Restore" : "Maximize"}
					onClick={handleMaximize}
					className="group/btn flex h-3 w-3 items-center justify-center rounded-full bg-[#28c840] hover:brightness-90 active:brightness-75"
				>
					{maximized ? (
						<Square className="h-2 w-2 text-[#0a4d12] opacity-0 group-hover/btn:opacity-100" />
					) : (
						<Square className="h-2 w-2 rotate-180 text-[#0a4d12] opacity-0 group-hover/btn:opacity-100" />
					)}
				</button>
			</div>
			{/* Centered window title. Lives in its own drag region so the
			    text remains draggable without overlapping the buttons. */}
			<div
				data-tauri-drag-region
				className={cn(
					"flex h-7 items-center justify-center text-[12px] font-medium",
					"text-muted-foreground/80",
				)}
			>
				JCode
			</div>
		</div>
	);
}
