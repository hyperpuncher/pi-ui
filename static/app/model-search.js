import { fuzzyFilter } from "@earendil-works/pi-tui/dist/fuzzy.js";

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
		modelSearchText(item.dataset.filter ?? "", item.dataset.keywords ?? ""),
	);
	const visible = new Set(matches);
	const orderedItems = query.trim()
		? [...matches, ...originalItems.filter((item) => !visible.has(item))]
		: originalItems;

	for (const item of orderedItems) {
		// Basecoat 1.0.2 tracks the active item by index. Reordering before
		// refresh() can otherwise leave the old item active as well.
		item.classList.remove("active");
		item.setAttribute("aria-hidden", String(!visible.has(item)));
		item.parentElement?.append(item);
	}
	command.refresh?.();
}

export function modelSearchText(modelAndProvider, name) {
	// Preserve camel-case boundaries that pi's case-insensitive matcher cannot see.
	const expandedName = name.replace(/([\p{Ll}\d])(\p{Lu})/gu, "$1 $2");
	return `${expandedName} ${modelAndProvider} ${name}`;
}
