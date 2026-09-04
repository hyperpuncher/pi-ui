import {
	booleanField,
	optionalString,
	readActionSignals,
	requiredString,
} from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type RouteMap } from "../route.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

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
