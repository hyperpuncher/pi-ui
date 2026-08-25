import { booleanField, readActionSignals } from "../action-input.ts";
import { updateAppConfig } from "../app-config.ts";
import { datastarResponse } from "../datastar.ts";
import type { ExactRouter } from "../router.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerDisplayPreferenceRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.minimalMode, async (request, context) => {
		const minimalMode = booleanField(await readActionSignals(request), "minimalMode");
		await updateAppConfig((config) => {
			config.minimalMode = minimalMode;
		});
		context.minimalMode = minimalMode;
		return datastarResponse();
	});

	router.register("POST", endpoints.toolOutput, async (request, context) => {
		const toolOutputHidden = booleanField(
			await readActionSignals(request),
			"toolOutputHidden",
		);
		await updateAppConfig((config) => {
			config.toolOutputHidden = toolOutputHidden;
		});
		context.toolOutputHidden = toolOutputHidden;
		return datastarResponse();
	});
}
