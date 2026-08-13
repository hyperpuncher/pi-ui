import { sessionPerformance } from "../../perf/session-performance.ts";
import { isRecord } from "../../utils/type-guards.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

const maxClientTransitionMs = 60_000;

type ClientTransitionPaint = {
	generation: number;
	clickToLoadingMs: number;
	clickToMorphMs: number;
	clickToPaintMs: number;
};

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

export function parseClientTransitionPaint(value: unknown): ClientTransitionPaint {
	if (!isRecord(value)) throw new RouteError(400, "Invalid performance metrics.");
	const metrics = {
		generation: finiteMetric(value.generation),
		clickToLoadingMs: finiteMetric(value.clickToLoadingMs),
		clickToMorphMs: finiteMetric(value.clickToMorphMs),
		clickToPaintMs: finiteMetric(value.clickToPaintMs),
	};
	if (
		!Number.isInteger(metrics.generation) ||
		metrics.generation < 1 ||
		metrics.clickToLoadingMs > metrics.clickToMorphMs ||
		metrics.clickToMorphMs > metrics.clickToPaintMs
	) {
		throw new RouteError(400, "Invalid performance metrics.");
	}
	return metrics;
}

function finiteMetric(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > maxClientTransitionMs
	) {
		throw new RouteError(400, "Invalid performance metrics.");
	}
	return value;
}
