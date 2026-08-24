import { booleanField, readActionSignals } from "../action-input.ts";
import { updateAppConfig } from "../app-config.ts";
import { datastarResponse } from "../datastar.ts";
import type { ExactRouter } from "../router.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerKeybindHintRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.keybindHints, async (request, context) => {
		const signals = await readActionSignals(request);
		const keybindHints = booleanField(signals, "keybindHints");
		await updateAppConfig((config) => {
			config.keybindHints = keybindHints;
		});
		context.keybindHints = keybindHints;
		return datastarResponse();
	});
}
