import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useApplications } from "./useApplications";
import type {
	AppInfo,
	BuiltinPage,
	LauncherItem,
	SavedA2uiPage,
} from "@/lib/launcherTypes";
import type { SessionInfo } from "@/types";

const AGENT_PREFIX = "ask ";

/** Substring-match a session against a lowercase query, scanning the
 * fields users typically want to search by. Empty query always matches. */
function matchesSession(session: SessionInfo, lowerQuery: string): boolean {
	if (!lowerQuery) return true;
	const fields = [
		session.title,
		session.subtitle,
		session.detail,
		session.workingDir,
		session.model,
		session.provider,
		session.providerName,
		session.providerModel,
		...(session.previewLines ?? []),
		...(session.detailLines ?? []),
	];
	for (const field of fields) {
		if (field && field.toLowerCase().includes(lowerQuery)) return true;
	}
	return false;
}
/** Simple fuzzy scorer. Returns a positive number when every query
 * character appears in `text` in order, and `0` otherwise. Matches at
 * the start of the string, after word separators, and consecutive
 * characters earn bonuses; gaps are penalized. */
function fuzzyScore(text: string, query: string): number {
	if (!query) return 0;
	const t = text.toLowerCase();
	const q = query.toLowerCase();
	let score = 0;
	let ti = 0;
	let prev = -1;
	for (let i = 0; i < q.length; i++) {
		const idx = t.indexOf(q[i], ti);
		if (idx === -1) return 0;
		score += 10;
		if (prev !== -1 && idx === prev + 1) score += 7;
		if (idx === 0) score += 8;
		if (idx > 0 && /[^a-z0-9]/.test(t[idx - 1])) score += 5;
		if (prev !== -1 && idx - prev > 1) score -= (idx - prev - 1) * 3;
		ti = idx + 1;
		prev = idx;
	}
	return Math.max(score, 1);
}

/** Best fuzzy score across the session fields the user can search by. */
function sessionScore(session: SessionInfo, query: string): number {
	const fields = [
		session.title,
		session.subtitle,
		session.detail,
		session.workingDir,
		session.model,
		session.provider,
		session.providerName,
		session.providerModel,
		...(session.previewLines ?? []),
		...(session.detailLines ?? []),
	];
	let best = 0;
	for (const field of fields) {
		if (field) best = Math.max(best, fuzzyScore(field, query));
	}
	return best;
}

const BUILTIN_COMMANDS: ReadonlyArray<{
	page: BuiltinPage;
	title: string;
	description: string;
	keyword: string;
	iconName: string;
}> = [
	{
		page: "chat",
		title: "Open Chat",
		description: "Jump to the active conversation",
		keyword: "chat conversation talk",
		iconName: "message",
	},
	{
		page: "providers",
		title: "Open Providers",
		description: "Manage API keys and authentication",
		keyword: "providers auth api keys",
		iconName: "key",
	},
	{
		page: "team",
		title: "Open Team / Swarm",
		description: "Multi-agent collaboration",
		keyword: "team swarm agents",
		iconName: "users",
	},
	{
		page: "skills",
		title: "Open Skills",
		description: "Configure agent skills",
		keyword: "skills capabilities",
		iconName: "sparkles",
	},
	{
		page: "mcp",
		title: "Open MCP",
		description: "Model Context Protocol servers",
		keyword: "mcp servers tools",
		iconName: "plug",
	},
	{
		page: "settings",
		title: "Open Settings",
		description: "App preferences and memory",
		keyword: "settings preferences",
		iconName: "settings",
	},
];
/** Best fuzzy score across a builtin's title, keyword, and page name. */
function builtinScore(
	b: { page: BuiltinPage; title: string; keyword: string },
	query: string,
): number {
	return Math.max(
		fuzzyScore(b.title, query),
		fuzzyScore(b.keyword, query),
		fuzzyScore(b.page, query),
	);
}

const AGENT_ITEM: LauncherItem = {
	kind: "agent",
	id: "agent-query-default",
	query: "",
};

const RECENT_KEY = "jcode-launcher-recent";
const FREQUENCY_KEY = "jcode-launcher-frequency";
const RECENT_LIMIT = 5;

