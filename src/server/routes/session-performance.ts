import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

import { sessionPerformance } from "../../perf/session-performance.ts";
import { RouteError, type RouteMap } from "../route.ts";
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

export const sessionPerformanceRoutes = {
	[endpoints.sessionPerformanceClient]: {
		POST: async (request) => {
			if (!sessionPerformance.enabled) return new Response(null, { status: 204 });
			const metrics = parseClientTransitionPaint(await request.json());
			sessionPerformance.recordClientTransitionPaint(metrics);
			return new Response(null, { status: 204 });
		},
	},
} satisfies RouteMap<RouteContext>;

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
