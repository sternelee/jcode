import { useCallback, useEffect, useState } from "react";
import Database from "@tauri-apps/plugin-sql";

export interface TodoItem {
	id: number;
	text: string;
	completed: boolean;
	createdAt: number;
}

const DB_PATH = "sqlite:launcher.db";
let dbInstance: Database | null = null;

async function getDb(): Promise<Database> {
	if (dbInstance) return dbInstance;
	dbInstance = await Database.load(DB_PATH);
	await dbInstance.execute(`
		CREATE TABLE IF NOT EXISTS todos (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			text TEXT NOT NULL,
			completed INTEGER DEFAULT 0,
			created_at INTEGER NOT NULL
		)
	`);
	return dbInstance;
}

export function useTodos() {
	const [items, setItems] = useState<TodoItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadTodos = useCallback(async () => {
		try {
			const db = await getDb();
			const rows = await db.select<{
				id: number;
				text: string;
				completed: number;
				created_at: number;
			}[]>(`
				SELECT id, text, completed, created_at
				FROM todos
				ORDER BY completed ASC, created_at DESC
			`);
			setItems(
				rows.map((r) => ({
					id: r.id,
					text: r.text,
					completed: Boolean(r.completed),
					createdAt: r.created_at,
				})),
			);
		} catch (e) {
			setError(String(e));
		}
	}, []);

	useEffect(() => {
		setLoading(true);
		void loadTodos().finally(() => setLoading(false));
	}, [loadTodos]);

	const addTodo = useCallback(async (text: string) => {
		if (!text.trim()) return;
		try {
			const db = await getDb();
			await db.execute(
				"INSERT INTO todos (text, completed, created_at) VALUES ($1, 0, $2)",
				[text.trim(), Date.now()],
			);
			await loadTodos();
		} catch (e) {
			setError(String(e));
		}
	}, [loadTodos]);

	const toggleTodo = useCallback(async (id: number, completed: boolean) => {
		try {
			const db = await getDb();
			await db.execute("UPDATE todos SET completed = $1 WHERE id = $2", [
				completed ? 1 : 0,
				id,
			]);
			await loadTodos();
		} catch (e) {
			setError(String(e));
		}
	}, [loadTodos]);

	const deleteTodo = useCallback(async (id: number) => {
		try {
			const db = await getDb();
			await db.execute("DELETE FROM todos WHERE id = $1", [id]);
			await loadTodos();
		} catch (e) {
			setError(String(e));
		}
	}, [loadTodos]);

	const clearCompleted = useCallback(async () => {
		try {
			const db = await getDb();
			await db.execute("DELETE FROM todos WHERE completed = 1");
			await loadTodos();
		} catch (e) {
			setError(String(e));
		}
	}, [loadTodos]);

	return {
		items,
		loading,
		error,
		refresh: loadTodos,
		addTodo,
		toggleTodo,
		deleteTodo,
		clearCompleted,
	};
}
