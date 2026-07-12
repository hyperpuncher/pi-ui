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
	let navigating = false;

	router.register("POST", endpoints.treeOpen, (_request, context) => {
		requireHost(context).openTree();
		return datastarResponse(treeOpenEvents(context));
	});
	router.register("POST", endpoints.treeNavigate, async (request, context) => {
		if (navigating) throw new RouteError(409, "Tree navigation is already running.");
		const signals = await readActionSignals(request);
		const entryId = requiredString(signals, "treeEntryId");
		const summarize = booleanField(signals, "treeSummarize", { optional: true });
		const customInstructions =
			optionalString(signals, "treeSummaryInstructions")?.trim() || undefined;
		navigating = true;
		try {
			const editorText = await requireHost(context).navigateTree(entryId, {
				summarize,
				customInstructions,
			});
			return datastarResponse([
				{ type: "signals", signals: { prompt: editorText ?? "" } },
				{ type: "effect", effect: { type: "focus-prompt" } },
			]);
		} finally {
			navigating = false;
		}
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
