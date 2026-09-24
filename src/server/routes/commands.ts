import { renderArgumentPickerResults } from "../../ui/pickers.tsx";
import { readActionSignals, requiredString, stringField } from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import type { RouteMap } from "../route.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const commandRoutes = {
	[endpoints.commandArgumentCompletions]: {
		GET: async (request, context) => {
			const signals = await readActionSignals(request);
			const command = requiredString(signals, "argumentCommand");
			const argumentPrefix = stringField(signals, "argumentPrefix");
			const items = await requireHost(context).getArgumentCompletions(
				command,
				argumentPrefix,
			);
			return datastarResponse([
				{
					type: "elements",
					elements: renderArgumentPickerResults(items),
				},
				{ type: "signals", signals: { _argumentPickerOpen: items.length > 0 } },
			]);
		},
	},
} satisfies RouteMap<RouteContext>;
