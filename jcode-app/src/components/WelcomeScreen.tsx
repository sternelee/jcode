import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import type {
	ExternalAuthCandidate,
	ExternalAuthCandidatesResult,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
	Bot,
	ShieldCheck,
	ArrowRight,
	Loader2,
	CheckCircle2,
	Globe,
	Zap,
} from "lucide-react";

interface WelcomeScreenProps {
	onComplete: (model?: string, providerId?: string) => void;
	availableModels: string[];
}

type WelcomePhase = "welcome" | "import" | "model" | "ready";

export function WelcomeScreen({
	onComplete,
	availableModels,
}: WelcomeScreenProps) {
	const [phase, setPhase] = useState<WelcomePhase>("welcome");
	const [externalCandidates, setExternalCandidates] = useState<
		ExternalAuthCandidate[]
	>([]);
	const [importBusy, setImportBusy] = useState<number | null>(null);
	const [importedCount, setImportedCount] = useState(0);
	const [importedIndices, setImportedIndices] = useState<Set<number>>(
		new Set(),
	);
	const [importError, setImportError] = useState<string | null>(null);
	const [selectedModel, setSelectedModel] = useState<string | null>(null);
	const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const loadExternalAuth = useCallback(async () => {
		try {
			const result = await invoke<ExternalAuthCandidatesResult>(
				"get_external_auth_candidates",
			);
			setExternalCandidates(result.candidates);
		} catch {
			/* ignore */
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadExternalAuth();
	}, [loadExternalAuth]);

	const importExternalAuth = async (index: number) => {
		setImportBusy(index);
		setImportError(null);
		try {
			const result = await invoke<{
				imported: boolean;
				provider: string;
				detail: string;
			}>("approve_external_auth_candidate", { index });
			if (result.imported) {
				setImportedCount((c) => c + 1);
				setImportedIndices((prev) => new Set(prev).add(index));
			}
		} catch (e) {
			setImportError(String(e));
		} finally {
			setImportBusy(null);
		}
	};

	const skipImport = () => {
		setPhase("model");
	};

	const finishImport = () => {
		setPhase("model");
	};

	const selectModel = (model: string, provider: string) => {
		setSelectedModel(model);
		setSelectedProvider(provider);
		setPhase("ready");
	};

	const deriveProviderFromModel = useCallback((model: string): string => {
		const slash = model.indexOf("/");
		if (slash > 0) return model.slice(0, slash);
		if (model.toLowerCase().startsWith("gpt") || model.toLowerCase().includes("openai")) return "openai";
		if (model.toLowerCase().includes("claude")) return "anthropic";
		if (model.toLowerCase().includes("gemini")) return "google";
		return "default";
	}, []);

	const [modelSearch, setModelSearch] = useState("");

	const filteredModels = useMemo(() => {
		const unique = Array.from(new Set(availableModels));
		const q = modelSearch.trim().toLowerCase();
		if (!q) return unique;
		return unique.filter((m) => m.toLowerCase().includes(q));
	}, [availableModels, modelSearch]);

	const handleComplete = () => {
		onComplete(selectedModel || undefined, selectedProvider || undefined);
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="flex items-center justify-center h-full bg-background p-6">
			<div className="w-full max-w-lg relative">
				<AnimatePresence mode="wait">
					{phase === "welcome" && (
						<motion.div
							key="welcome"
							initial={{ opacity: 0, y: 12 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -12 }}
							transition={{ duration: 0.18, ease: "easeOut" }}
							className="space-y-6 text-center"
						>
						<div className="space-y-2">
							<div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
								<Bot className="w-8 h-8 text-primary" />
							</div>
							<h1 className="text-2xl font-bold text-foreground">
								Welcome to JFlow
							</h1>
							<p className="text-muted-foreground">
								Your AI coding assistant is ready to help.
							</p>
						</div>

						<div className="space-y-3 text-left">
							<div className="flex items-start gap-3 p-3 rounded-lg border border-border">
								<Zap className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
								<div>
									<div className="text-sm font-medium text-foreground">
										Fast & Powerful
									</div>
									<div className="text-xs text-muted-foreground">
										30+ tools for coding, git, web search, and more.
									</div>
								</div>
							</div>
							<div className="flex items-start gap-3 p-3 rounded-lg border border-border">
								<Globe className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
								<div>
									<div className="text-sm font-medium text-foreground">
										Multi-Model Support
									</div>
									<div className="text-xs text-muted-foreground">
										Use OpenAI, Anthropic, Gemini, and more.
									</div>
								</div>
							</div>
						</div>

						<Button
							className="w-full"
							onClick={() => {
								if (externalCandidates.length > 0) {
									setPhase("import");
								} else {
									setPhase("model");
								}
							}}
						>
							Get Started
							<ArrowRight className="w-4 h-4 ml-2" />
						</Button>
					</motion.div>
				)}

				{phase === "import" && (
					<motion.div
						key="import"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.18, ease: "easeOut" }}
						className="space-y-6"
					>
						<div className="space-y-2 text-center">
							<div className="w-12 h-12 mx-auto rounded-xl bg-emerald-500/10 flex items-center justify-center">
								<ShieldCheck className="w-6 h-6 text-emerald-500" />
							</div>
							<h2 className="text-xl font-bold text-foreground">
								Found Existing Logins
							</h2>
							<p className="text-sm text-muted-foreground">
								Import credentials from other tools to get started faster.
							</p>
						</div>

						<div className="space-y-2">
							{externalCandidates.map((candidate) => {
								const isImported = importedIndices.has(candidate.index);
								return (
									<div
										key={candidate.index}
										className="flex items-center justify-between p-3 rounded-lg border border-border"
									>
										<div className="min-w-0">
											<div className="text-sm font-medium text-foreground">
												{candidate.provider_summary}
											</div>
											<div className="text-xs text-muted-foreground truncate">
												via {candidate.source_name}
											</div>
										</div>
										{isImported ? (
											<Badge variant="default" className="gap-1.5">
												<CheckCircle2 className="w-3 h-3" />
												Imported
											</Badge>
										) : (
											<Button
												variant="outline"
												size="sm"
												className="gap-1.5"
												onClick={() => importExternalAuth(candidate.index)}
												disabled={importBusy !== null}
											>
												{importBusy === candidate.index ? (
													<Loader2 className="w-3 h-3 animate-spin" />
												) : (
													<CheckCircle2 className="w-3 h-3" />
												)}
												Import
											</Button>
										)}
									</div>
								);
							})}
						</div>

						{importError && (
							<div className="text-center text-sm text-destructive">
								{importError}
							</div>
						)}

						{importedCount > 0 && (
							<div className="text-center text-sm text-emerald-600">
								✓ {importedCount} login{importedCount > 1 ? "s" : ""} imported
							</div>
						)}

						<div className="flex gap-3">
							<Button variant="outline" className="flex-1" onClick={skipImport}>
								Skip
							</Button>
							<Button className="flex-1" onClick={finishImport}>
								Continue
								<ArrowRight className="w-4 h-4 ml-2" />
							</Button>
						</div>
					</motion.div>
				)}

				{phase === "model" && (
					<motion.div
						key="model"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.18, ease: "easeOut" }}
						className="space-y-6"
					>
						<div className="space-y-2 text-center">
							<h2 className="text-xl font-bold text-foreground">
								Choose a Model
							</h2>
							<p className="text-sm text-muted-foreground">
								Select your default AI model. You can change this later.
							</p>
						</div>

						<div className="space-y-2">
							<input
								type="text"
								value={modelSearch}
								onChange={(e) => setModelSearch(e.target.value)}
								placeholder="Search models..."
								className="w-full h-9 px-3 rounded-lg border border-border bg-card text-[13px] outline-none focus:border-primary/50"
							/>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
								{filteredModels.map((model) => {
									const provider = deriveProviderFromModel(model);
									return (
										<button
											key={model}
											className={cn(
												"p-3 rounded-lg border border-border text-left transition-colors",
												"hover:border-primary/50 hover:bg-primary/5",
												selectedModel === model && "border-primary bg-primary/10",
											)}
											onClick={() => selectModel(model, provider)}
										>
											<div className="text-sm font-medium text-foreground truncate">
												{model}
											</div>
											<div className="text-[10px] text-muted-foreground truncate">
												{provider}
											</div>
										</button>
									);
								})}
							</div>
							{filteredModels.length === 0 && (
								<div className="text-center text-sm text-muted-foreground py-8">
									{modelSearch.trim()
										? "No models match your search."
										: "No models available. Configure a provider in Settings first."}
								</div>
							)}
						</div>

						<Button
							variant="outline"
							className="w-full"
							onClick={() => handleComplete()}
						>
							Skip for now
						</Button>
					</motion.div>
				)}

				{phase === "ready" && (
					<motion.div
						key="ready"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.18, ease: "easeOut" }}
						className="space-y-6 text-center"
					>
						<div className="space-y-2">
							<div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/10 flex items-center justify-center">
								<CheckCircle2 className="w-8 h-8 text-emerald-500" />
							</div>
							<h2 className="text-xl font-bold text-foreground">
								You're All Set!
							</h2>
							<p className="text-muted-foreground">
								Using <Badge variant="secondary">{selectedModel}</Badge>
							</p>
						</div>

						<Button className="w-full" onClick={handleComplete}>
							Start Coding
							<ArrowRight className="w-4 h-4 ml-2" />
						</Button>
					</motion.div>
				)}
			</AnimatePresence>
			</div>
		</div>
	);
}
