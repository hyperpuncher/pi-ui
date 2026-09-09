import { isRecord, isString } from "../../utils/type-guards.ts";
import {
	formatWorkspaceReviewPrompt,
	parseWorkspaceReviewComments,
} from "../../workspace-review-comments.ts";
import { normalizeWorkspaceReviewPreferences } from "../../workspace-review-types.ts";
import { readActionSignals } from "../action-input.ts";
import { updateAppConfig } from "../app-config.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type RouteMap } from "../route.ts";
import {
	discardWorkspaceChange,
	readWorkspaceCommit,
	readWorkspaceDiff,
	readWorkspaceHistory,
	WorkspaceReviewError,
} from "../workspace-review.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const workspaceReviewRoutes = {
	[endpoints.workspaceReviewPreferences]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			const preferences = normalizeWorkspaceReviewPreferences(
				signals.workspaceReviewPreferences,
			);
			await updateAppConfig((config) => {
				config.gitView = preferences;
			});
			context.store.setWorkspaceReviewPreferences(preferences);
			return new Response(null, { status: 204 });
		},
	},
	[endpoints.workspaceReviewSubmit]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			let comments;
			try {
				comments = parseWorkspaceReviewComments(signals.workspaceReviewComments);
			} catch (error) {
				throw new RouteError(
					400,
					error instanceof Error ? error.message : "Invalid review comments.",
				);
			}
			if (
				!(await requireHost(context).prompt(
					formatWorkspaceReviewPrompt(comments),
				))
			) {
				throw new RouteError(409, "Review comments were not accepted.");
			}
			return datastarResponse([
				{ type: "effect", effect: { type: "workspace-review-submitted" } },
			]);
		},
	},
	[endpoints.workspaceReviewDiscard]: {
		POST: async (request, context) => {
			const value: unknown = await request.json();
			if (!isRecord(value) || !isString(value.path)) {
				throw new RouteError(400, "Invalid changed file.");
			}
			try {
				await discardWorkspaceChange(context.store.workspacePath, value.path);
			} catch (error) {
				if (error instanceof WorkspaceReviewError) {
					throw new RouteError(error.status, error.message);
				}
				throw error;
			}
			return new Response(null, { status: 204 });
		},
	},
	[endpoints.workspaceReviewDiff]: {
		GET: async (request, context) => {
			const query = new URL(request.url).searchParams;
			const workspacePath = context.store.workspacePath;
			if (query.get("workspacePath") !== workspacePath)
				throw new RouteError(409, "Workspace changed. Reopen the diff.");
			try {
				const patch = await readWorkspaceDiff(
					workspacePath,
					query.get("path") ?? undefined,
					request.signal,
				);
				return new Response(patch, {
					headers: {
						"content-type": "text/plain; charset=utf-8",
						"cache-control": "no-store",
					},
				});
			} catch (error) {
				if (error instanceof WorkspaceReviewError)
					throw new RouteError(error.status, error.message);
				throw error;
			}
		},
	},
	[endpoints.workspaceReviewCommit]: {
		GET: async (request, context) => {
			const hash = new URL(request.url).searchParams.get("hash") ?? "";
			const detail = await readWorkspaceCommit(context.store.workspacePath, hash);
			return detail
				? Response.json(detail, { headers: { "cache-control": "no-cache" } })
				: new Response("Commit not found", { status: 404 });
		},
	},
	[endpoints.workspaceReviewHistory]: {
		GET: async (request, context) => {
			const value = new URL(request.url).searchParams.get("offset") ?? "0";
			const offset = Number(value);
			if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) {
				return new Response("Invalid history offset", { status: 400 });
			}
			return Response.json(
				await readWorkspaceHistory(context.store.workspacePath, offset),
				{ headers: { "cache-control": "no-cache" } },
			);
		},
	},
} satisfies RouteMap<RouteContext>;
