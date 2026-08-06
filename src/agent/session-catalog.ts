import {
	getAgentDir,
	SessionManager,
	type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { join } from "@std/path";

import type { AppSessionSummary, AppStore } from "../state/app-store.ts";
import { errorMessage } from "../utils/errors.ts";
import { formatDateTime } from "../utils/locale.ts";
import { isRecord } from "../utils/type-guards.ts";

export type PreparedSessionList =
	| { ok: true; sessions: SessionInfo[] }
	| { ok: false; error: unknown };

type SessionCatalogOptions = {
	refreshWorkspaces?: boolean;
	showLoading?: boolean;
};

type RecentCandidate = {
	path: string;
	modified: Date;
};

const HOME_RECENT_SESSION_LIMIT = 3;

export class SessionCatalog {
	private refreshGeneration = 0;

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

	static prepareRecent(): Promise<PreparedSessionList> {
		return listRecentSessions().then(
			(sessions) => ({ ok: true as const, sessions }),
			(error: unknown) => ({ ok: false as const, error }),
		);
	}

	applyPrepared(
		prepared: PreparedSessionList,
		options: SessionCatalogOptions = {},
	): void {
		if (!prepared.ok) {
			this.state.appendMessage(
				"system",
				`Failed to list sessions: ${errorMessage(prepared.error)}`,
			);
			this.state.setSessionCatalogLoading(false);
			return;
		}
		this.apply(prepared.sessions, options);
		this.state.setSessionCatalogLoading(false);
	}

	async refresh(
		prepare: () => Promise<PreparedSessionList> = SessionCatalog.prepare,
		options: SessionCatalogOptions = {},
	): Promise<void> {
		const generation = ++this.refreshGeneration;
		if (options.showLoading !== false) {
			this.state.setSessionCatalogLoading(true);
		}
		let prepared: PreparedSessionList;
		try {
			prepared = await prepare();
		} catch (error) {
			prepared = { ok: false, error };
		}
		if (generation !== this.refreshGeneration) return;
		this.applyPrepared(prepared, options);
	}

	mergeCurrentStatuses(): void {
		this.state.setSessionCatalog(this.mergeStatuses(this.state.getSessionCatalog()));
	}

	private apply(sessions: SessionInfo[], options: SessionCatalogOptions = {}): void {
		if (options.refreshWorkspaces !== false) {
			this.state.setRecentWorkspaces(recentSessionWorkspaces(sessions));
		}
		this.state.setSessionCatalog(
			this.mergeStatuses(sessions.map(formatSessionSummary)),
		);
	}
}

export async function listRecentSessions(
	sessionsRoot = join(getAgentDir(), "sessions"),
	limit = HOME_RECENT_SESSION_LIMIT,
): Promise<SessionInfo[]> {
	if (limit <= 0) return [];

	const candidates = await recentCandidates(sessionsRoot);
	const sessions: SessionInfo[] = [];
	for (const candidate of candidates) {
		const session = openSessionInfo(candidate);
		if (!session) continue;
		sessions.push(session);
		if (sessions.length >= limit) break;
	}
	sessions.sort((left, right) => right.modified.getTime() - left.modified.getTime());
	return sessions;
}

async function recentCandidates(sessionsRoot: string): Promise<RecentCandidate[]> {
	const paths: string[] = [];
	try {
		for await (const workspace of Deno.readDir(sessionsRoot)) {
			if (!workspace.isDirectory) continue;
			const workspacePath = join(sessionsRoot, workspace.name);
			try {
				for await (const entry of Deno.readDir(workspacePath)) {
					if (entry.isFile && entry.name.endsWith(".jsonl")) {
						paths.push(join(workspacePath, entry.name));
					}
				}
			} catch {
				// A workspace directory can disappear while discovery is running.
			}
		}
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) return [];
		throw error;
	}

	const candidates = await Promise.all(
		paths.map(async (path): Promise<RecentCandidate | undefined> => {
			try {
				const info = await Deno.stat(path);
				return { path, modified: info.mtime ?? new Date(0) };
			} catch {
				return undefined;
			}
		}),
	);
	return candidates
		.filter((candidate): candidate is RecentCandidate => Boolean(candidate))
		.sort((left, right) => right.modified.getTime() - left.modified.getTime());
}

function openSessionInfo(candidate: RecentCandidate): SessionInfo | undefined {
	try {
		const manager = SessionManager.open(candidate.path);
		const header = manager.getHeader();
		if (!header) return undefined;

		let messageCount = 0;
		let firstMessage = "";
		let lastActivity = 0;
		for (const entry of manager.getEntries()) {
			if (entry.type !== "message") continue;
			messageCount += 1;
			const message = entry.message as unknown;
			if (!isRecord(message)) continue;
			const role = message.role;
			if (role !== "user" && role !== "assistant") continue;
			const timestamp =
				typeof message.timestamp === "number"
					? message.timestamp
					: new Date(entry.timestamp).getTime();
			if (!Number.isNaN(timestamp))
				lastActivity = Math.max(lastActivity, timestamp);
			if (!firstMessage && role === "user") {
				firstMessage = messageText(message.content);
			}
		}

		return {
			path: candidate.path,
			id: header.id,
			cwd: header.cwd ?? "",
			name: manager.getSessionName(),
			parentSessionPath: header.parentSession,
			created: new Date(header.timestamp),
			modified: lastActivity > 0 ? new Date(lastActivity) : candidate.modified,
			messageCount,
			firstMessage: firstMessage || "(no messages)",
			// The complete background catalog owns full-text session search.
			allMessagesText: "",
		};
	} catch {
		return undefined;
	}
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { type: "text"; text: string } =>
				isRecord(block) &&
				block.type === "text" &&
				typeof block.text === "string",
		)
		.map((block) => block.text)
		.join(" ");
}

export function recentSessionWorkspaces(sessions: SessionInfo[]): string[] {
	const workspaces: string[] = [];
	for (const session of sessions) {
		if (!session.cwd || workspaces.includes(session.cwd)) continue;
		workspaces.push(session.cwd);
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
		subtitle: messageLabel,
		modified: formatDateTime(info.modified),
	};
}

function truncate(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
