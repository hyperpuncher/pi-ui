import { renderPage } from "../../ui/page.tsx";
import { RouteError, type RouteMap } from "../route.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const assetRoutes = {
	[endpoints.root]: {
		GET: (_request, context) =>
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
	},
	[endpoints.inspector]: {
		GET: (request, context) => {
			if (!context.store.debugUi) throw new RouteError(404, "Not found.");
			return context.serveStatic(request);
		},
	},
} satisfies RouteMap<RouteContext>;
