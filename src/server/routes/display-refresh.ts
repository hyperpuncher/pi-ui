import { datastarResponse } from "../datastar.ts";
import { readDisplayRefreshUpdate } from "../display-refresh.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerDisplayRefreshRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.displayRefresh, async (request, context) => {
		const update = await readDisplayRefreshUpdate(request);
		if (!update) throw new RouteError(400, "Invalid display refresh rate.");
		context.renderer.setDisplayRefreshHz(update.hz);
		return datastarResponse();
	});
}
