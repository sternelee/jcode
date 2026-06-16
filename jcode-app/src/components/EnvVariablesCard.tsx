import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "@/components/ui/badge";
import type { EnvFileInfo } from "@/types";
import {
	ChevronDown,
	ChevronRight,
	Eye,
	EyeOff,
	Pencil,
	Plus,
	Save,
	Trash2,
} from "lucide-react";

export function EnvVariablesCard() {
	const [envFiles, setEnvFiles] = useState<EnvFileInfo[]>([]);
	const [expandedFile, setExpandedFile] = useState<string | null>(null);
	const [revealed, setRevealed] = useState<Record<string, boolean>>({});
	const [editing, setEditing] = useState<{
		fileName: string;
		key: string;
		value: string;
		isNew: boolean;
	} | null>(null);
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState<string | null>(null);

	const loadEnvFiles = useCallback(async () => {
		try {
			const files = await invoke<EnvFileInfo[]>("list_env_files");
			setEnvFiles(files);
		} catch {
			setEnvFiles([]);
		}
	}, []);

	useEffect(() => {
		void loadEnvFiles();
	}, [loadEnvFiles]);

	const showStatus = useCallback((message: string) => {
		setStatus(message);
		window.setTimeout(() => setStatus(null), 3000);
	}, []);

	const saveValue = useCallback(
		async (fileName: string, key: string, value: string, isNew: boolean) => {
			if (!key.trim()) return;
			setSaving(true);
			try {
				await invoke("set_env_value", {
					fileName,
					key: key.trim(),
					value: value.trim() || null,
				});
				await loadEnvFiles();
				setEditing(null);
				showStatus(isNew ? "Variable added" : "Variable saved");
			} catch {
				showStatus("Failed to save variable");
			} finally {
				setSaving(false);
			}
		},
		[loadEnvFiles, showStatus],
	);

	const deleteValue = useCallback(
		async (fileName: string, key: string) => {
			setSaving(true);
			try {
				await invoke("set_env_value", { fileName, key, value: null });
				await loadEnvFiles();
				setEditing(null);
				showStatus("Variable deleted");
			} catch {
				showStatus("Failed to delete variable");
			} finally {
				setSaving(false);
			}
		},
		[loadEnvFiles, showStatus],
	);


	return (
		<div className="space-y-2">
			{status && (
				<div className="text-[11px] text-muted-foreground">{status}</div>
			)}
			{envFiles.length === 0 && (
				<div className="text-xs text-muted-foreground">No env files found.</div>
			)}
			{envFiles.map((file) => {
				const expanded = expandedFile === file.file_name;
				const editingNew =
					editing?.fileName === file.file_name && editing.isNew;
				return (
					<div
						key={file.file_name}
						className="rounded-lg border border-border bg-muted/20 overflow-hidden"
					>
						<button
							type="button"
							onClick={() =>
								setExpandedFile(expanded ? null : file.file_name)
							}
							className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition-colors"
						>
							<span className="text-[12px] font-medium text-foreground">
								{file.file_name}
							</span>
							<div className="flex items-center gap-2">
								<Badge variant="outline" className="text-[10px]">
									{file.entries.length}
								</Badge>
								{expanded ? (
									<ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
								) : (
									<ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
								)}
							</div>
						</button>
						{expanded && (
							<div className="px-3 pb-3 space-y-2">
								{file.entries.map((entry) => {
									const editingEntry =
										editing?.fileName === file.file_name &&
										editing.key === entry.key &&
										!editing.isNew;
											const isRevealed = revealed[`${file.file_name}:${entry.key}`];
									return (
										<div
											key={entry.key}
											className="flex items-center justify-between gap-2 text-[12px]"
										>
											{editingEntry ? (
												<div className="flex-1 flex flex-col gap-1">
													<span className="font-medium text-foreground">
														{entry.key}
													</span>
													<input
														type={isRevealed ? "text" : "password"}
														value={editing.value}
														onChange={(e) =>
															setEditing((prev) =>
																prev
																	? { ...prev, value: e.target.value }
																	: null,
															)
														}
														className="w-full h-8 px-2 rounded-md bg-background border border-border text-foreground text-[12px] outline-none focus:border-primary/50"
														placeholder="Value"
														disabled={saving}
													/>
													<div className="flex items-center gap-1">
														<button
															type="button"
															disabled={saving}
															onClick={() =>
																void saveValue(
																	file.file_name,
																	entry.key,
																	editing.value,
																	false,
																)
															}
															className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
														>
															<Save className="w-3 h-3" /> Save
														</button>
														<button
															type="button"
															disabled={saving}
															onClick={() => setEditing(null)}
															className="h-7 px-2 rounded-md border border-border bg-background text-foreground text-[11px] font-medium hover:bg-muted disabled:opacity-50"
														>
															Cancel
														</button>
													</div>
												</div>
											) : (
												<>
													<span className="font-medium text-foreground shrink-0">
														{entry.key}
													</span>
													<span className="text-muted-foreground truncate flex-1 font-mono">
														{isRevealed ? entry.value : "••••••••"}
													</span>
													<div className="flex items-center gap-0.5 shrink-0">
														<button
															type="button"
															onClick={() =>
																setRevealed((prev) => ({
																	...prev,
																	[`${file.file_name}:${entry.key}`]:
																		!prev[`${file.file_name}:${entry.key}`],
																}))
															}
															className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
														>
															{isRevealed ? (
																<EyeOff className="w-3.5 h-3.5" />
															) : (
																<Eye className="w-3.5 h-3.5" />
															)}
														</button>
														<button
															type="button"
															onClick={() =>
																setEditing({
																	fileName: file.file_name,
																	key: entry.key,
																	value: entry.value,
																	isNew: false,
																})
															}
															className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
														>
															<Pencil className="w-3.5 h-3.5" />
														</button>
														<button
															type="button"
															onClick={() =>
																void deleteValue(file.file_name, entry.key)
															}
															className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
														>
															<Trash2 className="w-3.5 h-3.5" />
														</button>
													</div>
												</>
											)}
										</div>
									);
								})}
								{editingNew ? (
									<div className="flex flex-col gap-1 pt-1 border-t border-border">
										<input
											type="text"
											value={editing.key}
											onChange={(e) =>
												setEditing((prev) =>
													prev
														? { ...prev, key: e.target.value }
														: null,
												)
											}
											className="w-full h-8 px-2 rounded-md bg-background border border-border text-foreground text-[12px] outline-none focus:border-primary/50"
											placeholder="Variable name"
											disabled={saving}
										/>
										<input
											type="text"
											value={editing.value}
											onChange={(e) =>
												setEditing((prev) =>
													prev
														? { ...prev, value: e.target.value }
														: null,
												)
											}
											className="w-full h-8 px-2 rounded-md bg-background border border-border text-foreground text-[12px] outline-none focus:border-primary/50"
											placeholder="Value"
											disabled={saving}
										/>
										<div className="flex items-center gap-1">
											<button
												type="button"
												disabled={saving || !editing.key.trim()}
												onClick={() =>
													void saveValue(
														file.file_name,
														editing.key,
														editing.value,
														true,
													)
												}
												className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
											>
												<Plus className="w-3 h-3" /> Add
											</button>
											<button
												type="button"
												disabled={saving}
												onClick={() => setEditing(null)}
												className="h-7 px-2 rounded-md border border-border bg-background text-foreground text-[11px] font-medium hover:bg-muted disabled:opacity-50"
											>
												Cancel
											</button>
										</div>
									</div>
								) : (
									<button
										type="button"
										onClick={() =>
											setEditing({
												fileName: file.file_name,
												key: "",
												value: "",
												isNew: true,
											})
										}
										className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
									>
										<Plus className="w-3.5 h-3.5" /> Add variable
									</button>
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
