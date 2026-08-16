import { getAgentDir, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { join } from "@std/path";

import type { AppSessionSummary, AppStore } from "../state/app-store.ts";
import { errorMessage } from "../utils/errors.ts";
import { formatDateTime } from "../utils/locale.ts";
import {
	loadSessionSummary,
	readSessionSummaryCache,
	sessionInfoFromSummary,
	sessionSummaryCachePath,
	updateSessionSummaryCache,
} from "./session-summary-cache.ts";

export type PreparedSessionList =
	| { ok: true; sessions: SessionInfo[] }
	| { ok: false; error: unknown };

type SessionCatalogOptions = {
	refreshWorkspaces?: boolean;
	showLoading?: boolean;
};

type SessionCandidate = {
	path: string;
	indexedBytes: number;
	mtime: number;
};

const SESSION_INDEX_CONCURRENCY = 4;

export class SessionCatalog {
	private refreshGeneration = 0;
	private readonly pathRefreshGenerations = new Map<string, number>();
	private baseOrder: string[] = [];

	constructor(
		private readonly state: AppStore,
		private readonly mergeStatuses: (
			sessions: readonly AppSessionSummary[],
		) => AppSessionSummary[],
	) {}

	static prepare(): Promise<PreparedSessionList> {
		return listCachedSessions().then(
			(sessions) => ({ ok: true as const, sessions }),
			(error: ErrorOptions["cause"]) => ({ ok: false as const, error }),
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
		this.applyOrdered(this.mergeStatuses(this.state.getSessionCatalog()));
	}

	agentCompleted(path: string): void {
		this.promote(path);
	}

	messageStarted(path: string, firstUserMessage?: string): void {
		this.state.updateSessionSummary(path, (session) => {
			const count = sessionMessageCount(session.subtitle) + 1;
			const modified = new Date();
			const title =
				count === 1 && firstUserMessage?.trim()
					? truncate(firstUserMessage.trim(), 96)
					: session.title;
			return {
				...session,
				title,
				subtitle: `${count} message${count === 1 ? "" : "s"}`,
				modified: formatDateTime(modified),
				modifiedAt: modified.toISOString(),
			};
		});
		if (firstUserMessage !== undefined) this.promote(path);
	}

	touch(path: string): void {
		const modified = new Date();
		this.state.updateSessionSummary(path, (session) => ({
			...session,
			modified: formatDateTime(modified),
			modifiedAt: modified.toISOString(),
		}));
	}

	async refreshPath(path: string): Promise<void> {
		const generation = (this.pathRefreshGenerations.get(path) ?? 0) + 1;
		this.pathRefreshGenerations.set(path, generation);
		let candidate: SessionCandidate;
		try {
			const file = await Deno.stat(path);
			const modified = file.mtime ?? new Date();
			candidate = {
				path,
				indexedBytes: file.size,
				mtime: modified.getTime(),
			};
		} catch (error) {
			if (!(error instanceof Deno.errors.NotFound)) return;
			if (this.pathRefreshGenerations.get(path) !== generation) return;
			this.state.removeSession(path);
			return;
		}
		const cachePath = sessionSummaryCachePath();
		const cache = await readSessionSummaryCache(cachePath);
		const cached = cache.sessions[path];
		const indexed = await loadSessionSummary(candidate, cached);
		if (!indexed || this.pathRefreshGenerations.get(path) !== generation) return;
		if (indexed !== cached) {
			await updateSessionSummaryCache({ [path]: indexed }, cachePath);
		}
		const summary = this.mergeStatuses([
			formatSessionSummary(sessionInfoFromSummary(path, indexed)),
		])[0];
		if (!summary) return;
		const sessions = this.state.getSessionCatalog();
		const exists = sessions.some((session) => session.path === path);
		this.applyOrdered(
			exists
				? sessions.map((session) => (session.path === path ? summary : session))
				: [summary, ...sessions],
		);
	}

	private apply(sessions: SessionInfo[], options: SessionCatalogOptions = {}): void {
		if (options.refreshWorkspaces !== false) {
			this.state.setRecentWorkspaces(recentSessionWorkspaces(sessions));
		}
		this.applyOrdered(this.mergeStatuses(sessions.map(formatSessionSummary)));
	}

	private applyOrdered(sessions: readonly AppSessionSummary[]): void {
		const paths = new Set(sessions.map((session) => session.path));
		const knownPaths = new Set(this.baseOrder);
		this.baseOrder = [
			...sessions
				.filter((session) => !knownPaths.has(session.path))
				.map((session) => session.path),
			...this.baseOrder.filter((path) => paths.has(path)),
		];

		const previousStatuses = new Map(
			this.state
				.getSessionCatalog()
				.map((session) => [session.path, session.backgroundStatus]),
		);
		const newlyCompleted = sessions.filter(
			(session) =>
				session.backgroundStatus === "completed" &&
				previousStatuses.has(session.path) &&
				previousStatuses.get(session.path) !== "completed",
		);
		for (const session of newlyCompleted.toReversed()) {
			this.promoteBase(session.path);
		}

		const sessionsByPath = new Map(
			sessions.map((session) => [session.path, session]),
		);
		const stable = this.baseOrder.flatMap((path) => {
			const session = sessionsByPath.get(path);
			return session ? [session] : [];
		});
		this.state.setSessionCatalog([
			...stable.filter((session) => session.backgroundStatus === "completed"),
			...stable.filter((session) => session.backgroundStatus !== "completed"),
		]);
	}

	private promote(path: string): void {
		if (!this.baseOrder.includes(path)) return;
		this.promoteBase(path);
		this.applyOrdered(this.state.getSessionCatalog());
	}

	private promoteBase(path: string): void {
		this.baseOrder = [
			path,
			...this.baseOrder.filter((candidate) => candidate !== path),
		];
	}
}

export async function listCachedSessions(
	sessionsRoot = join(getAgentDir(), "sessions"),
	cachePath = sessionSummaryCachePath(),
): Promise<SessionInfo[]> {
	const [candidates, cache] = await Promise.all([
		sessionCandidates(sessionsRoot),
		readSessionSummaryCache(cachePath),
	]);
	const summaries: Array<Awaited<ReturnType<typeof loadSessionSummary>>> = Array.from({
		length: candidates.length,
	});
	let nextIndex = 0;
	const loadNext = async () => {
		while (nextIndex < candidates.length) {
			const index = nextIndex++;
			const candidate = candidates[index];
			summaries[index] = await loadSessionSummary(
				candidate,
				cache.sessions[candidate.path],
			);
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(SESSION_INDEX_CONCURRENCY, candidates.length) },
			loadNext,
		),
	);

	const sessions: SessionInfo[] = [];
	const changedEntries: typeof cache.sessions = {};
	for (const [index, candidate] of candidates.entries()) {
		const summary = summaries[index];
		if (!summary) continue;
		if (summary !== cache.sessions[candidate.path]) {
			changedEntries[candidate.path] = summary;
		}
		sessions.push(sessionInfoFromSummary(candidate.path, summary));
	}
	const retainedPaths = new Set(candidates.map((candidate) => candidate.path));
	const hasDeletedEntries = Object.keys(cache.sessions).some(
		(path) => !retainedPaths.has(path),
	);
	if (Object.keys(changedEntries).length > 0 || hasDeletedEntries) {
		await updateSessionSummaryCache(changedEntries, cachePath, retainedPaths);
	}
	sessions.sort((left, right) => right.modified.getTime() - left.modified.getTime());
	return sessions;
}

async function sessionCandidates(sessionsRoot: string): Promise<SessionCandidate[]> {
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
		paths.map(async (path): Promise<SessionCandidate | undefined> => {
			try {
				const info = await Deno.stat(path);
				const modified = info.mtime ?? new Date(0);
				return {
					path,
					indexedBytes: info.size,
					mtime: modified.getTime(),
				};
			} catch {
				return undefined;
			}
		}),
	);
	return candidates
		.filter((candidate): candidate is SessionCandidate => Boolean(candidate))
		.sort((left, right) => right.mtime - left.mtime);
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
		modifiedAt: info.modified.toISOString(),
	};
}

function sessionMessageCount(subtitle: string): number {
	const count = Number.parseInt(subtitle, 10);
	return Number.isFinite(count) ? count : 0;
}

function truncate(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
