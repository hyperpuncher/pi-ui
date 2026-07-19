import {
	type WorkspaceCommit,
	type WorkspaceFileChange,
	workspaceReviewHistoryPageSize,
} from "../workspace-review-types.ts";

export type Selection =
	| { kind: "working"; path?: string }
	| { hash: string; kind: "commit"; path?: string };

type HistoryState = Readonly<{
	commits: WorkspaceCommit[];
	hasMore: boolean;
	reset: boolean;
}>;

export function reconcileFirstHistoryPage(
	current: readonly WorkspaceCommit[],
	currentHasMore: boolean,
	next: readonly WorkspaceCommit[],
): HistoryState {
	const sameHead = current[0]?.hash === next[0]?.hash;
	if (!sameHead) {
		return {
			commits: [...next],
			hasMore: next.length === workspaceReviewHistoryPageSize,
			reset: true,
		};
	}

	const firstPageHashes = new Set(next.map(({ hash }) => hash));
	return {
		commits: [
			...next,
			...current
				.slice(workspaceReviewHistoryPageSize)
				.filter(({ hash }) => !firstPageHashes.has(hash)),
		],
		hasMore: currentHasMore,
		reset: false,
	};
}

export function reconcileSelection(
	selection: Selection,
	wasUnloaded: boolean,
	changes: readonly WorkspaceFileChange[],
	commits: readonly WorkspaceCommit[],
): Selection {
	if (wasUnloaded) {
		if (changes[0]) return { kind: "working", path: changes[0].path };
		if (commits[0]) return { hash: commits[0].hash, kind: "commit" };
		return { kind: "working" };
	}
	if (selection.kind !== "working") return selection;
	return {
		kind: "working",
		path: changes.some(({ path }) => path === selection.path)
			? selection.path
			: changes[0]?.path,
	};
}

export function appendHistoryPage(
	current: readonly WorkspaceCommit[],
	page: readonly WorkspaceCommit[],
): Pick<HistoryState, "commits" | "hasMore"> {
	const known = new Set(current.map(({ hash }) => hash));
	const additions = page.filter(({ hash }) => !known.has(hash));
	return {
		commits: [...current, ...additions],
		hasMore: page.length === workspaceReviewHistoryPageSize && additions.length > 0,
	};
}
