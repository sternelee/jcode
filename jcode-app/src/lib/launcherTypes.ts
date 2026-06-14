import type { SessionInfo } from "@/types";

/** Application discovered by the Rust app index. */
export interface AppInfo {
	name: string;
	bundleId: string | null;
	iconPath: string | null;
	appPath: string;
	executablePath: string | null;
	/** Human-readable version, e.g. `4.2.1` or `1234`. May be null. */
	version: string | null;
	/** PNG icon as a base64 data URL, extracted from .icns at scan time. */
	iconBase64: string | null;
	/** True when the OS reports this app is currently running. */
	running: boolean;
}

/** Built-in launcher commands that open a specific workbench page. */
export type BuiltinPage =
	| "chat"
	| "providers"
	| "team"
	| "skills"
	| "mcp"
	| "settings";

/** Discriminated union of every selectable item in the launcher palette. */
export type LauncherItem =
	| {
			kind: "application";
			id: string;
			app: AppInfo;
			/** True when this entry came from the MRU list rather than the
			 * full app index. Lets the UI show a dedicated "Recent" group. */
			recent?: boolean;
	  }
	| {
			kind: "session";
			id: string;
			session: SessionInfo;
			recent?: boolean;
	  }
	| {
			kind: "builtin";
			id: string;
			page: BuiltinPage;
			title: string;
			description: string;
			keyword: string;
			iconName: string;
			recent?: boolean;
	  }
	| {
			kind: "agent";
			id: string;
			query: string;
	  };

/** Payload sent from the launcher to the workbench on selection. */
export interface LauncherSelectionPayload {
	kind: "session" | "builtin" | "agent";
	sessionId?: string;
	page?: BuiltinPage;
	query?: string;
}
