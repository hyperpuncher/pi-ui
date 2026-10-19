import { enumField, readActionSignals } from "#src/server/action-input.ts";
import { updateAppConfig } from "#src/server/app-config.ts";
import { datastarResponse } from "#src/server/datastar.ts";
import type { RouteMap } from "#src/server/route.ts";
import type { RouteContext } from "#src/server/routes/context.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";

export const themeRoutes = {
	[endpoints.theme]: {
		POST: async (request, context) => {
			const theme = enumField(await readActionSignals(request), "theme", [
				"system",
				"light",
				"dark",
			] as const);
			await updateAppConfig((config) => {
				config.theme = theme;
			});
			context.store.update(() => {
				context.store.theme = theme;
			});
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;
