import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Columns2, Rows3 } from "lucide-react";

interface DiffLine {
	type: "context" | "add" | "remove" | "header" | "hunk";
	oldLineNum?: number;
	newLineNum?: number;
	content: string;
}

interface DiffHunk {
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	lines: DiffLine[];
}

interface DiffFile {
	oldFile?: string;
	newFile?: string;
	hunks: DiffHunk[];
}

function parseUnifiedDiff(text: string): DiffFile[] {
	const files: DiffFile[] = [];
	let currentFile: DiffFile | null = null;
	let currentHunk: DiffHunk | null = null;

	const lines = text.split("\n");
	let oldLine = 0;
	let newLine = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// File header: --- a/oldfile
		if (line.startsWith("--- ")) {
			if (currentFile) files.push(currentFile);
			currentFile = { oldFile: line.slice(4), hunks: [] };
			continue;
		}

		// File header: +++ b/newfile
		if (line.startsWith("+++ ")) {
			if (currentFile) currentFile.newFile = line.slice(4);
			continue;
		}

		// Diff without ---/+++ headers (e.g. raw patch output)
		if (line.startsWith("diff --git ")) {
			if (currentFile) files.push(currentFile);
			currentFile = { hunks: [] };
			continue;
		}

		if (line.startsWith("index ")) continue;
		if (line.startsWith("@@")) {
			if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
			const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
			if (match) {
				oldLine = parseInt(match[1], 10);
				newLine = parseInt(match[3], 10);
				currentHunk = {
					oldStart: oldLine,
					oldCount: parseInt(match[2] || "1", 10),
					newStart: newLine,
					newCount: parseInt(match[4] || "1", 10),
					lines: [],
				};
			} else {
				currentHunk = {
					oldStart: 0,
					oldCount: 0,
					newStart: 0,
					newCount: 0,
					lines: [],
				};
			}
			continue;
		}

		if (!currentHunk) {
			// Lines before first hunk — treat as header
			if (currentFile) {
				// skip
			}
			continue;
		}

		if (line.startsWith("+")) {
			currentHunk.lines.push({
				type: "add",
				newLineNum: newLine,
				content: line.slice(1),
			});
			newLine++;
		} else if (line.startsWith("-")) {
			currentHunk.lines.push({
				type: "remove",
				oldLineNum: oldLine,
				content: line.slice(1),
			});
			oldLine++;
		} else {
			currentHunk.lines.push({
				type: "context",
				oldLineNum: oldLine,
				newLineNum: newLine,
				content: line.startsWith(" ") ? line.slice(1) : line,
			});
			oldLine++;
			newLine++;
		}
	}

	if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
	if (currentFile) files.push(currentFile);

	return files;
}

export function looksLikeDiff(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.startsWith("diff --git ")) return true;
	if (trimmed.startsWith("--- ")) return true;
	if (trimmed.startsWith("@@")) return true;
	if (/^\+{3}\s/.test(trimmed)) return true;
	if (/^-{3}\s/.test(trimmed)) return true;
	// Check for a mix of +/- lines with context
	const lines = trimmed.split("\n").slice(0, 30);
	const plus = lines.filter((l) => l.startsWith("+")).length;
	const minus = lines.filter((l) => l.startsWith("-")).length;
	return plus >= 2 && minus >= 2;
}

interface InlineDiffRowProps {
	line: DiffLine;
}

