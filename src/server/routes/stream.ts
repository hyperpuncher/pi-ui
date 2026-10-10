import { optionalString, readActionSignals } from "../action-input.ts";
import type { RouteMap } from "../route.ts";
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
			if (parameters.get("appVersion") !== context.appVersion) {
				return new Response("location.reload();", {
					headers: {
						"cache-control": "no-store",
						"content-type": "text/javascript; charset=utf-8",
					},
				});
			}
			const signals = parameters.has("datastar")
				? await readActionSignals(request)
				: {};
			const query = optionalString(signals, "sessionSearch") ?? "";
			const workspaceQuery = optionalString(signals, "workspaceDraft") ?? "";
			const slashQuery = optionalString(signals, "slashSearch") ?? "";
			return context.renderer.createStream(
				request.signal,
				query,
				workspaceQuery,
				slashQuery,
			);
		},
	},
} satisfies RouteMap<RouteContext>;
