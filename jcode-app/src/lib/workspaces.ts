import type { SessionInfo } from "@/types";

export const DEFAULT_WORKSPACE_ID = "default";

/**
 * Derive the workspace id from a working directory.
 * `null`, `undefined`, and empty strings all map to "default".
 */
export function workspaceIdFromDir(workingDir?: string | null): string {
	return workingDir || DEFAULT_WORKSPACE_ID;
}

/**
 * Inverse of `workspaceIdFromDir` — given a workspace id, return the
 * working directory string to pass to the backend (null = default workspace).
 */
export function workingDirFromWorkspaceId(workspaceId: string): string | null {
	return workspaceId === DEFAULT_WORKSPACE_ID ? null : workspaceId;
}

/**
 * Whether a workspace id represents the implicit "default" workspace
 * (no explicit working directory).
 */
export function isDefaultWorkspace(
	workspaceId: string | null | undefined,
): boolean {
	return !workspaceId || workspaceId === DEFAULT_WORKSPACE_ID;
}

/**
 * Human-readable label for a workspace: "Default" for the default workspace,
 * otherwise the last non-empty path segment of the directory.
 */
export function workspaceLabel(workspaceId: string): string {
	if (isDefaultWorkspace(workspaceId)) return "Default";
	return workspaceId.split("/").filter(Boolean).pop() || workspaceId;
}

export interface WorkspaceGroup {
	/** Workspace id: "default" or the directory path. */
	id: string;
	/** Human-readable label. */
	label: string;
	/** True iff this is the implicit default workspace. */
	isDefault: boolean;
	/** Sessions belonging to this workspace, in their original order. */
	sessions: SessionInfo[];
}

/**
 * Group sessions by their workspace id. Default workspace is sorted last;
 * other workspaces are sorted by label ascending.
 */
export function groupSessionsByWorkspace(
	sessions: SessionInfo[],
): WorkspaceGroup[] {
	const map = new Map<string, SessionInfo[]>();
	for (const s of sessions) {
		const id = workspaceIdFromDir(s.workingDir);
		const arr = map.get(id);
		if (arr) {
			arr.push(s);
		} else {
			map.set(id, [s]);
		}
	}
	const groups: WorkspaceGroup[] = [];
	for (const [id, ss] of map.entries()) {
		groups.push({
			id,
			label: workspaceLabel(id),
			isDefault: isDefaultWorkspace(id),
			sessions: ss,
		});
	}
	return groups.sort((a, b) => {
		if (a.isDefault !== b.isDefault) return a.isDefault ? 1 : -1;
		return a.label.localeCompare(b.label);
	});
}