function InlineDiffRow({ line }: InlineDiffRowProps) {
	return (
		<div
			className={cn(
				"flex items-start gap-2 text-[11px] font-mono leading-relaxed",
				line.type === "add" && "bg-emerald-500/10",
				line.type === "remove" && "bg-red-500/10",
				line.type === "context" && "bg-transparent",
			)}
		>
			<div className="flex items-start gap-1 min-w-0">
				<span
					className={cn(
						"w-3 shrink-0 text-center select-none",
						line.type === "add" && "text-emerald-600",
						line.type === "remove" && "text-red-600",
						line.type === "context" && "text-muted-foreground",
					)}
				>
					{line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
				</span>
				<span
					className={cn(
						"w-8 text-right shrink-0 text-muted-foreground select-none",
						line.type === "add" && "opacity-50",
					)}
				>
					{line.oldLineNum ?? ""}
				</span>
				<span
					className={cn(
						"w-8 text-right shrink-0 text-muted-foreground select-none",
						line.type === "remove" && "opacity-50",
					)}
				>
					{line.newLineNum ?? ""}
				</span>
			</div>
			<code className="break-all whitespace-pre-wrap text-foreground min-w-0">
				{line.content || " "}
			</code>
		</div>
	);
}

interface SideBySideDiffProps {
	file: DiffFile;
}

function SideBySideDiff({ file }: SideBySideDiffProps) {
	// Build aligned left/right rows without mutating the parsed hunks.
	const rows: { left?: DiffLine; right?: DiffLine }[] = [];

	for (const hunk of file.hunks) {
		let i = 0;
		while (i < hunk.lines.length) {
			const line = hunk.lines[i];
			if (line.type === "context") {
				rows.push({ left: line, right: line });
				i++;
			} else if (line.type === "remove") {
				const next = hunk.lines[i + 1];
				if (next && next.type === "add") {
					rows.push({ left: line, right: next });
					i += 2;
				} else {
					rows.push({ left: line });
					i++;
				}
			} else if (line.type === "add") {
				rows.push({ right: line });
				i++;
			} else {
				i++;
			}
		}
	}

	return (
		<div className="space-y-0">
			{file.oldFile && file.newFile && (
				<div className="flex items-center justify-between text-[10px] text-muted-foreground px-2 py-1 border-b border-border bg-muted/20">
					<span className="truncate">{file.oldFile}</span>
					<span className="truncate">{file.newFile}</span>
				</div>
			)}
			<div className="grid grid-cols-2 divide-x divide-border">
				<div className="overflow-x-auto">
					{rows.map((row, i) => (
						<div
							key={`l-${i}`}
							className={cn(
								"flex items-start gap-1 px-1 text-[11px] font-mono leading-relaxed",
								row.left?.type === "remove" && "bg-red-500/10",
								row.left?.type === "context" && "bg-transparent",
								!row.left && "bg-muted/10 min-h-[1.5em]",
							)}
						>
							<span className="w-6 text-right shrink-0 text-muted-foreground select-none">
								{row.left?.oldLineNum ?? ""}
							</span>
							<code className="break-all whitespace-pre-wrap min-w-0">
								{row.left ? row.left.content || " " : " "}
							</code>
						</div>
					))}
				</div>
				<div className="overflow-x-auto">
					{rows.map((row, i) => (
						<div
							key={`r-${i}`}
							className={cn(
								"flex items-start gap-1 px-1 text-[11px] font-mono leading-relaxed",
								row.right?.type === "add" && "bg-emerald-500/10",
								row.right?.type === "context" && "bg-transparent",
								!row.right && "bg-muted/10 min-h-[1.5em]",
							)}
						>
							<span className="w-6 text-right shrink-0 text-muted-foreground select-none">
								{row.right?.newLineNum ?? ""}
							</span>
							<code className="break-all whitespace-pre-wrap min-w-0">
								{row.right ? row.right.content || " " : " "}
							</code>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

interface DiffViewProps {
	text: string;
	className?: string;
}

export function DiffView({ text, className }: DiffViewProps) {
	const [mode, setMode] = useState<"inline" | "side">("inline");
	const files = useMemo(() => parseUnifiedDiff(text), [text]);

	if (files.length === 0) {
		return (
			<pre className="bg-black/30 p-2 rounded text-[10px] font-mono leading-relaxed overflow-x-auto max-h-64 overflow-y-auto text-muted-foreground">
				{text}
			</pre>
		);
	}

	return (
		<div
			className={cn("rounded border border-border overflow-hidden", className)}
		>
			<div className="flex items-center justify-between px-2 py-1 border-b border-border bg-muted/20">
				<span className="text-[10px] text-muted-foreground">
					{files.length} file{files.length === 1 ? "" : "s"} changed
				</span>
				<div className="flex items-center gap-1">
					<Button
						variant={mode === "inline" ? "secondary" : "ghost"}
						size="icon"
						className="h-6 w-6"
						onClick={() => setMode("inline")}
						title="Inline view"
					>
						<Rows3 className="w-3 h-3" />
					</Button>
					<Button
						variant={mode === "side" ? "secondary" : "ghost"}
						size="icon"
						className="h-6 w-6"
						onClick={() => setMode("side")}
						title="Side-by-side view"
					>
						<Columns2 className="w-3 h-3" />
					</Button>
				</div>
			</div>
			<div className="max-h-80 overflow-y-auto">
				{mode === "inline" ? (
					<div className="space-y-0">
						{files.map((file, fileIdx) => (
							<div
								key={fileIdx}
								className="border-b border-border last:border-b-0"
							>
								{file.oldFile && file.newFile && (
									<div className="text-[10px] text-muted-foreground px-2 py-1 bg-muted/20 truncate">
										{file.oldFile} → {file.newFile}
									</div>
								)}
								{file.hunks.map((hunk, hunkIdx) => (
									<div key={hunkIdx}>
										<div className="text-[10px] text-muted-foreground px-2 py-0.5 bg-muted/10 font-mono">
											@@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},
											{hunk.newCount} @@
										</div>
										{hunk.lines.map((line, lineIdx) => (
											<InlineDiffRow
												key={`${fileIdx}-${hunkIdx}-${lineIdx}`}
												line={line}
											/>
										))}
									</div>
								))}
							</div>
						))}
					</div>
				) : (
					<div className="space-y-0">
						{files.map((file, fileIdx) => (
							<div
								key={fileIdx}
								className="border-b border-border last:border-b-0"
							>
								<SideBySideDiff file={file} />
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

export function maybeRenderDiff(text: string): React.ReactNode | null {
	if (!looksLikeDiff(text)) return null;
	return <DiffView text={text} />;
}
