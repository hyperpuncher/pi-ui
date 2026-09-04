import {
	booleanField,
	optionalString,
	readActionSignals,
	requiredString,
} from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerTreeRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.treeOpen, (_request, context) => {
		requireHost(context).openTree();
		return datastarResponse();
	});
	router.register("POST", endpoints.treeNavigate, async (request, context) => {
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
	});
}
