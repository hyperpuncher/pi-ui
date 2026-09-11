import { booleanField, readActionSignals } from "../action-input.ts";
import { updateAppConfig } from "../app-config.ts";
import { datastarResponse } from "../datastar.ts";
import type { RouteMap } from "../route.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

const booleanPreferences = [
	{ endpoint: endpoints.keybindHints, signal: "keybindHints" },
	{ endpoint: endpoints.minimalMode, signal: "minimalMode" },
	{ endpoint: endpoints.toolOutput, signal: "toolOutputHidden" },
	{ endpoint: endpoints.toolbar, signal: "toolbarHidden" },
] as const;

export const displayPreferenceRoutes = Object.fromEntries(
	booleanPreferences.map(({ endpoint, signal }) => [
		endpoint,
		{
			POST: async (request: Request, context: RouteContext) => {
				const value = booleanField(await readActionSignals(request), signal);
				await updateAppConfig((config) => {
					config[signal] = value;
				});
				context[signal] = value;
				return datastarResponse();
			},
		},
	]),
) satisfies RouteMap<RouteContext>;
