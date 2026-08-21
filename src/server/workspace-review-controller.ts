import type { AppStore } from "../state/app-store.ts";
import { findGitWatchPaths, readWorkspaceReview } from "./workspace-review.ts";

const debounceMs = 200;

/** Owns the active workspace's Git snapshot and publishes changes through AppStore. */
export class WorkspaceReviewController {
	private generation = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private watcher: Deno.FsWatcher | undefined;

	constructor(private readonly store: AppStore) {
		store.listenForWorkspacePath((path) => this.open(path));
	}

	open(path: string): void {
		const generation = ++this.generation;
		this.stopWatcher();
		void this.watch(path, generation).catch((error: ErrorOptions["cause"]) => {
			if (generation === this.generation)
				console.error("Failed to watch workspace Git state", error);
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
		const paths = await findGitWatchPaths(path);
		if (!paths || !active()) return;
		const watcher = Deno.watchFs(paths, { recursive: true });
		this.watcher = watcher;
		try {
			for await (const _event of watcher) {
				if (!active()) break;
				if (this.timer !== undefined) clearTimeout(this.timer);
				this.timer = setTimeout(() => {
					this.timer = undefined;
					void refresh();
				}, debounceMs);
			}
		} catch (error) {
			if (active()) throw error;
		} finally {
			if (this.watcher === watcher) this.watcher = undefined;
			watcher.close();
		}
	}

	private stopWatcher(): void {
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
		this.watcher?.close();
		this.watcher = undefined;
	}
}
