function openAndFocus(dialogId, inputId) {
	const dialog = document.getElementById(dialogId);
	if (!(dialog instanceof HTMLDialogElement)) return;
	if (!dialog.open) dialog.showModal();
	requestAnimationFrame(() => {
		const input = document.getElementById(inputId);
		if (input instanceof HTMLInputElement) input.focus({ preventScroll: true });
	});
}

export function openSession() {
	openAndFocus("session-dialog", "session-input");
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
