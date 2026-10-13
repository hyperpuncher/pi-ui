import { readActionSignals, requiredString } from "#src/server/action-input.ts";
import { datastarResponse } from "#src/server/datastar.ts";
import { RouteError, type RouteMap } from "#src/server/route.ts";
import { requireHost, type RouteContext } from "#src/server/routes/context.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";

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