type RecentEntry =
	| { kind: "application"; id: string; name: string; appPath: string }
	| { kind: "builtin"; id: string; page: BuiltinPage; title: string }
	| { kind: "session"; id: string; sessionId: string; title: string }
	| { kind: "a2ui"; id: string; pageId: string; title: string };

function loadRecent(): RecentEntry[] {
	try {
		const raw = localStorage.getItem(RECENT_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(entry): entry is RecentEntry =>
				typeof entry === "object" &&
				entry !== null &&
				"kind" in entry &&
				typeof (entry as { id?: unknown }).id === "string",
		);
	} catch {
		return [];
	}
}

function saveRecent(entries: RecentEntry[]) {
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_LIMIT)));
	} catch {
		// ignore quota / privacy errors
	}
}

/** Per-item usage counts. Persisted to localStorage so the launcher can
 * surface frequently-used items above one-off selections. */
type FrequencyMap = Record<string, number>;

function loadFrequency(): FrequencyMap {
	try {
		const raw = localStorage.getItem(FREQUENCY_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== "object" || parsed === null) return {};
		const out: FrequencyMap = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "number" && value > 0 && Number.isFinite(value)) {
				out[key] = value;
			}
		}
		return out;
	} catch {
		return {};
	}
}

function saveFrequency(map: FrequencyMap) {
	try {
		// Cap stored entries so the JSON doesn't grow unbounded over time.
		const entries = Object.entries(map)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 200);
		const compact = Object.fromEntries(entries);
		localStorage.setItem(FREQUENCY_KEY, JSON.stringify(compact));
	} catch {
		// ignore
	}
}

