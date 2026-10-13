import {
	booleanField,
	optionalString,
	readActionSignals,
	requiredString,
} from "#src/server/action-input.ts";
import { datastarResponse } from "#src/server/datastar.ts";
import { RouteError, type RouteMap } from "#src/server/route.ts";
import { requireHost, type RouteContext } from "#src/server/routes/context.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";

export const treeRoutes = {
	[endpoints.treeOpen]: {
		POST: (_request, context) => {
			requireHost(context).openTree();
			return datastarResponse();
		},
	},
	[endpoints.treeNavigate]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			const entryId = requiredString(signals, "treeEntryId");
			const summarize = booleanField(signals, "treeSummarize", { optional: true });
			const customInstructions =
				optionalString(signals, "treeSummaryInstructions")?.trim() || undefined;
			const host = requireHost(context);
			const result = await host.navigateTree(entryId, {
				summarize,
				customInstructions,
			});
			if (context.resources.host !== host) return datastarResponse([]);
			if (result.status === "busy") {
				throw new RouteError(409, "Tree navigation is already running.");
			}
			if (result.status === "cancelled") return datastarResponse([]);
			return datastarResponse([
				{ type: "signals", signals: { prompt: result.editorText ?? "" } },
				{ type: "effect", effect: { type: "focus-prompt" } },
			]);
		},
	},
} satisfies RouteMap<RouteContext>;
