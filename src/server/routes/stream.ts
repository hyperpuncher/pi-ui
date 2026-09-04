import { isDisplayClientId } from "../display-refresh.ts";
import { RouteError, type RouteMap } from "../route.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const streamRoutes = {
	[endpoints.stream]: {
		GET: (request, context) => {
			const parameters = new URL(request.url).searchParams;
			const clientId = parameters.get("clientId");
			if (!clientId || !isDisplayClientId(clientId)) {
				throw new RouteError(400, "Invalid display client ID.");
			}
			if (parameters.get("appVersion") !== context.appVersion) {
				return new Response("location.reload();", {
					headers: {
						"cache-control": "no-store",
						"content-type": "text/javascript; charset=utf-8",
					},
				});
			}
			return context.renderer.createStream(request.signal, clientId);
		},
	},
} satisfies RouteMap<RouteContext>;
