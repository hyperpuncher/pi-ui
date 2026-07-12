import type { ExactRouter } from "../router.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerStreamRoutes(router: ExactRouter<RouteContext>): void {
	router.register("GET", endpoints.stream, (request, context) =>
		context.renderer.createStream(request.signal),
	);
}
