import { useEffect, useMemo, useRef, useState } from "react";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { A2uiSurface, basicCatalog } from "@a2ui/react/v0_9";

interface A2uiSurfaceRendererProps {
	/** Array of A2UI JSON messages (createSurface, updateComponents, updateDataModel). */
	messages: unknown[];
	/** Called when the user triggers an action (button click, etc). */
	onAction?: (action: {
		name: string;
		surfaceId: string;
		sourceComponentId: string;
		context: Record<string, unknown>;
	}) => void;
}

type ActionHandler = (action: {
	name: string;
	surfaceId: string;
	sourceComponentId: string;
	context: Record<string, unknown>;
}) => void;

/**
 * Renders an A2UI surface from a list of declarative JSON messages.
 * Creates a MessageProcessor, feeds it the messages, and renders
 * the resulting surface with the basicCatalog.
 */
export function A2uiSurfaceRenderer({
	messages,
	onAction,
}: A2uiSurfaceRendererProps) {
	const [refreshKey, setRefreshKey] = useState(0);
	const onActionRef = useRef(onAction);
	onActionRef.current = onAction;

	// Create processor once; the action handler delegates to the ref
	// so it always calls the latest onAction without recreating the processor.
	const processor = useMemo(() => {
		const handler: ActionHandler = (action) => {
			onActionRef.current?.(action);
		};
		return new MessageProcessor([basicCatalog], handler);
	}, []);

	// Process messages whenever they change
	useEffect(() => {
		if (messages.length === 0) return;
		try {
			processor.processMessages(
				messages as Parameters<typeof processor.processMessages>[0],
			);
			setRefreshKey((k) => k + 1);
		} catch (err) {
			console.error("[A2uiSurfaceRenderer] failed to process messages:", err);
		}
	}, [messages, processor]);

	// Get the first surface from the group model
	const surfaces = processor.model.surfacesMap;
	const firstSurface = surfaces.values().next().value;

	if (!firstSurface) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground/50 text-sm">
				No A2UI surface to display
			</div>
		);
	}

	return (
		<div key={refreshKey} className="h-full overflow-auto">
			<A2uiSurface surface={firstSurface} />
		</div>
	);
}
