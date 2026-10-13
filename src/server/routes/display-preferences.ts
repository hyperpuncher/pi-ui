import { booleanField, readActionSignals } from "#src/server/action-input.ts";
import { updateAppConfig } from "#src/server/app-config.ts";
import { datastarResponse } from "#src/server/datastar.ts";
import type { RouteMap } from "#src/server/route.ts";
import type { RouteContext } from "#src/server/routes/context.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";

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
				context.store.update(() => {
					context.store[signal] = value;
				});
				return datastarResponse();
			},
		},
	]),
) satisfies RouteMap<RouteContext>;
