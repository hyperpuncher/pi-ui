import { datastarResponse } from "../datastar.ts";
import { readDisplayRefreshUpdate } from "../display-refresh.ts";
import { RouteError, type RouteMap } from "../route.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const displayRefreshRoutes = {
	[endpoints.displayRefresh]: {
		POST: async (request, context) => {
			const update = await readDisplayRefreshUpdate(request);
			if (!update) throw new RouteError(400, "Invalid display refresh rate.");
			context.renderer.setDisplayRefreshHz(update.clientId, update.hz);
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;
