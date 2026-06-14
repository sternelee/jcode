import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "@/lib/launcherTypes";

/** Minimum time between automatic filesystem rescans triggered by the
 * global shortcut or window visibility changes. Manual refreshes via the
 * footer button ignore this cap. */
const AUTO_REFRESH_COOLDOWN_MS = 30_000;

/**
 * Wraps the `search_applications` and `refresh_applications` Tauri commands
 * exposed by `src-tauri/src/launcher.rs`.
 *
 * Why both `refresh` and `search` exist:
 *   - `refresh_applications` triggers a fresh filesystem scan on the Rust
 *     side (slow; gated by a cooldown to avoid blocking the launcher
 *     show-animation).
 *   - `search_applications` filters/scores the in-memory `AppIndex`. It is
 *     cheap; we call it on mount, on window visibility, and as the user
 *     types so the React `apps` cache mirrors the backend.
 */
export function useApplications() {
	const [apps, setApps] = useState<AppInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inFlightRef = useRef(false);
	const lastRefreshAtRef = useRef<number>(0);

	const doRefresh = useCallback(async () => {
		if (inFlightRef.current) return;
		inFlightRef.current = true;
		try {
			setLoading(true);
			setError(null);
			await invoke<void>("refresh_applications");
			lastRefreshAtRef.current = Date.now();
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
			inFlightRef.current = false;
		}
	}, []);

	/** Fetch the current backend snapshot into React state. Cheap; this is
	 * the only call that actually mutates the `apps` cache. */
	const fetchApps = useCallback(
		async (query: string = ""): Promise<AppInfo[]> => {
			try {
				const results = await invoke<AppInfo[]>("search_applications", {
					query,
				});
				setApps(results);
				setError(null);
				return results;
			} catch (e) {
				setError(String(e));
				return [];
			}
		},
		[],
	);

	/** Force a rescan regardless of cooldown. Used by the footer's manual
	 * refresh button when the user explicitly wants fresh data. */
	const refresh = useCallback(async () => {
		await doRefresh();
		await fetchApps();
	}, [doRefresh, fetchApps]);

	/** Refresh only if we haven't refreshed in a while. The global-shortcut
	 * hook and visibility handler call this so we don't rescan on every
	 * launcher invocation. */
	const refreshIfStale = useCallback(async () => {
		if (inFlightRef.current) return;
		if (Date.now() - lastRefreshAtRef.current < AUTO_REFRESH_COOLDOWN_MS) return;
		await doRefresh();
		await fetchApps();
	}, [doRefresh, fetchApps]);

	/** Query the backend with a specific term and update React state. The
	 * launcher uses this for debounced type-ahead search. */
	const search = useCallback(
		async (query: string): Promise<AppInfo[]> => {
			return fetchApps(query);
		},
		[fetchApps],
	);

	// Pull the apps into React state once on mount and refresh when the
	// launcher window becomes visible again. We avoid a polling interval
	// because Page Visibility gives us the exact moments we care about.
	useEffect(() => {
		void fetchApps();
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				void refreshIfStale();
			}
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [fetchApps, refreshIfStale]);

	return {
		apps,
		loading,
		error,
		refresh,
		refreshIfStale,
		search,
	};
}
