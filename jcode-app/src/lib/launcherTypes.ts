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
	| "providers"
	| "team"
	| "skills"
	| "mcp"
	| "settings";

export type BuiltinTool = "chat" | "search" | "todo" | "calc" | "clipboard";

/** Configured AI provider exposed for quick launcher chat. */
export interface LauncherChatProvider {
	providerKey: string;
	displayName: string;
	model: string;
	/** Available models for this provider profile. */
	models: string[];
	isCurrentProvider?: boolean;
}
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
			kind: "builtin-tool";
			id: string;
			tool: BuiltinTool;
			title: string;
			description: string;
			keyword: string;
			iconName: string;
			recent?: boolean;
    }
  | {
			kind: "chat-provider";
			id: string;
			provider: LauncherChatProvider;
			recent?: boolean;
    }
	| {
			kind: "agent";
			id: string;
			query: string;
	  }
	| {
			kind: "a2ui";
			id: string;
			pageId: string;
			title: string;
			description?: string;
			recent?: boolean;
	  };

/** Persisted A2UI page stored at ~/.jcode/a2ui_pages/. */
export interface SavedA2uiPage {
	id: string;
	title: string;
	description?: string;
	icon?: string;
	surfaceMessages: unknown[];
	createdAtMs: number;
	updatedAtMs: number;
	sourceSessionId?: string;
}

/** Payload sent from the launcher to the workbench on selection. */
export interface LauncherSelectionPayload {
	kind: "session" | "builtin" | "agent" | "a2ui";
	sessionId?: string;
	page?: BuiltinPage;
	query?: string;
	pageId?: string;
}
