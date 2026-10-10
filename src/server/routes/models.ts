import { fuzzyFilter } from "@earendil-works/pi-tui";

import { renderModelOptions } from "../../ui/prompt-pickers.tsx";
import { modelSearchText } from "../../utils/model-search.ts";
import {
	enumField,
	optionalString,
	readActionSignals,
	requiredString,
} from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type RouteMap } from "../route.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

const directions = ["forward", "backward"] as const;

/** Caps one picker payload so hundreds of models stay out of every patch. */
export const maxModelOptions = 60;

export const modelRoutes = {
	[endpoints.modelsRefresh]: {
		POST: async (request, context) => {
			await requireHost(context).refreshModels(
				AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
			);
			return datastarResponse();
		},
	},
	[endpoints.modelsList]: {
		GET: async (request, context) => {
			const signals = await readActionSignals(request);
			const query = optionalString(signals, "modelSearch") ?? "";
			const { models, currentModel } = context.store;
			const filtered = query.trim()
				? fuzzyFilter([...models], query, (model) =>
						modelSearchText(model.id, model.provider, model.name),
					)
				: [...models];
			const shown = filtered.slice(0, maxModelOptions);
			const hidden = filtered.length - shown.length;
			return datastarResponse([
				{
					type: "elements",
					elements: `<div id="model-select-options" data-ignore-morph data-init="window.piUi.controls.refresh(el.closest('.command'))">${renderModelOptions(shown, currentModel)}${hidden > 0 ? `<div class="fine-print model-options-more" role="status">${hidden} more — keep typing to narrow</div>` : ""}</div>`,
					options: { selector: "#model-select-options", mode: "replace" },
				},
			]);
		},
	},
	[endpoints.model]: {
		POST: async (request, context) => {
			const model = requiredString(await readActionSignals(request), "model");
			if (!(await requireHost(context).setModel(model))) {
				throw new RouteError(409, "Model could not be selected.");
			}
			return datastarResponse();
		},
	},
	[endpoints.modelCycle]: {
		POST: async (request, context) => {
			const direction = enumField(
				await readActionSignals(request),
				"modelCycleDirection",
				directions,
			);
			if (!(await requireHost(context).cycleModel(direction))) {
				throw new RouteError(409, "Model could not be cycled.");
			}
			return datastarResponse();
		},
	},
	[endpoints.modelsScopeToggle]: {
		POST: async (request, context) => {
			const model = requiredString(await readActionSignals(request), "model");
			if (!(await requireHost(context).toggleScopedModel(model))) {
				throw new RouteError(409, "Model scope could not be changed.");
			}
			return datastarResponse();
		},
	},
	[endpoints.thinking]: {
		POST: async (request, context) => {
			const level = requiredString(
				await readActionSignals(request),
				"thinkingLevel",
			);
			if (!(await requireHost(context).setThinkingLevel(level))) {
				throw new RouteError(409, "Thinking level could not be selected.");
			}
			return datastarResponse();
		},
	},
	[endpoints.thinkingCycle]: {
		POST: async (request, context) => {
			const direction = enumField(
				await readActionSignals(request),
				"thinkingCycleDirection",
				directions,
			);
			if (!requireHost(context).cycleThinkingLevel(direction)) {
				throw new RouteError(409, "Thinking level could not be cycled.");
			}
			return datastarResponse();
		},
	},
	[endpoints.thinkingVisibilityToggle]: {
		POST: (_request, context) => {
			if (!requireHost(context).toggleThinkingBlockVisibility()) {
				throw new RouteError(
					409,
					"Thinking block visibility could not be toggled.",
				);
			}
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;
