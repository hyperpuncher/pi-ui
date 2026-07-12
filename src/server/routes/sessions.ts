import type { SessionTransitionResult } from "../../agent/session-transition-controller.ts";
import { readActionSignals, requiredString } from "../action-input.ts";
import { datastarResponse, errorResponse, signalsResponse } from "../datastar.ts";
import { FileSearchHost } from "../file-search.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerSessionRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.sessionsNew, async (_request, context) =>
		sessionTransitionResponse(await requireHost(context).newSession()),
	);
	router.register("POST", endpoints.sessionsNewTemporary, async (_request, context) =>
		sessionTransitionResponse(await requireHost(context).newTemporarySession()),
	);
	router.register("POST", endpoints.sessionsList, async (_request, context) => {
		await requireHost(context).listSessions();
		return datastarResponse();
	});
	router.register(
		"POST",
		endpoints.sessionsBackgroundAbort,
		async (request, context) => {
			const path = requiredString(
				await readActionSignals(request),
				"backgroundSessionPath",
			);
			if (!(await requireHost(context).abortBackgroundSession(path))) {
				throw new RouteError(409, "Background session could not be aborted.");
			}
			return signalsResponse({ backgroundSessionPath: "" });
		},
	);
	router.register("POST", endpoints.sessionsDelete, async (request, context) => {
		const path = requiredString(
			await readActionSignals(request),
			"sessionDeletePath",
		);
		if (!(await requireHost(context).deleteSession(path))) {
			throw new RouteError(409, "Session could not be deleted.");
		}
		return datastarResponse([
			{
				type: "signals",
				signals: { sessionDeletePath: "", sessionDeleteTitle: "" },
			},
			{ type: "effect", effect: { type: "session-deleted" } },
		]);
	});
	router.register("POST", endpoints.sessionsResume, async (request, context) => {
		const path = requiredString(
			await readActionSignals(request),
			"sessionPath",
		).trim();
		const host = requireHost(context);
		const response = sessionTransitionResponse(await host.resumeSession(path));
		if (response.status !== 204) return response;
		const replacement = await FileSearchHost.create(host.getWorkspacePath());
		context.resources.fileSearch.dispose();
		context.resources.fileSearch = replacement;
		return response;
	});
}

export function sessionTransitionResponse(result: SessionTransitionResult): Response {
	switch (result.status) {
		case "success":
			return datastarResponse();
		case "busy":
			return errorResponse(409, "A session transition is already running.");
		case "cancelled":
			return errorResponse(422, "Session transition was cancelled.");
		case "error":
			return errorResponse(500, "Session transition failed.");
	}
}
