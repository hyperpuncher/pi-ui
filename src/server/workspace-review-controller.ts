import { watch as watchFileSystem, type FSWatcher } from "node:fs";
import os from "node:os";
import * as path from "node:path";

import type { AppStore } from "../state/app-store.ts";
import { findGitWatchPaths, readWorkspaceReview } from "./workspace-review.ts";

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
		const changed = () => {
			if (!active()) return;
			if (this.timer !== undefined) clearTimeout(this.timer);
			this.timer = setTimeout(() => {
				this.timer = undefined;
				this.store.workspaceFilesChanged();
				void refresh();
			}, debounceMs);
		};
		this.watchers = (gitPaths ?? [path]).map((watchPath) =>
			watchFileSystem(
				watchPath,
				{
					recursive: gitPaths !== undefined || canWatchRecursively(path),
				},
				changed,
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
