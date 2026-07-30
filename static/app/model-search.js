import { fuzzyFilter } from "@earendil-works/pi-tui/dist/fuzzy.js";

export function bindModelSearch() {
	document.addEventListener("input", (event) => {
		const input = event.target;
		if (!(input instanceof HTMLInputElement) || input.id !== "model-select-input") {
			return;
		}
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
		const matches = fuzzyFilter(originalItems, input.value, (item) =>
			modelSearchText(item.dataset.filter ?? "", item.dataset.keywords ?? ""),
		);
		const visible = new Set(matches);
		const orderedItems = input.value.trim()
			? [...matches, ...originalItems.filter((item) => !visible.has(item))]
			: originalItems;

		for (const item of orderedItems) {
			item.setAttribute("aria-hidden", String(!visible.has(item)));
			item.parentElement?.append(item);
		}
		command.refresh?.();
	});
}

export function modelSearchText(modelAndProvider, name) {
	// Preserve camel-case boundaries that pi's case-insensitive matcher cannot see.
	const expandedName = name.replace(/([\p{Ll}\d])(\p{Lu})/gu, "$1 $2");
	return `${expandedName} ${modelAndProvider} ${name}`;
}
