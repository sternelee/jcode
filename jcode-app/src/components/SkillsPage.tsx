import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import type { SkillInfo } from "@/types";
import {
	Wrench,
	Loader2,
	RefreshCw,
	FileText,
	Search,
	X,
	AlertCircle,
	CheckCircle2,
	Tag,
	Plus,
	Pencil,
	Trash2,
} from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface SkillFormData {
	name: string;
	description: string;
	allowed_tools: string;
	content: string;
}

function skillToForm(skill: SkillInfo): SkillFormData {
	return {
		name: skill.name,
		description: skill.description,
		allowed_tools: skill.allowed_tools?.join(", ") ?? "",
		content: "",
	};
}

export function SkillsPage() {
	const [skills, setSkills] = useState<SkillInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [reloading, setReloading] = useState(false);
	const [reloadMsg, setReloadMsg] = useState<string | null>(null);

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingSkill, setEditingSkill] = useState<SkillInfo | null>(null);
	const [form, setForm] = useState<SkillFormData>({
		name: "",
		description: "",
		allowed_tools: "",
		content: "",
	});
	const [saving, setSaving] = useState(false);

	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

	const fetchSkills = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await invoke<SkillInfo[]>("list_skills");
			console.log("[SkillsPage] list_skills result:", result);
			setSkills(result || []);
		} catch (e) {
			console.error("[SkillsPage] list_skills error:", e);
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchSkills();
	}, [fetchSkills]);

	const handleReload = async () => {
		setReloading(true);
		setReloadMsg(null);
		try {
			const count = await invoke<number>("reload_skills");
			setReloadMsg(`Reloaded ${count} skill${count !== 1 ? "s" : ""}`);
			await fetchSkills();
		} catch (e) {
			setError(String(e));
		} finally {
			setReloading(false);
			setTimeout(() => setReloadMsg(null), 3000);
		}
	};

	const openAdd = () => {
		setEditingSkill(null);
		setForm({ name: "", description: "", allowed_tools: "", content: "" });
		setDialogOpen(true);
	};

	const openEdit = (skill: SkillInfo) => {
		setEditingSkill(skill);
		setForm(skillToForm(skill));
		setDialogOpen(true);
	};

	const handleSave = async () => {
		if (!form.name.trim() || !form.description.trim()) return;
		setSaving(true);
		try {
			const tools = form.allowed_tools
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean);
			await invoke("save_skill", {
				name: form.name.trim(),
				description: form.description.trim(),
				allowed_tools: tools.length > 0 ? tools : null,
				content: form.content.trim(),
			});
			setDialogOpen(false);
			await fetchSkills();
		} catch (e) {
			setError(String(e));
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (name: string) => {
		try {
			await invoke("delete_skill", { name });
			setDeleteTarget(null);
			await fetchSkills();
		} catch (e) {
			setError(String(e));
		}
	};

	const filtered = skills.filter((s) => {
		const q = search.toLowerCase();
		return (
			s.name.toLowerCase().includes(q) ||
			s.description.toLowerCase().includes(q)
		);
	});

	return (
		<div className="flex-1 flex flex-col bg-card overflow-hidden">
			{/* Header */}
			<div className="px-6 py-4 border-b border-border flex items-center gap-3 shrink-0">
				<div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
					<Wrench className="w-5 h-5" />
				</div>
				<div className="flex-1 min-w-0">
					<h1 className="text-[16px] font-semibold text-foreground">Skills</h1>
					<p className="text-[12px] text-muted-foreground">
						{skills.length} skill{skills.length !== 1 ? "s" : ""} available
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={openAdd}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
					>
						<Plus className="w-3.5 h-3.5" />
						Add
					</button>
					<button
						type="button"
						onClick={handleReload}
						disabled={reloading}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors disabled:opacity-50"
					>
						<RefreshCw
							className={cn("w-3.5 h-3.5", reloading && "animate-spin")}
						/>
						Reload All
					</button>
				</div>
			</div>

			{/* Search */}
			<div className="px-6 py-3 border-b border-border shrink-0">
				<div className="relative">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
					<input
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search skills..."
						className="w-full pl-9 pr-9 py-2 rounded-lg border border-border bg-background text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30"
					/>
					{search && (
						<button
							type="button"
							onClick={() => setSearch("")}
							className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						>
							<X className="w-3.5 h-3.5" />
						</button>
					)}
				</div>
			</div>

			{/* Reload message */}
			{reloadMsg && (
				<div className="px-6 pt-3 shrink-0">
					<div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-600 text-[12px]">
						<CheckCircle2 className="w-3.5 h-3.5" />
						{reloadMsg}
					</div>
				</div>
			)}

			{/* Content */}
			<div className="flex-1 overflow-y-auto px-6 py-4">
				{loading && skills.length === 0 && (
					<div className="flex items-center justify-center py-12">
						<Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
						<span className="ml-2 text-sm text-muted-foreground">
							Loading skills...
						</span>
					</div>
				)}

				{error && (
					<div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-[13px]">
						<AlertCircle className="w-4 h-4 shrink-0" />
						{error}
					</div>
				)}

				{!loading && filtered.length === 0 && !error && (
					<div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Wrench className="w-10 h-10 mb-3 opacity-40" />
						<p className="text-[14px] font-medium">
							{search ? "No matching skills" : "No skills found"}
						</p>
						<p className="text-[12px] mt-1 opacity-70">
							{search
								? "Try a different search term"
								: "Add skills to ~/.jcode/skills/"}
						</p>
					</div>
				)}

				<div className="grid gap-2">
					{filtered.map((skill) => (
						<div
							key={skill.name}
							className="rounded-xl border border-border bg-card p-4 hover:border-primary/20 transition-colors group"
						>
							<div className="flex items-start gap-3">
								<div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
									<FileText className="w-4 h-4" />
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 flex-wrap">
										<span className="font-medium text-[13px] text-foreground">
											{skill.name}
										</span>
										<div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
											<button
												type="button"
												onClick={() => openEdit(skill)}
												className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
												title="Edit"
											>
												<Pencil className="w-3.5 h-3.5" />
											</button>
											<button
												type="button"
												onClick={() => setDeleteTarget(skill.name)}
												className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
												title="Delete"
											>
												<Trash2 className="w-3.5 h-3.5" />
											</button>
										</div>
									</div>
									<p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
										{skill.description}
									</p>
									{skill.allowed_tools &&
										skill.allowed_tools.length > 0 && (
											<div className="flex items-center gap-1.5 mt-2 flex-wrap">
												<Tag className="w-3 h-3 text-muted-foreground shrink-0" />
												{skill.allowed_tools.map((tool) => (
													<span
														key={tool}
														className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono"
													>
														{tool}
													</span>
												))}
											</div>
										)}
									<p className="text-[10px] text-muted-foreground/60 mt-2 font-mono truncate">
										{skill.path}
									</p>
								</div>
							</div>
						</div>
					))}
				</div>
			</div>

			{/* Add/Edit Dialog */}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle className="text-[15px]">
							{editingSkill ? "Edit Skill" : "Add Skill"}
						</DialogTitle>
					</DialogHeader>
					<div className="space-y-3 py-2">
						<div className="space-y-1">
							<label className="text-[12px] font-medium text-muted-foreground">
								Name
							</label>
							<Input
								value={form.name}
								onChange={(e) => setForm({ ...form, name: e.target.value })}
								placeholder="e.g. my-skill"
								className="text-sm"
								disabled={!!editingSkill}
							/>
						</div>
						<div className="space-y-1">
							<label className="text-[12px] font-medium text-muted-foreground">
								Description
							</label>
							<Input
								value={form.description}
								onChange={(e) =>
									setForm({ ...form, description: e.target.value })
								}
								placeholder="Short description of what this skill does"
								className="text-sm"
							/>
						</div>
						<div className="space-y-1">
							<label className="text-[12px] font-medium text-muted-foreground">
								Allowed Tools (comma-separated)
							</label>
							<Input
								value={form.allowed_tools}
								onChange={(e) =>
									setForm({ ...form, allowed_tools: e.target.value })
								}
								placeholder="bash, webfetch, grep"
								className="text-sm"
							/>
						</div>
						<div className="space-y-1">
							<label className="text-[12px] font-medium text-muted-foreground">
								Content (Markdown)
							</label>
							<Textarea
								value={form.content}
								onChange={(e) =>
									setForm({ ...form, content: e.target.value })
								}
								placeholder="# Instructions\n\nDescribe what this skill does..."
								className="min-h-[120px] resize-y text-sm"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setDialogOpen(false)}
							size="sm"
						>
							Cancel
						</Button>
						<Button
							onClick={handleSave}
							disabled={
								saving || !form.name.trim() || !form.description.trim()
							}
							size="sm"
						>
							{saving ? "Saving..." : editingSkill ? "Update" : "Save"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirm */}
			<ConfirmDialog
				open={!!deleteTarget}
				title="Delete Skill"
				message={`Are you sure you want to delete "${deleteTarget}"?`}
				confirmLabel="Delete"
				variant="destructive"
				onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
				onCancel={() => setDeleteTarget(null)}
			/>
		</div>
	);
}
