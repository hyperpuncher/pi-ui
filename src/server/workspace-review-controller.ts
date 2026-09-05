import { watch as watchFileSystem, type FSWatcher } from "node:fs";
import os from "node:os";
import * as path from "node:path";

import type { AppStore } from "../state/app-store.ts";
import {
	areWorkspacePathsIgnored,
	findGitWatchPaths,
	readWorkspaceReview,
	type WorkspaceReviewMetadataCache,
} from "./workspace-review.ts";

const debounceMs = 200;

/** Watches the active workspace and publishes file and Git changes through AppStore. */
export class WorkspaceReviewController {
	private generation = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private watchers: FSWatcher[] = [];

	constructor(private readonly store: AppStore) {
		store.listenForWorkspacePath((path) => this.open(path));
	}

	open(path: string): void {
		const generation = ++this.generation;
		this.stopWatcher();
		void this.watch(path, generation).catch((error: ErrorOptions["cause"]) => {
			if (generation === this.generation)
				console.error("Failed to watch workspace", error);
		});
	}

	dispose(): void {
		this.generation++;
		this.stopWatcher();
	}

	private async watch(path: string, generation: number): Promise<void> {
		let refreshing = false;
		let refreshAgain = false;
		let initialized = false;
		let metadataCache: WorkspaceReviewMetadataCache = {};
		const active = () => generation === this.generation;
		const refresh = async () => {
			if (refreshing) {
				refreshAgain = true;
				return;
			}
			refreshing = true;
			try {
				do {
					refreshAgain = false;
					const snapshot = await readWorkspaceReview(
						path,
						initialized
							? undefined
							: (summary) => {
									if (active()) this.store.setWorkspaceReview(summary);
								},
						metadataCache,
					);
					if (active()) {
						this.store.setWorkspaceReview(snapshot);
						initialized = true;
					}
				} while (refreshAgain && active());
			} finally {
				refreshing = false;
			}
		};

		await refresh();
		if (!active()) return;
		const gitPaths = await findGitWatchPaths(path);
		if (!active()) return;
		// The initial read ran before the watchers could observe metadata changes.
		metadataCache = {};
		// Undefined means this batch requires a full refresh, regardless of later events.
		let pendingPaths: Set<string> | undefined = new Set();
		let treeChanged = false;
		const flush = async () => {
			if (!active()) return;
			const paths = pendingPaths;
			pendingPaths = new Set();
			this.store.workspaceFilesChanged(treeChanged);
			treeChanged = false;
			if (
				paths &&
				gitPaths?.[0] &&
				(await areWorkspacePathsIgnored(gitPaths[0], [...paths]))
			)
				return;
			if (active()) await refresh();
		};
		const changed = (watchPath: string, event: string, filename: string | null) => {
			if (!active()) return;
			const relative = filename?.replaceAll("\\", "/");
			if (gitPaths && relative) {
				const metadataPrefix = watchPath === gitPaths[0] ? ".git/" : "";
				const metadataPath = relative.startsWith(metadataPrefix)
					? relative.slice(metadataPrefix.length)
					: "";
				// Refs, HEAD, index, and config still trigger refreshes when published.
				if (
					metadataPath.startsWith("objects/") ||
					metadataPath.startsWith("logs/") ||
					metadataPath.endsWith(".lock")
				)
					return;
			}
			// A later content event must not erase a structural change in this batch.
			if (event !== "change" || !filename) treeChanged = true;
			// Directory renames can hide tracked descendants; metadata and ignore
			// rule changes can alter the review without changing any source file.
			if (
				event === "change" &&
				filename &&
				relative &&
				watchPath === gitPaths?.[0] &&
				relative !== ".git" &&
				!relative.startsWith(".git/") &&
				relative.split("/").at(-1) !== ".gitignore"
			)
				pendingPaths?.add(filename);
			else {
				pendingPaths = undefined;
				// Replace the cache immediately so an in-flight read cannot refill it.
				metadataCache = {};
			}
			if (this.timer !== undefined) clearTimeout(this.timer);
			this.timer = setTimeout(() => {
				this.timer = undefined;
				void flush();
			}, debounceMs);
		};
		this.watchers = (gitPaths ?? [path]).map((watchPath) =>
			watchFileSystem(
				watchPath,
				{
					recursive: gitPaths !== undefined || canWatchRecursively(path),
				},
				(event, filename) => changed(watchPath, event, filename),
			),
		);
	}

	private stopWatcher(): void {
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
		for (const watcher of this.watchers) watcher.close();
		this.watchers = [];
	}
}

function canWatchRecursively(workspacePath: string): boolean {
	const workspace = path.resolve(workspacePath);
	const home = os.homedir();
	return (
		workspace !== path.parse(workspace).root &&
		(!home || workspace !== path.resolve(home))
	);
}
