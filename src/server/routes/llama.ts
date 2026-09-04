import { readActionSignals, requiredString } from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type RouteMap } from "../route.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const llamaRoutes = {
	[endpoints.llamaOpen]: {
		POST: (_request, context) => {
			requireHost(context).openLlama();
			return datastarResponse();
		},
	},
	[endpoints.llamaToggle]: {
		POST: async (request, context) => {
			const model = requiredString(await readActionSignals(request), "llamaModel");
			if (!requireHost(context).toggleLlamaModel(model)) {
				throw new RouteError(409, "llama.cpp model action could not be started.");
			}
			return datastarResponse();
		},
	},
	[endpoints.llamaClose]: {
		POST: (_request, context) => {
			requireHost(context).closeLlama();
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;
