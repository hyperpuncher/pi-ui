import { booleanField, readActionSignals } from "../action-input.ts";
import { updateAppConfig } from "../app-config.ts";
import { datastarResponse } from "../datastar.ts";
import type { RouteMap } from "../route.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const keybindHintRoutes = {
	[endpoints.keybindHints]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			const keybindHints = booleanField(signals, "keybindHints");
			await updateAppConfig((config) => {
				config.keybindHints = keybindHints;
			});
			context.keybindHints = keybindHints;
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;
