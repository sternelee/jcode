import type { ToolExecution } from "@/types";
import { cn } from "@/lib/utils";
import { Loader2, Check, X } from "lucide-react";
import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { DiffView, looksLikeDiff } from "./DiffView";

interface ToolCardProps {
	tool: ToolExecution;
}

export function ToolCard({ tool }: ToolCardProps) {
	return (
		<motion.div
			initial={{ opacity: 0, y: 6 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.15, ease: "easeOut" }}
			className={cn(
				"border rounded-lg p-3 text-xs",
				tool.status === "done" && "border-primary/30 bg-primary/5",
				tool.status === "error" && "border-destructive/30 bg-destructive/5",
				"border-muted/50 bg-muted/20",
			)}
		>
			<div className="flex items-center gap-2">
				{tool.status === "starting" ||
				tool.status === "collecting_input" ||
				tool.status === "executing" ? (
					<Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
				) : tool.status === "done" ? (
					<Check className="w-3.5 h-3.5 text-primary" />
				) : tool.status === "error" ? (
					<X className="w-3.5 h-3.5 text-destructive" />
				) : null}
				<span className="font-semibold font-mono text-foreground">
					{tool.name}
				</span>
				<span className="ml-auto text-[10px] text-muted-foreground uppercase">
					{tool.status === "starting"
						? "starting"
						: tool.status === "collecting_input"
							? "preparing"
							: tool.status === "executing"
								? "running"
								: tool.status === "done"
									? "done"
									: "failed"}
				</span>
			</div>
			{tool.input && (
				<details className="mt-2">
					<summary className="cursor-pointer text-muted-foreground text-[11px] mb-1">
						input
					</summary>
					<pre className="bg-black/30 p-2 rounded text-[10px] font-mono leading-relaxed overflow-x-auto max-h-32 overflow-y-auto text-muted-foreground">
						{tool.input.length > 2000
							? tool.input.slice(0, 2000) +
							  `\n... (${tool.input.length - 2000} more)`
							: tool.input}
					</pre>
				</details>
			)}
			<ToolOutput tool={tool} />
			{tool.error && (
				<p className="mt-2 text-destructive text-[11px]">{tool.error}</p>
			)}
		</motion.div>
	);
}

function ToolOutput({ tool }: { tool: ToolExecution }) {
	const [isOpen, setIsOpen] = useState(() => looksLikeDiff(tool.output ?? ""));

	useEffect(() => {
		if (tool.output && looksLikeDiff(tool.output)) {
			setIsOpen(true);
		}
	}, [tool.output]);

	if (!tool.output) return null;

	return (
		<details
			className="mt-1"
			open={isOpen}
			onToggle={(e) => setIsOpen(e.currentTarget.open)}
		>
			<summary className="cursor-pointer text-muted-foreground text-[11px] mb-1">
				output
			</summary>
			{looksLikeDiff(tool.output) ? (
				<DiffView text={tool.output} />
			) : (
				<pre className="bg-black/30 p-2 rounded text-[10px] font-mono leading-relaxed overflow-x-auto max-h-32 overflow-y-auto text-muted-foreground">
					{tool.output.length > 2000
						? tool.output.slice(0, 2000) +
						  `\n... (${tool.output.length - 2000} more)`
						: tool.output}
				</pre>
			)}
		</details>
	);
}
