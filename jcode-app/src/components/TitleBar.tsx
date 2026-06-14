import { useCallback, useEffect, useState, type PointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Minus, Square, X } from "lucide-react";

/**
 * Custom macOS-style title bar for the workbench window. The window runs
 * with `decorations: false` + `transparent: true`, so we draw the three
 * traffic-light buttons ourselves and implement dragging via Rust's
 * `drag_window()` command (`Window::start_dragging()`).
 *
 * The button container stops pointer-down propagation so a click on a
 * traffic light never starts a window drag.
 */
export function TitleBar() {
	const [maximized, setMaximized] = useState(false);

	useEffect(() => {
		const win = getCurrentWebviewWindow();
		void win.isMaximized().then(setMaximized).catch(() => undefined);
	}, []);

	const handleDragStart = useCallback((e: PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		void invoke("drag_window");
	}, []);

	const handleClose = useCallback(() => {
		void invoke("hide_workbench");
	}, []);

	const handleMinimize = useCallback(() => {
		void invoke("minimize_window");
	}, []);

	const handleMaximize = useCallback(async () => {
		void invoke("toggle_maximize_window");
		try {
			const next = await getCurrentWebviewWindow().isMaximized();
			setMaximized(next);
		} catch {
			// ignore
		}
	}, []);

	return (
		<div className="relative h-7 w-full select-none border-b border-border bg-card">
			{/* Draggable layer behind the buttons. */}
			<div
				className="absolute inset-0 z-0"
				onPointerDown={handleDragStart}
				onDoubleClick={handleMaximize}
			/>
			{/* Buttons sit above the drag layer so clicks don't start a drag. */}
			<div
				className="absolute left-3 top-0 z-10 flex h-7 items-center gap-2"
				onPointerDown={(e) => e.stopPropagation()}
			>
				<button
					type="button"
					aria-label="Close window"
					title="Close"
					onClick={handleClose}
					className="group/btn flex h-5 w-5 items-center justify-center rounded-full"
				>
					<span className="flex h-3 w-3 items-center justify-center rounded-full bg-[#ff5f57] group-hover/btn:brightness-90 group-active/btn:brightness-75">
						<X className="h-2 w-2 text-[#7a0010] opacity-0 group-hover/btn:opacity-100" />
					</span>
				</button>
				<button
					type="button"
					aria-label="Minimize window"
					title="Minimize"
					onClick={handleMinimize}
					className="group/btn flex h-5 w-5 items-center justify-center rounded-full"
				>
					<span className="flex h-3 w-3 items-center justify-center rounded-full bg-[#febc2e] group-hover/btn:brightness-90 group-active/btn:brightness-75">
						<Minus className="h-2 w-2 text-[#7a4a00] opacity-0 group-hover/btn:opacity-100" />
					</span>
				</button>
				<button
					type="button"
					aria-label={maximized ? "Restore window" : "Maximize window"}
					title={maximized ? "Restore" : "Maximize"}
					onClick={handleMaximize}
					className="group/btn flex h-5 w-5 items-center justify-center rounded-full"
				>
					<span className="flex h-3 w-3 items-center justify-center rounded-full bg-[#28c840] group-hover/btn:brightness-90 group-active/btn:brightness-75">
						{maximized ? (
							<Square className="h-2 w-2 text-[#0a4d12] opacity-0 group-hover/btn:opacity-100" />
						) : (
							<Square className="h-2 w-2 rotate-180 text-[#0a4d12] opacity-0 group-hover/btn:opacity-100" />
						)}
					</span>
				</button>
			</div>
			{/* Centered window title, non-interactive. */}
			<div className="pointer-events-none absolute inset-0 z-[5] flex h-7 items-center justify-center text-[12px] font-medium text-muted-foreground/80">
        JFlow
			</div>
		</div>
	);
}
