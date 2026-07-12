import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";

import type { AppSessionSummary, AppStore } from "../state/app-store.ts";
import { formatDateTime } from "../utils/locale.ts";
import { formatError } from "./tool-presentation.ts";

export type PreparedSessionList =
	| { ok: true; sessions: SessionInfo[] }
	| { ok: false; error: unknown };

export class SessionCatalog {
	constructor(
		private readonly state: AppStore,
		private readonly mergeStatuses: (
			sessions: readonly AppSessionSummary[],
		) => AppSessionSummary[],
	) {}

	static prepare(): Promise<PreparedSessionList> {
		return SessionManager.listAll().then(
			(sessions) => ({ ok: true as const, sessions }),
			(error: unknown) => ({ ok: false as const, error }),
		);
	}

	applyPrepared(
		prepared: PreparedSessionList,
		options: { refreshWorkspaces?: boolean } = {},
	): void {
		if (!prepared.ok) {
			this.state.appendMessage(
				"system",
				`Failed to list sessions: ${formatError(prepared.error)}`,
			);
			return;
		}
		this.apply(prepared.sessions, options);
	}

	async refresh(): Promise<void> {
		try {
			this.apply(await SessionManager.listAll());
		} catch (error) {
			this.state.appendMessage(
				"system",
				`Failed to list sessions: ${formatError(error)}`,
			);
		}
	}

	mergeCurrentStatuses(): void {
		this.state.setSessions(this.mergeStatuses(this.state.sessions));
	}

	private apply(
		sessions: SessionInfo[],
		options: { refreshWorkspaces?: boolean } = {},
	): void {
		if (options.refreshWorkspaces !== false) {
			this.state.setRecentWorkspaces(recentSessionWorkspaces(sessions));
		}
		this.state.setSessions(
			this.mergeStatuses(sessions.slice(0, 50).map(formatSessionSummary)),
		);
	}
}

export function recentSessionWorkspaces(sessions: SessionInfo[]): string[] {
	const workspaces: string[] = [];
	for (const session of sessions) {
		if (!session.cwd || workspaces.includes(session.cwd)) continue;
		workspaces.push(session.cwd);
		if (workspaces.length >= 8) break;
	}
	return workspaces;
}

export function formatSessionSummary(info: SessionInfo): AppSessionSummary {
	const title = info.name?.trim() || info.firstMessage.trim() || "Untitled session";
	const messageLabel = `${info.messageCount} message${info.messageCount === 1 ? "" : "s"}`;
	return {
		path: info.path,
		cwd: info.cwd,
		title: truncate(title, 96),
		subtitle: `${messageLabel} • ${truncate(info.cwd, 64)}`,
		modified: formatDateTime(info.modified),
	};
}

function truncate(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
