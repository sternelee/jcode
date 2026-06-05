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
} from "lucide-react";

export function SkillsPage() {
	const [skills, setSkills] = useState<SkillInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [reloading, setReloading] = useState(false);
	const [reloadMsg, setReloadMsg] = useState<string | null>(null);

	const fetchSkills = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await invoke<SkillInfo[]>("list_skills");
			setSkills(result || []);
		} catch (e) {
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
				<button
					type="button"
					onClick={handleReload}
					disabled={reloading}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
				>
					<RefreshCw
						className={cn("w-3.5 h-3.5", reloading && "animate-spin")}
					/>
					Reload All
				</button>
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
							className="rounded-xl border border-border bg-card p-4 hover:border-primary/20 transition-colors"
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
		</div>
	);
}
