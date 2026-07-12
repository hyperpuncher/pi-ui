const pending = new Set();
const commandParts = new WeakMap();
let scheduled = false;

export function classifyCommandChange(previous, current) {
	if (!previous || !current) return "refresh";
	return previous.input === current.input && previous.menu === current.menu
		? "refresh"
		: "reinitialize";
}

export function refresh(root = document) {
	if (!root) return;
	for (const component of componentsIn(root)) pending.add(component);
	scheduleRefresh();
}

export function bindBasecoatMorphs() {
	for (const command of document.querySelectorAll(".command")) {
		commandParts.set(command, getCommandParts(command));
	}

	const observer = new MutationObserver((records) => {
		for (const record of records) {
			if (record.target instanceof Element) {
				const command = record.target.closest(".command");
				refresh(command ?? record.target);
			}
			for (const node of record.addedNodes) {
				if (node instanceof Element) refresh(node);
			}
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
}

function scheduleRefresh() {
	if (scheduled || pending.size === 0) return;
	scheduled = true;
	queueMicrotask(() => {
		scheduled = false;
		const commands = [...pending].filter((component) =>
			component.matches?.(".command"),
		);
		const replaced = commands.filter(
			(command) =>
				classifyCommandChange(
					commandParts.get(command),
					getCommandParts(command),
				) === "reinitialize",
		);

		if (replaced.length > 0) {
			window.basecoat?.init?.("command", { force: true });
			for (const command of document.querySelectorAll(".command")) {
				commandParts.set(command, getCommandParts(command));
			}
			restoreSessionFocus(replaced);
		}

		for (const component of pending) {
			if (!replaced.includes(component)) component.refresh?.();
			if (component.matches?.(".command")) {
				commandParts.set(component, getCommandParts(component));
			}
		}
		pending.clear();
	});
}

function restoreSessionFocus(replaced) {
	if (!replaced.some((command) => command.closest("#session-dialog"))) return;
	requestAnimationFrame(() => {
		const dialog = document.getElementById("session-dialog");
		const input = document.getElementById("session-input");
		if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return;
		if (!(input instanceof HTMLInputElement)) return;
		const active = document.activeElement;
		if (active === document.body || active === input) {
			input.focus({ preventScroll: true });
		}
	});
}

function getCommandParts(command) {
	return {
		input: command.querySelector("header input"),
		menu: command.querySelector('[role="menu"]'),
	};
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
