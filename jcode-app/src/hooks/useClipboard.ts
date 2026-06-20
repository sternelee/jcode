import { useCallback, useEffect, useState } from "react";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import Database from "@tauri-apps/plugin-sql";

export interface ClipboardItem {
	id: number;
	content: string;
	createdAt: number;
	pinned: boolean;
}

const DB_PATH = "sqlite:launcher.db";
let dbInstance: Database | null = null;

async function getDb(): Promise<Database> {
	if (dbInstance) return dbInstance;
	dbInstance = await Database.load(DB_PATH);
	await dbInstance.execute(`
		CREATE TABLE IF NOT EXISTS clipboard_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			content TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			pinned INTEGER DEFAULT 0
		)
	`);
	await dbInstance.execute(`
		CREATE INDEX IF NOT EXISTS idx_clipboard_created ON clipboard_history(created_at DESC)
	`);
	return dbInstance;
}

export function useClipboard() {
	const [items, setItems] = useState<ClipboardItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadHistory = useCallback(async () => {
		try {
			const db = await getDb();
			const rows = await db.select<{
				id: number;
				content: string;
				created_at: number;
				pinned: number;
			}[]>(`
				SELECT id, content, created_at, pinned
				FROM clipboard_history
				ORDER BY pinned DESC, created_at DESC
				LIMIT 200
			`);
			setItems(
				rows.map((r) => ({
					id: r.id,
					content: r.content,
					createdAt: r.created_at,
					pinned: Boolean(r.pinned),
				})),
			);
		} catch (e) {
			setError(String(e));
		}
	}, []);

	useEffect(() => {
		setLoading(true);
		void loadHistory().finally(() => setLoading(false));
	}, [loadHistory]);

	const addItem = useCallback(async (content: string) => {
		if (!content.trim()) return;
		try {
			const db = await getDb();
			await db.execute(
				"INSERT INTO clipboard_history (content, created_at, pinned) VALUES ($1, $2, 0)",
				[content.trim(), Date.now()],
			);
			await loadHistory();
		} catch (e) {
			setError(String(e));
		}
	}, [loadHistory]);

	const writeToClipboard = useCallback(async (content: string) => {
		try {
			await writeText(content);
			await addItem(content);
		} catch (e) {
			setError(String(e));
		}
	}, [addItem]);

	const readFromClipboard = useCallback(async () => {
		try {
			const text = await readText();
			if (text) await addItem(text);
			return text;
		} catch (e) {
			setError(String(e));
			return "";
		}
	}, [addItem]);

	const deleteItem = useCallback(async (id: number) => {
		try {
			const db = await getDb();
			await db.execute("DELETE FROM clipboard_history WHERE id = $1", [id]);
			await loadHistory();
		} catch (e) {
			setError(String(e));
		}
	}, [loadHistory]);

	const togglePin = useCallback(async (id: number, pinned: boolean) => {
		try {
			const db = await getDb();
			await db.execute(
				"UPDATE clipboard_history SET pinned = $1 WHERE id = $2",
				[pinned ? 1 : 0, id],
			);
			await loadHistory();
		} catch (e) {
			setError(String(e));
		}
	}, [loadHistory]);

	const clearHistory = useCallback(async () => {
		try {
			const db = await getDb();
			await db.execute("DELETE FROM clipboard_history WHERE pinned = 0");
			await loadHistory();
		} catch (e) {
			setError(String(e));
		}
	}, [loadHistory]);

	const copyItem = useCallback(async (item: ClipboardItem) => {
		try {
			await writeText(item.content);
			const db = await getDb();
			await db.execute(
				"UPDATE clipboard_history SET created_at = $1 WHERE id = $2",
				[Date.now(), item.id],
			);
			await loadHistory();
		} catch (e) {
			setError(String(e));
		}
	}, [loadHistory]);

	return {
		items,
		loading,
		error,
		refresh: loadHistory,
		writeToClipboard,
		readFromClipboard,
		deleteItem,
		togglePin,
		clearHistory,
		copyItem,
	};
}
