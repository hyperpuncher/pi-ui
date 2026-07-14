const pending = new Set();
let scheduled = false;

export function refresh(root = document) {
	if (!root) return;
	for (const component of componentsIn(root)) pending.add(component);
	if (scheduled || pending.size === 0) return;
	scheduled = true;
	queueMicrotask(() => {
		scheduled = false;
		for (const component of pending) component.refresh?.();
		pending.clear();
	});
}

export function bindBasecoatMorphs() {
	const observer = new MutationObserver((records) => {
		for (const record of records) {
			if (record.target instanceof Element) {
				refresh(record.target.closest(".command") ?? record.target);
			}
			for (const node of record.addedNodes) {
				if (node instanceof Element) refresh(node);
			}
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
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
