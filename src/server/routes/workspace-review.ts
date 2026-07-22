import {
	formatWorkspaceReviewPrompt,
	parseWorkspaceReviewComments,
} from "../../workspace-review-comments.ts";
import { normalizeWorkspaceReviewPreferences } from "../../workspace-review-types.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import {
	readWorkspaceReviewPreferences,
	writeWorkspaceReviewPreferences,
} from "../workspace-review-preferences.ts";
import {
	findGitWatchPaths,
	readWorkspaceCommit,
	readWorkspaceHistory,
	readWorkspaceReview,
	readWorkspaceReviewAvailability,
} from "../workspace-review.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

const debounceMs = 200;
const encoder = new TextEncoder();

export function registerWorkspaceReviewRoutes(router: ExactRouter<RouteContext>): void {
	router.register("GET", endpoints.workspaceReviewPreferences, async () =>
		Response.json(await readWorkspaceReviewPreferences(), {
			headers: { "cache-control": "no-cache" },
		}),
	);
	router.register("POST", endpoints.workspaceReviewPreferences, async (request) => {
		let value: unknown;
		try {
			value = await request.json();
		} catch {
			throw new RouteError(400, "Malformed Git view preferences.");
		}
		const preferences = normalizeWorkspaceReviewPreferences(value);
		await writeWorkspaceReviewPreferences(preferences);
		return new Response(null, { status: 204 });
	});
	router.register("POST", endpoints.workspaceReviewSubmit, async (request, context) => {
		let value: unknown;
		try {
			value = await request.json();
		} catch {
			throw new RouteError(400, "Malformed review comments.");
		}
		let comments;
		try {
			comments = parseWorkspaceReviewComments(value);
		} catch (error) {
			throw new RouteError(
				400,
				error instanceof Error ? error.message : "Invalid review comments.",
			);
		}
		if (!(await requireHost(context).prompt(formatWorkspaceReviewPrompt(comments)))) {
			throw new RouteError(409, "Review comments were not accepted.");
		}
		return new Response(null, { status: 204 });
	});
	router.register("GET", endpoints.workspaceReviewCommit, async (request, context) => {
		const hash = new URL(request.url).searchParams.get("hash") ?? "";
		const detail = await readWorkspaceCommit(context.store.workspacePath, hash);
		return detail
			? Response.json(detail, { headers: { "cache-control": "no-cache" } })
			: new Response("Commit not found", { status: 404 });
	});
	router.register("GET", endpoints.workspaceReviewHistory, async (request, context) => {
		const value = new URL(request.url).searchParams.get("offset") ?? "0";
		const offset = Number(value);
		if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) {
			return new Response("Invalid history offset", { status: 400 });
		}
		return Response.json(
			await readWorkspaceHistory(context.store.workspacePath, offset),
			{ headers: { "cache-control": "no-cache" } },
		);
	});
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
					const gitPaths = await findGitWatchPaths(workspacePath);
					if (!gitPaths || stopped()) return;
					watcher = Deno.watchFs(gitPaths, { recursive: true });
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
