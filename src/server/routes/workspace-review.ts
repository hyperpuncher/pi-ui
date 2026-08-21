import {
	formatWorkspaceReviewPrompt,
	parseWorkspaceReviewComments,
} from "../../workspace-review-comments.ts";
import { normalizeWorkspaceReviewPreferences } from "../../workspace-review-types.ts";
import { readActionSignals } from "../action-input.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import { writeWorkspaceReviewPreferences } from "../workspace-review-preferences.ts";
import { readWorkspaceCommit, readWorkspaceHistory } from "../workspace-review.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerWorkspaceReviewRoutes(router: ExactRouter<RouteContext>): void {
	router.register(
		"POST",
		endpoints.workspaceReviewPreferences,
		async (request, context) => {
			const signals = await readActionSignals(request);
			const preferences = normalizeWorkspaceReviewPreferences(
				signals._workspaceReviewPreferences,
			);
			await writeWorkspaceReviewPreferences(preferences);
			context.store.setWorkspaceReviewPreferences(preferences);
			return new Response(null, { status: 204 });
		},
	);
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
}
