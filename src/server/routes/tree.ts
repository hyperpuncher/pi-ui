import type { Jsonifiable } from "@starfederation/datastar-sdk/types";

import { renderTreePicker } from "../../ui/tree-picker.tsx";
import {
	booleanField,
	optionalString,
	readActionSignals,
	requiredString,
} from "../action-input.ts";
import { datastarResponse, type DatastarEvent } from "../datastar.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerTreeRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.treeOpen, (_request, context) => {
		requireHost(context).openTree();
		return datastarResponse(treeOpenEvents(context));
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

export function treeOpenEvents(
	context: Pick<RouteContext, "store">,
	signals: Record<string, Jsonifiable> = {},
): DatastarEvent[] {
	const events: DatastarEvent[] = [
		{
			type: "elements",
			elements: renderTreePicker(context.store.snapshot()),
		},
	];
	if (Object.keys(signals).length > 0) events.push({ type: "signals", signals });
	events.push({ type: "effect", effect: { type: "open-tree" } });
	return events;
}
