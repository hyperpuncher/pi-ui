import { enumField, readActionSignals, requiredString } from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type RouteMap } from "../route.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

const directions = ["forward", "backward"] as const;

export const modelRoutes = {
	[endpoints.modelsRefresh]: {
		POST: async (request, context) => {
			await requireHost(context).refreshModels(
				AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
			);
			return datastarResponse();
		},
	},
	[endpoints.model]: {
		POST: async (request, context) => {
			const model = requiredString(await readActionSignals(request), "model");
			if (!(await requireHost(context).setModel(model))) {
				throw new RouteError(409, "Model could not be selected.");
			}
			return datastarResponse();
		},
	},
	[endpoints.modelCycle]: {
		POST: async (request, context) => {
			const direction = enumField(
				await readActionSignals(request),
				"modelCycleDirection",
				directions,
			);
			if (!(await requireHost(context).cycleModel(direction))) {
				throw new RouteError(409, "Model could not be cycled.");
			}
			return datastarResponse();
		},
	},
	[endpoints.modelsScopeToggle]: {
		POST: async (request, context) => {
			const model = requiredString(await readActionSignals(request), "model");
			if (!(await requireHost(context).toggleScopedModel(model))) {
				throw new RouteError(409, "Model scope could not be changed.");
			}
			return datastarResponse();
		},
	},
	[endpoints.thinking]: {
		POST: async (request, context) => {
			const level = requiredString(
				await readActionSignals(request),
				"thinkingLevel",
			);
			if (!(await requireHost(context).setThinkingLevel(level))) {
				throw new RouteError(409, "Thinking level could not be selected.");
			}
			return datastarResponse();
		},
	},
	[endpoints.thinkingCycle]: {
		POST: async (request, context) => {
			const direction = enumField(
				await readActionSignals(request),
				"thinkingCycleDirection",
				directions,
			);
			if (!requireHost(context).cycleThinkingLevel(direction)) {
				throw new RouteError(409, "Thinking level could not be cycled.");
			}
			return datastarResponse();
		},
	},
	[endpoints.thinkingVisibilityToggle]: {
		POST: (_request, context) => {
			if (!requireHost(context).toggleThinkingBlockVisibility()) {
				throw new RouteError(
					409,
					"Thinking block visibility could not be toggled.",
				);
			}
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;
