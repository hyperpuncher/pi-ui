function openAndFocus(dialogId, inputId) {
	const dialog = document.getElementById(dialogId);
	if (!(dialog instanceof HTMLDialogElement)) return;
	if (!dialog.open) {
		restoreFocusWhenDialogCloses(dialog, document.activeElement);
		dialog.showModal();
	}
	requestAnimationFrame(() => {
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
	const input = document.getElementById("session-input");
	if (input instanceof HTMLInputElement) {
		input.value = "";
		input.dispatchEvent(new Event("input", { bubbles: true }));
	}
	const menu = document.getElementById("session-menu");
	if (menu instanceof HTMLElement) menu.scrollTop = 0;
	openAndFocus("session-dialog", "session-input");
	return true;
}

export function openTree() {
	openAndFocus("tree-dialog", "tree-input");
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

export function togglePopover(triggerId) {
	const trigger = document.getElementById(triggerId);
	if (!(trigger instanceof HTMLButtonElement)) return false;
	const opening = trigger.getAttribute("aria-expanded") !== "true";
	if (opening) restoreFocusWhenPopoverCloses(trigger, document.activeElement);
	trigger.click();
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
	resetWorkspaceInput();
	openAndFocus("workspace-dialog", "workspace-input");
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

function resetWorkspaceInput() {
	const input = document.getElementById("workspace-input");
	if (!(input instanceof HTMLInputElement)) return;
	input.value = "";
	input.dispatchEvent(new Event("input", { bubbles: true }));
}
