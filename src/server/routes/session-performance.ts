import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

import { sessionPerformance } from "#src/perf/session-performance.ts";
import { RouteError, type RouteMap } from "#src/server/route.ts";
import type { RouteContext } from "#src/server/routes/context.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";

const maxClientTransitionMs = 60_000;

const clientTransitionPaintSchema = Type.Object({
	runId: Type.String({ minLength: 1, maxLength: 64 }),
	pageId: Type.String({ minLength: 1, maxLength: 64 }),
	generation: Type.Integer({ minimum: 1 }),
	origin: Type.Union([Type.Literal("command"), Type.Literal("observer")]),
	loadingObservedMs: Type.Number({ minimum: 0, maximum: maxClientTransitionMs }),
	firstTranscriptPatchMs: Type.Number({ minimum: 0, maximum: maxClientTransitionMs }),
	firstTranscriptFrameMs: Type.Number({ minimum: 0, maximum: maxClientTransitionMs }),
	readyObservedMs: Type.Number({ minimum: 0, maximum: maxClientTransitionMs }),
	readyFrameMs: Type.Number({ minimum: 0, maximum: maxClientTransitionMs }),
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
		value.loadingObservedMs > value.firstTranscriptPatchMs ||
		value.firstTranscriptPatchMs > value.firstTranscriptFrameMs ||
		value.loadingObservedMs > value.readyObservedMs ||
		value.readyObservedMs > value.readyFrameMs
	) {
		throw new RouteError(400, "Invalid performance metrics.");
	}
	return value;
}
