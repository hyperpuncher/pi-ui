import { isDisplayClientId } from "../display-refresh.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerStreamRoutes(router: ExactRouter<RouteContext>): void {
	router.register("GET", endpoints.stream, (request, context) => {
		const clientId = new URL(request.url).searchParams.get("clientId");
		if (!clientId || !isDisplayClientId(clientId)) {
			throw new RouteError(400, "Invalid display client ID.");
		}
		return context.renderer.createStream(request.signal, clientId);
	});
	router.register("GET", endpoints.pickersStream, (request, context) =>
		context.renderer.createPickersStream(request.signal),
	);
}
