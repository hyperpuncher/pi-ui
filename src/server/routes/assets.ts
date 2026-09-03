import { renderPage } from "../../ui/page.tsx";
import { RouteError, type ExactRouter } from "../router.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerAssetRoutes(router: ExactRouter<RouteContext>): void {
	router.register(
		"GET",
		endpoints.root,
		(_request, context) =>
			new Response(
				renderPage(
					context.renderer.projectState(context.store.snapshot()),
					context.appVersion,
					context.keybindHints,
					context.minimalMode,
					context.toolOutputHidden,
					context.themeLab,
				),
				{
					headers: {
						"cache-control": "no-store",
						"content-type": "text/html; charset=utf-8",
					},
				},
			),
	);
	router.register("GET", endpoints.inspector, (request, context) => {
		if (!context.store.debugUi) throw new RouteError(404, "Not found.");
		return context.serveStatic(request);
	});
}
