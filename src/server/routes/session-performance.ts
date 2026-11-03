import {
	compile,
	int,
	num,
	obj,
	oneOf,
	type Static,
	str,
} from "@earendil-works/pi-schema";

import { sessionPerformance } from "#src/perf/session-performance.ts";
import { RouteError, type RouteMap } from "#src/server/route.ts";
import type { RouteContext } from "#src/server/routes/context.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";

const maxClientTransitionMs = 60_000;

const clientTransitionPaintSchema = obj(
	{
		runId: str({ minLength: 1, maxLength: 64 }),
		pageId: str({ minLength: 1, maxLength: 64 }),
		generation: int({ minimum: 1 }),
		origin: oneOf(["command", "observer"]),
		loadingObservedMs: num({ minimum: 0, maximum: maxClientTransitionMs }),
		firstTranscriptPatchMs: num({ minimum: 0, maximum: maxClientTransitionMs }),
		firstTranscriptFrameMs: num({ minimum: 0, maximum: maxClientTransitionMs }),
		readyObservedMs: num({ minimum: 0, maximum: maxClientTransitionMs }),
		readyFrameMs: num({ minimum: 0, maximum: maxClientTransitionMs }),
	},
	{ open: true },
);
const clientTransitionPaintValidator = compile(clientTransitionPaintSchema);

type ClientTransitionPaint = Static<typeof clientTransitionPaintSchema>;
type ClientTransitionPaintInput = Parameters<
	typeof clientTransitionPaintValidator.check
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
		!clientTransitionPaintValidator.check(value) ||
		value.loadingObservedMs > value.firstTranscriptPatchMs ||
		value.firstTranscriptPatchMs > value.firstTranscriptFrameMs ||
		value.loadingObservedMs > value.readyObservedMs ||
		value.readyObservedMs > value.readyFrameMs
	) {
		throw new RouteError(400, "Invalid performance metrics.");
	}
	return value;
}