export function useLauncher() {
	const [query, setQuery] = useState("");
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [a2uiPages, setA2uiPages] = useState<SavedA2uiPage[]>([]);
	const [recent, setRecent] = useState<RecentEntry[]>(() => loadRecent());
	const [frequency, setFrequency] = useState<FrequencyMap>(() => loadFrequency());
	const [error, setError] = useState<string | null>(null);
	const applications = useApplications();

	const refreshSessions = useCallback(async () => {
		try {
			const list = await invoke<SessionInfo[]>("list_sessions");
			setSessions(list || []);
		} catch (e) {
			// The launcher is best-effort; failing to load sessions should not
			// block the rest of the palette.
			console.warn("list_sessions failed in launcher:", e);
		}
	}, []);

	const refreshA2uiPages = useCallback(async () => {
		try {
			const list = await invoke<SavedA2uiPage[]>("list_a2ui_pages");
			setA2uiPages(list || []);
		} catch {
			// best-effort
		}
	}, []);

	useEffect(() => {
		void refreshSessions();
		void refreshA2uiPages();
	}, [refreshSessions, refreshA2uiPages]);

	const recordRecent = useCallback((entry: RecentEntry) => {
		setRecent((prev) => {
			const next = [entry, ...prev.filter((item) => item.id !== entry.id)].slice(
				0,
				RECENT_LIMIT,
			);
			saveRecent(next);
			return next;
		});
	}, []);

	const recordUsage = useCallback((id: string) => {
		setFrequency((prev) => {
			const next = { ...prev, [id]: (prev[id] ?? 0) + 1 };
			saveFrequency(next);
			return next;
		});
	}, []);

	const items = useMemo<LauncherItem[]>(() => {
		const trimmed = query.trim();
		const lower = trimmed.toLowerCase();
		// Bare "ask" (no space yet) and "ask ..." both activate the agent
		// prompt. False positives like "askathon" are avoided by requiring
		// either an exact "ask" match or a space after the prefix.
		const isAgentMode = lower === "ask" || lower.startsWith(AGENT_PREFIX);

		if (isAgentMode) {
			const text = trimmed.slice(AGENT_PREFIX.length).trim();
			return [
				{
					...AGENT_ITEM,
					query: text,
				},
			];
		}

		const out: LauncherItem[] = [];
		const recentIds = new Set(recent.map((entry) => entry.id));

		// "Running" section: apps currently open on the user's Mac, but only
		// when there's no query and only for apps the user hasn't pinned via
		// the Recent list. Surfacing these first matches the typical
		// Raycast/Spotlight workflow: "I'm in app X, switch to app Y".
		if (!trimmed) {
			const recentApps = new Set(
				recent
					.filter((e): e is Extract<RecentEntry, { kind: "application" }> => e.kind === "application")
					.map((e) => e.appPath),
			);
			const runningApps = applications.apps.filter(
				(app) => app.running && !recentApps.has(app.appPath),
			);
			// Stable order: by frequency desc, then alphabetical.
			runningApps.sort((a, b) => {
				const fa = frequency[`app:${a.appPath}`] ?? 0;
				const fb = frequency[`app:${b.appPath}`] ?? 0;
				if (fa !== fb) return fb - fa;
				return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
			});
			for (const app of runningApps) {
				out.push({
					kind: "application",
					id: `running:${app.appPath}`,
					app,
				});
			}
		}

		// Recent section (only when there is no query, to surface the user's
		// most-used items).
		if (!trimmed) {
			for (const entry of recent) {
				if (entry.kind === "application") {
					// Skip if no longer in the index.
					const match = applications.apps.find(
						(app) => app.appPath === entry.appPath,
					);
					if (!match) continue;
					out.push({
						kind: "application",
						id: entry.id,
						app: match,
						recent: true,
					});
				} else if (entry.kind === "session") {
					const session = sessions.find(
						(s) => s.sessionId === entry.sessionId,
					);
					if (!session) continue;
					out.push({
						kind: "session",
						id: `session:${session.sessionId}`,
						session,
						recent: true,
					});
				} else if (entry.kind === "builtin") {
					const def = BUILTIN_COMMANDS.find((b) => b.page === entry.page);
					if (!def) continue;
					out.push({
						kind: "builtin",
						id: `builtin:${def.page}`,
						page: def.page,
						title: def.title,
						description: def.description,
						keyword: def.keyword,
						iconName: def.iconName,
						recent: true,
					});
				} else if (entry.kind === "a2ui") {
					const page = a2uiPages.find((p) => p.id === entry.pageId);
					if (!page) continue;
					out.push({
						kind: "a2ui",
						id: entry.id,
						pageId: entry.pageId,
						title: entry.title,
						recent: true,
					});
				}
			}
		}

		// Applications: the backend has already filtered/scored them, so we
		// just deduplicate against the Recent list.
		for (const app of applications.apps) {
			// Don't re-show recent apps in the main list to avoid duplicates.
			if (recentIds.has(`app:${app.appPath}`)) continue;
			out.push({
				kind: "application",
				id: `app:${app.appPath}`,
				app,
			});
		}

		// Recent sessions (no query only)
		const sessionItems: Array<Extract<LauncherItem, { kind: "session" }>> = [];
		if (!trimmed) {
			for (const session of sessions.slice(0, 5)) {
				sessionItems.push({
					kind: "session",
					id: `session:${session.sessionId}`,
					session,
				});
			}
		} else {
			for (const session of sessions) {
				if (!matchesSession(session, lower)) continue;
				sessionItems.push({
					kind: "session",
					id: `session:${session.sessionId}`,
					session,
				});
			}
			sessionItems.sort((a, b) => {
				const sa = sessionScore(a.session, lower);
				const sb = sessionScore(b.session, lower);
				if (sb !== sa) return sb - sa;
				return (a.session.title ?? "")
					.toLowerCase()
					.localeCompare((b.session.title ?? "").toLowerCase());
			});
		}
		out.push(...sessionItems);

		// Builtin commands
		const builtinItems: Array<Extract<LauncherItem, { kind: "builtin" }>> = [];
		for (const builtin of BUILTIN_COMMANDS) {
			if (
				trimmed &&
				!builtin.title.toLowerCase().includes(lower) &&
				!builtin.keyword.includes(lower) &&
				!builtin.page.toLowerCase().includes(lower)
			) {
				continue;
			}
			builtinItems.push({
				kind: "builtin",
				id: `builtin:${builtin.page}`,
				page: builtin.page,
				title: builtin.title,
				description: builtin.description,
				keyword: builtin.keyword,
				iconName: builtin.iconName,
			});
		}
		if (trimmed) {
			builtinItems.sort((a, b) => {
				const sa = builtinScore(a, lower);
				const sb = builtinScore(b, lower);
				if (sb !== sa) return sb - sa;
				return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
			});
		}
		out.push(...builtinItems);

		// A2UI saved pages
		for (const page of a2uiPages) {
			if (
				trimmed &&
				!page.title.toLowerCase().includes(lower) &&
				!(page.description ?? "").toLowerCase().includes(lower)
			) {
				continue;
			}
			out.push({
				kind: "a2ui",
				id: `a2ui:${page.id}`,
				pageId: page.id,
				title: page.title,
				description: page.description,
			});
		}

		return out;
	}, [query, applications.apps, sessions, a2uiPages, recent, frequency]);

	const selectItem = useCallback(
		async (item: LauncherItem) => {
			setError(null);
			try {
				if (item.kind === "application") {
					await invoke("launch_application", {
						path: item.app.appPath,
						args: null,
					});
					recordRecent({
						kind: "application",
						id: `app:${item.app.appPath}`,
						name: item.app.name,
						appPath: item.app.appPath,
					});
					recordUsage(`app:${item.app.appPath}`);
					// Eagerly refresh the running-apps snapshot so the
					// freshly-launched app shows up as "Running" the next
					// time the user opens the launcher.
					void applications.refresh();
					// Hide the launcher without expanding to the workbench; the
					// user explicitly wanted to launch an external app.
					await invoke("hide_launcher");
					return;
				}

				if (item.kind === "session") {
					await invoke("expand_to_workbench", {
						payload: { kind: "session", sessionId: item.session.sessionId },
					});
					const sessionId = `session:${item.session.sessionId}`;
					recordRecent({
						kind: "session",
						id: sessionId,
						sessionId: item.session.sessionId,
						title: item.session.title,
					});
					recordUsage(sessionId);
					return;
				}

				if (item.kind === "builtin") {
					// "Open Chat" should bring the workbench to the front and
					// focus the chat tab, not open the pages window.
					if (item.page === "chat") {
						await invoke("expand_to_workbench", {
							payload: { kind: "chat" },
						});
						const builtinId = `builtin:${item.page}`;
						recordRecent({
							kind: "builtin",
							id: builtinId,
							page: item.page,
							title: item.title,
						});
						recordUsage(builtinId);
						return;
					}

					// Other builtins open the dedicated pages window.
					await invoke("open_pages_window", { page: item.page });
					const builtinId = `builtin:${item.page}`;
					recordRecent({
						kind: "builtin",
						id: builtinId,
						page: item.page,
						title: item.title,
					});
					recordUsage(builtinId);
					return;
				}

				if (item.kind === "agent") {
					const text = item.query.trim();
					await invoke("expand_to_workbench", {
						payload: { kind: "agent", query: text },
					});
					return;
				}

				if (item.kind === "a2ui") {
					await invoke("open_pages_window", {
						page: `a2ui:${item.pageId}`,
					});
					const a2uiId = `a2ui:${item.pageId}`;
					recordRecent({
						kind: "a2ui",
						id: a2uiId,
						pageId: item.pageId,
						title: item.title,
					});
					recordUsage(a2uiId);
					return;
				}
			} catch (e) {
				setError(String(e));
			}
		},
		[recordRecent, recordUsage, applications],
	);

	const isAgentMode = useMemo(() => {
		const lower = query.trim().toLowerCase();
		return lower === "ask" || lower.startsWith(AGENT_PREFIX);
	}, [query]);

	return {
		query,
		setQuery,
		items,
		isAgentMode,
		selectItem,
		sessions,
		recent,
		frequency,
		recordUsage,
		refreshSessions,
		error,
		setError,
		builtinCommands: BUILTIN_COMMANDS,
		applications,
		agentPrompt: AGENT_PREFIX,
	};
}

/** Convert an icon path or base64 data URL into a URL the renderer can load. */
export function appIconUrl(
	path: string | null | undefined,
	base64: string | null | undefined,
): string | null {
	if (base64) return base64;
	if (!path) return null;
	try {
		return convertFileSrc(path);
	} catch {
		return null;
	}
}

/** Hide the current window. Used by the launcher's esc / close affordances. */
export async function hideCurrentLauncher() {
	const win = getCurrentWebviewWindow();
	try {
		await win.hide();
	} catch {
		// Fall back to the command in case the JS API surface differs.
		try {
			await invoke("hide_launcher");
		} catch {
			// give up
		}
	}
}

/** Best-effort list of apps, useful for callers that just want a snapshot. */
export type { AppInfo };
