import type { ExactRouter } from "../router.ts";
import {
	findGitRoot,
	readWorkspaceReview,
	readWorkspaceReviewAvailability,
} from "../workspace-review.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

const debounceMs = 200;
const encoder = new TextEncoder();

export function registerWorkspaceReviewRoutes(router: ExactRouter<RouteContext>): void {
	router.register("GET", endpoints.workspaceReview, (request, context) => {
		const params = new URL(request.url).searchParams;
		const availabilityOnly = params.has("availability");
		const snapshotOnly = params.has("snapshot");
		const workspacePath = context.store.workspacePath;
		let canceled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let watcher: Deno.FsWatcher | undefined;
		const stopped = () => canceled || request.signal.aborted;
		const stop = () => {
			canceled = true;
			if (timer !== undefined) clearTimeout(timer);
			watcher?.close();
		};
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				void (async () => {
					let isGitRepository = false;
					let revision = "";
					let refreshing = false;
					let refreshAgain = false;
					const refresh = async () => {
						if (refreshing) {
							refreshAgain = true;
							return;
						}
						refreshing = true;
						try {
							do {
								refreshAgain = false;
								const snapshot = availabilityOnly
									? await readWorkspaceReviewAvailability(workspacePath)
									: await readWorkspaceReview(workspacePath);
								isGitRepository = snapshot.isGitRepository;
								if (!stopped() && snapshot.revision !== revision) {
									revision = snapshot.revision;
									controller.enqueue(
										encoder.encode(
											`data: ${JSON.stringify(snapshot)}\n\n`,
										),
									);
								}
							} while (refreshAgain && !stopped());
						} finally {
							refreshing = false;
						}
					};

					await refresh();
					if (availabilityOnly || snapshotOnly || !isGitRepository || stopped())
						return;
					const gitRoot = await findGitRoot(workspacePath);
					if (!gitRoot || stopped()) return;
					watcher = Deno.watchFs(gitRoot, { recursive: true });
					request.signal.addEventListener("abort", stop, { once: true });
					try {
						for await (const _event of watcher) {
							if (timer !== undefined) clearTimeout(timer);
							timer = setTimeout(() => void refresh(), debounceMs);
						}
					} catch (error) {
						if (!stopped()) throw error;
					} finally {
						stop();
					}
				})().catch((error) => {
					if (!stopped()) controller.error(error);
				});
			},
			cancel: stop,
		});
		return new Response(body, {
			headers: {
				"cache-control": "no-cache",
				"content-type": "text/event-stream",
			},
		});
	});
}
