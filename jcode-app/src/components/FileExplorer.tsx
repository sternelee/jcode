import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, FolderOpen, File, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileExplorerProps {
	workingDir?: string | null;
}

/* Build {name, children, depth} tree from flat paths */
function buildTree(paths: string[]): TreeNode[] {
	const root: Record<string, any> = {};
	for (const p of paths) {
		const parts = p.split("/");
		let node = root;
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			if (!node[part]) node[part] = {};
			node = node[part];
		}
	}
	return toNodes(root, 0);
}

interface TreeNode {
	name: string;
	children: TreeNode[];
	depth: number;
}

function toNodes(obj: Record<string, any>, depth: number): TreeNode[] {
	return Object.keys(obj)
		.sort((a, b) => {
			const aIsDir = Object.keys(obj[a]).length > 0;
			const bIsDir = Object.keys(obj[b]).length > 0;
			if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
			return a.localeCompare(b);
		})
		.map((name) => ({
			name,
			children: toNodes(obj[name], depth + 1),
			depth,
		}));
}

export function FileExplorer({ workingDir }: FileExplorerProps) {
	const [paths, setPaths] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	const fetchFiles = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const files = await invoke<string[]>("list_workspace_files", {
				workingDir: workingDir ?? null,
			});
			setPaths(files);
			setCollapsed(new Set());
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, [workingDir]);

	useEffect(() => {
		void fetchFiles();
	}, [fetchFiles]);

	const tree = useMemo(() => buildTree(paths), [paths]);

	const toggle = (key: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	if (error) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-center px-4">
				<p className="text-[12px] text-destructive">{error}</p>
				<button
					type="button"
					onClick={() => void fetchFiles()}
					className="mt-2 text-[11px] text-primary hover:underline"
				>
					Retry
				</button>
			</div>
		);
	}

	if (loading && paths.length === 0) {
		return (
			<div className="flex items-center justify-center h-full">
				<RefreshCw className="w-4 h-4 text-muted-foreground/40 animate-spin" />
			</div>
		);
	}

	if (paths.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-center px-4">
				<FolderOpen className="w-6 h-6 text-muted-foreground/20 mb-2" />
				<p className="text-[12px] text-muted-foreground/50">
					No files in workspace
				</p>
			</div>
		);
	}

	return (
		<div className="h-full min-h-0 flex flex-col overflow-hidden">
			<div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
				<span className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
					Explorer
				</span>
				<button
					type="button"
					onClick={() => void fetchFiles()}
					disabled={loading}
					className="ml-auto w-5 h-5 rounded flex items-center justify-center text-muted-foreground/30 hover:text-foreground hover:bg-muted transition-all disabled:opacity-30"
					title="Refresh"
				>
					<RefreshCw
						className={`w-3 h-3 ${loading ? "animate-spin" : ""}`}
					/>
				</button>
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-1 py-1">
				{tree.map((node) => (
					<TreeNodeItem
						key={node.name}
						node={node}
						prefix=""
						collapsed={collapsed}
						onToggle={toggle}
					/>
				))}
			</div>
		</div>
	);
}

function TreeNodeItem({
	node,
	prefix,
	collapsed,
	onToggle,
}: {
	node: TreeNode;
	prefix: string;
	collapsed: Set<string>;
	onToggle: (key: string) => void;
}) {
	const isDir = node.children.length > 0;
	const key = prefix ? `${prefix}/${node.name}` : node.name;
	const isCollapsed = collapsed.has(key);

	return (
		<div>
			<button
				type="button"
				onClick={() => isDir && onToggle(key)}
				className={cn(
					"w-full flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-all text-left",
					isDir && "font-medium",
				)}
				style={{ paddingLeft: `${8 + node.depth * 14}px` }}
			>
				{isDir ? (
					<>
						{isCollapsed ? (
							<ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/40" />
						) : (
							<ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground/40" />
						)}
						<FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-500/60" />
					</>
				) : (
					<File className="w-3.5 h-3.5 shrink-0 text-muted-foreground/40 ml-4" />
				)}
				<span className="truncate">{node.name}</span>
			</button>
			{isDir && !isCollapsed && (
				<div>
					{node.children.map((child) => (
						<TreeNodeItem
							key={child.name}
							node={child}
							prefix={key}
							collapsed={collapsed}
							onToggle={onToggle}
						/>
					))}
				</div>
			)}
		</div>
	);
}
