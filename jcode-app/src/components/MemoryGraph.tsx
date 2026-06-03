import { useMemo, useState, useCallback } from "react";
import type { GraphNode, GraphEdge } from "@/types";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface MemoryGraphProps {
	nodes: GraphNode[];
	edges: GraphEdge[];
	loading?: boolean;
	className?: string;
}

const VIEWBOX = 600;
const CENTER = VIEWBOX / 2;
const RADIUS = VIEWBOX * 0.38;
const NODE_RADIUS_MIN = 4;
const NODE_RADIUS_MAX = 14;

function nodeRadius(degree: number): number {
	const scaled = Math.sqrt(Math.max(0, degree));
	return Math.min(NODE_RADIUS_MAX, NODE_RADIUS_MIN + scaled * 1.4);
}

function nodeColor(node: GraphNode): string {
	if (!node.is_active)
		return "fill-muted-foreground/30 stroke-muted-foreground/30";
	if (node.kind === "tag")
		return "fill-muted-foreground/60 stroke-muted-foreground/60";
	if (node.kind === "cluster") return "fill-accent stroke-accent";
	return "fill-primary stroke-primary";
}

function edgeColor(kind: string): string {
	switch (kind) {
		case "has_tag":
			return "stroke-muted-foreground/40";
		case "supersedes":
			return "stroke-amber-500/60";
		case "contradicts":
			return "stroke-red-500/60";
		case "relates_to":
			return "stroke-primary/50";
		case "in_cluster":
			return "stroke-accent/50";
		case "derived_from":
			return "stroke-emerald-500/60";
		default:
			return "stroke-border";
	}
}

interface PositionedNode extends GraphNode {
	x: number;
	y: number;
	r: number;
}

