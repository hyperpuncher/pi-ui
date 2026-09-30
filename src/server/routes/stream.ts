import { readActionSignals, stringField } from "../action-input.ts";
import { isDisplayClientId } from "../display-refresh.ts";
import { RouteError, type RouteMap } from "../route.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const streamRoutes = {
	[endpoints.notificationsStream]: {
		GET: (request, context) =>
			context.notificationClients.createStream(request.signal, () => ({
				elements: "",
				signals: "{}",
			})),
	},
	[endpoints.stream]: {
		GET: async (request, context, url) => {
			const parameters = url.searchParams;
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
			const query = parameters.has("datastar")
				? stringField(await readActionSignals(request), "sessionSearch")
				: "";
			return context.renderer.createStream(request.signal, clientId, query);
		},
	},
} satisfies RouteMap<RouteContext>;
