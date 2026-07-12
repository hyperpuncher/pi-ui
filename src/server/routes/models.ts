import { enumField, readActionSignals, requiredString } from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

const directions = ["forward", "backward"] as const;

export function registerModelRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.model, async (request, context) => {
		const model = requiredString(await readActionSignals(request), "model");
		if (!(await requireHost(context).setModel(model))) {
			throw new RouteError(409, "Model could not be selected.");
		}
		return datastarResponse();
	});
	router.register("POST", endpoints.modelCycle, async (request, context) => {
		const direction = enumField(
			await readActionSignals(request),
			"modelCycleDirection",
			directions,
		);
		if (!(await requireHost(context).cycleModel(direction))) {
			throw new RouteError(409, "Model could not be cycled.");
		}
		return datastarResponse();
	});
	router.register("POST", endpoints.modelsScopeToggle, async (request, context) => {
		const model = requiredString(await readActionSignals(request), "model");
		if (!(await requireHost(context).toggleScopedModel(model))) {
			throw new RouteError(409, "Model scope could not be changed.");
		}
		return datastarResponse();
	});
	router.register("POST", endpoints.thinking, async (request, context) => {
		const level = requiredString(await readActionSignals(request), "thinkingLevel");
		if (!(await requireHost(context).setThinkingLevel(level))) {
			throw new RouteError(409, "Thinking level could not be selected.");
		}
		return datastarResponse();
	});
	router.register("POST", endpoints.thinkingCycle, async (request, context) => {
		const direction = enumField(
			await readActionSignals(request),
			"thinkingCycleDirection",
			directions,
		);
		if (!requireHost(context).cycleThinkingLevel(direction)) {
			throw new RouteError(409, "Thinking level could not be cycled.");
		}
		return datastarResponse();
	});
}
