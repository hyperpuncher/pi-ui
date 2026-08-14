import { readActionSignals, requiredString } from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerLlamaRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.llamaOpen, (_request, context) => {
		requireHost(context).openLlama();
		return datastarResponse();
	});
	router.register("POST", endpoints.llamaToggle, async (request, context) => {
		const model = requiredString(await readActionSignals(request), "llamaModel");
		if (!requireHost(context).toggleLlamaModel(model)) {
			throw new RouteError(409, "llama.cpp model action could not be started.");
		}
		return datastarResponse();
	});
	router.register("POST", endpoints.llamaClose, (_request, context) => {
		requireHost(context).closeLlama();
		return datastarResponse();
	});
}
