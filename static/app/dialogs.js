function openAndFocus(dialogId, inputId) {
	const dialog = document.getElementById(dialogId);
	if (!(dialog instanceof HTMLDialogElement)) return;
	if (!dialog.open) dialog.showModal();
	requestAnimationFrame(() => {
		const input = document.getElementById(inputId);
		if (input instanceof HTMLInputElement) input.focus({ preventScroll: true });
	});
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

export function openWorkspace() {
	const input = document.getElementById("workspace-input");
	if (input instanceof HTMLInputElement) {
		input.value = "";
		input.dispatchEvent(new Event("input", { bubbles: true }));
	}
	openAndFocus("workspace-dialog", "workspace-input");
}

export function bindDialogs() {
	// Dialog opening is intentionally synchronous in Datastar actions. This module
	// only owns browser focus behavior and the reusable tree entrypoint.
}
