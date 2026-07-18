import { renderPage } from "../../ui/page.tsx";
import { RouteError, type ExactRouter } from "../router.ts";
import { readWorkspaceReviewAvailability } from "../workspace-review.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerAssetRoutes(router: ExactRouter<RouteContext>): void {
	router.register(
		"GET",
		endpoints.root,
		async (_request, context) =>
			new Response(
				renderPage(
					context.store.snapshot(),
					await readWorkspaceReviewAvailability(
						context.resources.host?.getWorkspacePath() ??
							context.store.workspacePath,
					),
				),
				{ headers: { "content-type": "text/html; charset=utf-8" } },
			),
	);
	router.register(
		"GET",
		endpoints.basecoat,
		async (_request, context) =>
			new Response(await context.readBasecoat(), {
				headers: { "content-type": "text/javascript; charset=utf-8" },
			}),
	);
	router.register("GET", endpoints.inspector, (request, context) => {
		if (!context.store.debugUi) throw new RouteError(404, "Not found.");
		return context.serveStatic(request);
	});
}
