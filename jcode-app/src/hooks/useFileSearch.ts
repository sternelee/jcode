import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface SearchResult {
	path: string;
	relative: string;
	line: number;
	text: string;
}

export function useFileSearch() {
	const [results, setResults] = useState<SearchResult[]>([]);
	const [searching, setSearching] = useState(false);
	const [done, setDone] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const unlistenRef = useRef<UnlistenFn | null>(null);
	const unlistenDoneRef = useRef<UnlistenFn | null>(null);

	useEffect(() => {
		return () => {
			unlistenRef.current?.();
			unlistenDoneRef.current?.();
		};
	}, []);

	const search = useCallback(async (keyword: string, path: string) => {
		setResults([]);
		setSearching(true);
		setDone(false);
		setError(null);
		unlistenRef.current?.();
		unlistenDoneRef.current?.();

		const unlisten = await listen<{ path: string; relative: string; line: number; text: string }>(
			"search-result",
			(event) => {
				setResults((prev) => [...prev, event.payload]);
			},
		);
		unlistenRef.current = unlisten;

		const unlistenDone = await listen<{ path: string; keyword: string }>(
			"search-done",
			() => {
				setSearching(false);
				setDone(true);
			},
		);
		unlistenDoneRef.current = unlistenDone;

		try {
			await invoke("search_files", { keyword, path });
		} catch (e) {
			setError(String(e));
			setSearching(false);
			setDone(true);
		}
	}, []);

	const clear = useCallback(() => {
		setResults([]);
		setSearching(false);
		setDone(false);
		setError(null);
		unlistenRef.current?.();
		unlistenDoneRef.current?.();
	}, []);

	return { results, searching, done, error, search, clear };
}
