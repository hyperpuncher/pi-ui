import { refreshControls, togglePopup } from "./controls.js";

function openAndFocus(dialogId, inputId, options = {}) {
	const dialog = document.getElementById(dialogId);
	if (!(dialog instanceof HTMLDialogElement)) return;
	if (!dialog.open) {
		restoreFocusWhenDialogCloses(dialog, document.activeElement);
		resetSearchInput(document.getElementById(inputId));
		dialog.showModal();
	}
	refreshControls(dialog);
	requestAnimationFrame(() => {
		const activeItem = options.activeSelector
			? dialog.querySelector(options.activeSelector)
			: undefined;
		activeItem?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
		activeItem?.scrollIntoView({ block: "center" });
		const input = document.getElementById(inputId);
		if (input instanceof HTMLInputElement) input.focus({ preventScroll: true });
	});
}

function restoreFocusWhenDialogCloses(dialog, origin) {
	dialog.addEventListener(
		"close",
		() => {
			setTimeout(() => restoreFocus(origin), 0);
		},
		{ once: true },
	);
}

function restoreFocus(origin) {
	if (!(origin instanceof HTMLElement)) return;
	const target = origin.isConnected
		? origin
		: origin.id
			? document.getElementById(origin.id)
			: undefined;
	if (!(target instanceof HTMLElement)) return;
	if (document.activeElement === target) target.blur();
	target.focus({ preventScroll: true });
}

export function toggleSession() {
	const dialog = document.getElementById("session-dialog");
	if (!(dialog instanceof HTMLDialogElement)) return false;
	if (dialog.open) {
		dialog.close();
		return false;
	}
	openAndFocus("session-dialog", "session-input");
	return true;
}

export function openTree() {
	resetBoundInput(document.getElementById("tree-selected-id"));
	openAndFocus("tree-dialog", "tree-input", {
		activeSelector: "[data-active-tree-row]",
	});
}

export function openCommand() {
	openAndFocus("command-dialog", "command-input");
}

export function toggleCommand() {
	const dialog = document.getElementById("command-dialog");
	if (!(dialog instanceof HTMLDialogElement)) return false;
	if (dialog.open) {
		dialog.close();
		return false;
	}
	openCommand();
	return true;
}

export function bindDialogs() {
	document.addEventListener(
		"click",
		(event) => {
			const trigger =
				event.target instanceof Element
					? event.target.closest("button[aria-haspopup][aria-expanded]")
					: undefined;
			if (!(trigger instanceof HTMLButtonElement)) return;
			if (trigger.getAttribute("aria-expanded") === "true") return;
			const picker = trigger.closest(".popover, .dropdown-menu");
			resetSearchInput(
				picker?.querySelector("input[role='combobox'], input[type='search']"),
			);
		},
		{ capture: true },
	);
}

export function togglePopover(triggerId) {
	const trigger = document.getElementById(triggerId);
	if (!(trigger instanceof HTMLButtonElement)) return false;
	const opening = trigger.getAttribute("aria-expanded") !== "true";
	if (opening) restoreFocusWhenPopoverCloses(trigger, document.activeElement);
	togglePopup(triggerId);
	return opening;
}

function restoreFocusWhenPopoverCloses(trigger, origin) {
	const observer = new MutationObserver(() => {
		if (trigger.getAttribute("aria-expanded") === "true") return;
		observer.disconnect();
		restoreFocus(origin);
	});
	observer.observe(trigger, { attributeFilter: ["aria-expanded"] });
}

export function openWorkspace() {
	openAndFocus("workspace-dialog", "workspace-input");
}

export function openWorkspaceBrowser() {
	const dialog = document.getElementById("workspace-browser-dialog");
	if (!(dialog instanceof HTMLDialogElement)) return;
	if (!dialog.open) {
		document.getElementById("workspace-dialog")?.close();
		restoreFocusWhenDialogCloses(dialog, document.getElementById("workspace-picker"));
		dialog.showModal();
	}
	refreshControls(dialog);
}

export function toggleWorkspace() {
	const dialog = document.getElementById("workspace-dialog");
	if (!(dialog instanceof HTMLDialogElement)) return false;
	if (dialog.open) {
		dialog.close();
		return false;
	}
	openWorkspace();
	return true;
}

function resetBoundInput(input) {
	if (!(input instanceof HTMLInputElement)) return;
	input.value = "";
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function resetSearchInput(input) {
	if (!(input instanceof HTMLInputElement)) return;
	resetBoundInput(input);
	const menuId = input.getAttribute("aria-controls");
	const menu = menuId ? document.getElementById(menuId) : undefined;
	if (menu instanceof HTMLElement) menu.scrollTop = 0;
}