function layoutNodes(nodes: GraphNode[]): PositionedNode[] {
	const n = nodes.length;
	if (n === 0) return [];
	// Deterministic circle layout — no jitter on re-render.
	// Match TUI's stable-layout principle (graph_topology.rs uses sorted keys).
	return nodes
		.map((node, i) => {
			const angle = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
			return {
				...node,
				x: CENTER + RADIUS * Math.cos(angle),
				y: CENTER + RADIUS * Math.sin(angle),
				r: nodeRadius(node.degree),
			};
		})
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function MemoryGraph({
	nodes,
	edges,
	loading = false,
	className,
}: MemoryGraphProps) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	const positioned = useMemo(() => layoutNodes(nodes), [nodes]);
	const idIndex = useMemo(() => {
		const map = new Map<string, PositionedNode>();
		for (const node of positioned) map.set(node.id, node);
		return map;
	}, [positioned]);

	const selected = selectedId ? idIndex.get(selectedId) ?? null : null;

	const handleBackgroundClick = useCallback(() => {
		setSelectedId(null);
	}, []);

	const handleNodeClick = useCallback((id: string) => {
		setSelectedId((prev) => (prev === id ? null : id));
	}, []);

	if (loading) {
		return (
			<div
				className={cn(
					"flex items-center justify-center gap-2 py-8 text-[13px] text-muted-foreground",
					className,
				)}
			>
				<Spinner className="size-4" />
				Loading graph…
			</div>
		);
	}

	if (positioned.length === 0) {
		return (
			<div
				className={cn(
					"flex items-center justify-center py-8 text-[13px] text-muted-foreground",
					className,
				)}
			>
				No memories yet — the graph will appear here once memories are stored.
			</div>
		);
	}

	const shouldLabel = (node: PositionedNode) => node.degree >= 2;

	return (
		<div className={cn("space-y-3", className)}>
			<div className="relative w-full">
				<svg
					viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
					className="w-full h-auto aspect-square max-h-[420px] rounded-lg border border-border bg-muted/10"
					role="img"
					aria-label="Memory graph visualization"
					onClick={handleBackgroundClick}
				>
					<g>
						{edges.map((edge, idx) => {
							const src = idIndex.get(nodes[edge.source]?.id ?? "");
							const tgt = idIndex.get(nodes[edge.target]?.id ?? "");
							if (!src || !tgt) return null;
							const isHighlighted =
								hoveredId &&
								(src.id === hoveredId || tgt.id === hoveredId);
							return (
								<line
									key={`edge-${idx}`}
									x1={src.x}
									y1={src.y}
									x2={tgt.x}
									y2={tgt.y}
									className={cn(
										edgeColor(edge.kind),
										"transition-opacity",
										hoveredId && !isHighlighted ? "opacity-30" : "opacity-90",
									)}
									strokeWidth={isHighlighted ? 1.6 : 0.8}
									strokeLinecap="round"
								/>
							);
						})}
					</g>

					<g>
						{positioned.map((node) => {
							const isSelected = selectedId === node.id;
							const isHovered = hoveredId === node.id;
							return (
								<g
									key={node.id}
									onMouseEnter={() => setHoveredId(node.id)}
									onMouseLeave={() =>
										setHoveredId((cur) => (cur === node.id ? null : cur))
									}
									onClick={(e) => {
										e.stopPropagation();
										handleNodeClick(node.id);
									}}
									className="cursor-pointer"
								>
									<title>
										{node.label}
										{node.kind ? ` — ${node.kind}` : ""}
										{typeof node.confidence === "number"
											? ` (confidence ${(node.confidence * 100).toFixed(0)}%)`
											: ""}
									</title>
									<circle
										cx={node.x}
										cy={node.y}
										r={node.r}
										className={cn(
											nodeColor(node),
											"transition-all",
											isSelected
												? "[stroke-width:3px] opacity-100"
												: isHovered
													? "[stroke-width:2px] opacity-100"
													: "[stroke-width:1px]",
										)}
									/>
									{shouldLabel(node) && (
										<text
											x={node.x + node.r + 4}
											y={node.y + 3}
											className={cn(
												"fill-foreground/80 text-[10px] font-medium pointer-events-none select-none",
												hoveredId && hoveredId !== node.id
													? "opacity-40"
													: "opacity-100",
											)}
										>
											{truncateLabel(node.label)}
										</text>
									)}
								</g>
							);
						})}
					</g>
				</svg>
			</div>

			<Legend />

			{selected && (
				<div className="rounded-lg border border-border bg-card p-3 space-y-1.5 text-[12px]">
					<div className="flex items-start justify-between gap-2">
						<div className="font-medium text-foreground break-words">
							{selected.label}
						</div>
						<button
							type="button"
							onClick={() => setSelectedId(null)}
							className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
						>
							Clear
						</button>
					</div>
					<div className="flex items-center gap-2 text-[11px] text-muted-foreground">
						<span className="capitalize">{selected.kind || "memory"}</span>
						<span>·</span>
						<span>{selected.degree} connection{selected.degree === 1 ? "" : "s"}</span>
						{!selected.is_active && (
							<>
								<span>·</span>
								<span className="text-amber-600 dark:text-amber-400">inactive</span>
							</>
						)}
					</div>
					{typeof selected.confidence === "number" && (
						<div className="text-[11px] text-muted-foreground">
							Confidence: {(selected.confidence * 100).toFixed(0)}%
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function truncateLabel(label: string): string {
	if (label.length <= 18) return label;
	return `${label.slice(0, 17)}…`;
}

function Legend() {
	const items: Array<{ label: string; className: string }> = [
		{ label: "Memory", className: "bg-primary" },
		{ label: "Tag", className: "bg-muted-foreground/60" },
		{ label: "Cluster", className: "bg-accent" },
		{ label: "Supersedes", className: "bg-amber-500/60" },
		{ label: "Contradicts", className: "bg-red-500/60" },
		{ label: "Relates", className: "bg-primary/50" },
	];
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
			{items.map((item) => (
				<div key={item.label} className="flex items-center gap-1.5">
					<span className={cn("inline-block h-2 w-3 rounded-sm", item.className)} />
					{item.label}
				</div>
			))}
		</div>
	);
}
