import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFileTree, FileTree } from "@pierre/trees/react";
import { RefreshCw, FolderOpen } from "lucide-react";

interface FileExplorerProps {
	workingDir?: string | null;
}

export function FileExplorer({ workingDir }: FileExplorerProps) {
	const [paths, setPaths] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchFiles = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const files = await invoke<string[]>("list_workspace_files", {
				workingDir: workingDir ?? null,
			});
			setPaths(files);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, [workingDir]);

	useEffect(() => {
		void fetchFiles();
	}, [fetchFiles]);

	const { model } = useFileTree({
		paths,
		flattenEmptyDirectories: true,
		initialExpansion: 1,
		search: true,
	});

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
		<div className="h-full overflow-hidden flex flex-col">
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
			<div className="flex-1 overflow-hidden">
				<FileTree
					model={model}
					style={{ height: "100%", background: "transparent" }}
				/>
			</div>
		</div>
	);
}
