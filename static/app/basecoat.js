const pending = new Set();
let scheduled = false;

export function refresh(root = document) {
	if (!root) return;
	for (const component of componentsIn(root)) pending.add(component);
	if (scheduled || pending.size === 0) return;
	scheduled = true;
	queueMicrotask(() => {
		scheduled = false;
		for (const component of pending) {
			const state = captureOpenSessionCommand(component);
			component.refresh?.();
			restoreOpenSessionCommand(component, state);
		}
		pending.clear();
	});
}

function captureOpenSessionCommand(component) {
	const dialog = component.closest?.("#session-dialog");
	if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return;
	const input = component.querySelector("#session-input");
	const menu = component.querySelector("#session-menu");
	if (!(input instanceof HTMLInputElement) || !(menu instanceof HTMLElement)) return;
	return {
		activeId: input.getAttribute("aria-activedescendant"),
		scrollTop: menu.scrollTop,
	};
}

function restoreOpenSessionCommand(component, state) {
	if (!state) return;
	const menu = component.querySelector("#session-menu");
	const active = state.activeId && document.getElementById(state.activeId);
	if (
		menu instanceof HTMLElement &&
		active instanceof HTMLElement &&
		component.contains(active) &&
		active.getAttribute("aria-hidden") !== "true"
	) {
		active.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
	}
	if (menu instanceof HTMLElement) menu.scrollTop = state.scrollTop;
}

function componentsIn(root) {
	const components = [];
	if (root instanceof Element && isRefreshable(root)) components.push(root);
	for (const element of root.querySelectorAll?.(".command, .dropdown-menu") ?? []) {
		if (isRefreshable(element)) components.push(element);
	}
	return components;
}

function isRefreshable(value) {
	return typeof value.refresh === "function";
}
