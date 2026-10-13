import { RouteError, type RouteMap } from "#src/server/route.ts";
import type { RouteContext } from "#src/server/routes/context.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";
import { renderPage } from "#src/ui/page.tsx";

export const assetRoutes = {
	[endpoints.root]: {
		GET: (_request, context) =>
			new Response(
				renderPage(context.renderer.projectState(context.store.snapshot()), {
					appVersion: context.appVersion,
					sessionSidebarOpen: context.store.sessionSidebarOpen,
					sessionSidebarWidth: context.store.sessionSidebarWidth,
					themeLab: context.themeLab,
				}),
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
