import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

import { sessionPerformance } from "../../perf/session-performance.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

const maxClientTransitionMs = 60_000;

const clientTransitionPaintSchema = Type.Object({
	generation: Type.Integer({ minimum: 1, maximum: maxClientTransitionMs }),
	clickToLoadingMs: Type.Number({ minimum: 0, maximum: maxClientTransitionMs }),
	clickToMorphMs: Type.Number({ minimum: 0, maximum: maxClientTransitionMs }),
	clickToPaintMs: Type.Number({ minimum: 0, maximum: maxClientTransitionMs }),
});
const clientTransitionPaintValidator = Compile(clientTransitionPaintSchema);

type ClientTransitionPaint = Static<typeof clientTransitionPaintSchema>;
type ClientTransitionPaintInput = Parameters<
	typeof clientTransitionPaintValidator.Check
>[0];

export function registerSessionPerformanceRoutes(
	router: ExactRouter<RouteContext>,
): void {
	router.register("POST", endpoints.sessionPerformanceClient, async (request) => {
		if (!sessionPerformance.enabled) return new Response(null, { status: 204 });
		const metrics = parseClientTransitionPaint(await request.json());
		sessionPerformance.recordClientTransitionPaint(metrics);
		return new Response(null, { status: 204 });
	});
}

export function parseClientTransitionPaint(
	value: ClientTransitionPaintInput,
): ClientTransitionPaint {
	if (
		!clientTransitionPaintValidator.Check(value) ||
		value.clickToLoadingMs > value.clickToMorphMs ||
		value.clickToMorphMs > value.clickToPaintMs
	) {
		throw new RouteError(400, "Invalid performance metrics.");
	}
	return value;
}
