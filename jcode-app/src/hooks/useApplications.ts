import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "@/lib/launcherTypes";

/** Minimum time between automatic refreshes triggered by the global
 * shortcut. Manual refreshes via the footer button ignore this cap. */
const AUTO_REFRESH_COOLDOWN_MS = 30_000;

/** How often we re-poll the backend for the latest `running` flags. The
 * Rust background thread refreshes the running-apps cache every 3s, so
 * 5s here is a good balance between freshness and IPC chatter. */
const RUNNING_POLL_INTERVAL_MS = 5_000;

/**
 * Wraps the `search_applications` and `refresh_applications` Tauri commands
 * exposed by `src-tauri/src/launcher.rs`.
 *
 * Why both `refresh` and `search` exist:
 *   - `refresh_applications` triggers a fresh filesystem scan on the Rust
 *     side (slow; gated by a cooldown to avoid blocking the launcher
 *     show-animation).
 *   - `search_applications` just filters the in-memory `AppIndex`. It is
 *     cheap; we call it both to mirror the backend's current state into
 *     the React `apps` cache and to pick up `running` flag updates
 *     coming from the background thread.
 *
 * Earlier versions of this hook only updated the React state when the
 * user typed a query, which left the launcher with an empty list on
 * first open even though the Rust index was already populated. Both
 * `refresh` and `refreshIfStale` now follow up with a `search("")` so
 * the React cache mirrors the backend.
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
	 * hook calls this so the launcher's show-animation isn't blocked by a
	 * filesystem scan on every invocation. */
	const refreshIfStale = useCallback(async () => {
		if (inFlightRef.current) return;
		if (Date.now() - lastRefreshAtRef.current < AUTO_REFRESH_COOLDOWN_MS) return;
		await doRefresh();
		await fetchApps();
	}, [doRefresh, fetchApps]);

	/** Wrapper kept for callers that want to query with a non-empty term.
	 * The launcher's filtering happens in JS (so the cmdk value attribute
	 * still works), so this is mostly used for one-off fetches. */
	const search = useCallback(
		async (query: string): Promise<AppInfo[]> => {
			return fetchApps(query);
		},
		[fetchApps],
	);

	// Pull the apps into React state on mount and then poll periodically so
	// the `running` flags stay current (the Rust thread updates them every
	// 3s; we re-fetch every 5s).
	useEffect(() => {
		void fetchApps();
		const interval = setInterval(() => {
			void fetchApps();
		}, RUNNING_POLL_INTERVAL_MS);
		return () => clearInterval(interval);
	}, [fetchApps]);

	return {
		apps,
		loading,
		error,
		refresh,
		refreshIfStale,
		search,
	};
}
