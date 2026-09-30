import { fuzzyFilter } from "@earendil-works/pi-tui/dist/fuzzy.js";

import { getModelSelectorSearchText } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/model-search.js";
import { refreshControls } from "./controls.js";

export function filterModelSearch(input, query) {
	if (!(input instanceof HTMLInputElement)) return;
	const command = input.closest(".command");
	if (!(command instanceof HTMLElement)) return;
	const items = [...command.querySelectorAll('[role="menuitem"]')].filter(
		(item) => item instanceof HTMLElement,
	);
	const originalItems = items.toSorted(
		(first, second) =>
			Number(first.dataset.modelSearchOrder) -
			Number(second.dataset.modelSearchOrder),
	);
	const matches = fuzzyFilter(originalItems, query, (item) =>
		modelSearchText(
			item.dataset.modelId ?? "",
			item.dataset.modelProvider ?? "",
			item.dataset.modelName ?? "",
		),
	);
	const visible = new Set(matches);
	const orderedItems = query.trim()
		? [...matches, ...originalItems.filter((item) => !visible.has(item))]
		: originalItems;

	for (const item of orderedItems) {
		item.hidden = !visible.has(item);
		const row = item.parentElement;
		row?.parentElement?.append(row);
	}
	refreshControls(command);
}

export function modelSearchText(id, provider, name) {
	// Preserve camel-case boundaries that pi's case-insensitive matcher cannot see.
	const expandedName = name.replace(/([\p{Ll}\d])(\p{Lu})/gu, "$1 $2");
	return `${expandedName} ${id} ${provider} ${name} ${getModelSelectorSearchText({ id, provider, name })}`;
}
