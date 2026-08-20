import {
	booleanField,
	readActionSignals,
	requiredString,
	stringField,
} from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import type { ExactRouter } from "../router.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerExtensionUiRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.extensionUiEditor, async (request, context) => {
		const signals = await readActionSignals(request);
		context.store.setPromptEditorText(stringField(signals, "prompt"), {
			broadcast: false,
		});
		return datastarResponse();
	});
	router.register("POST", endpoints.extensionUiResponse, async (request, context) => {
		const signals = await readActionSignals(request);
		requireHost(context).respondExtensionUi(
			requiredString(signals, "extensionRequestId"),
			stringField(signals, "extensionResponse"),
			booleanField(signals, "extensionCancelled", { optional: true }),
		);
		return datastarResponse();
	});
}
