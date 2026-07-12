export function openTree() {
	const dialog = document.getElementById("tree-dialog");
	if (!(dialog instanceof HTMLDialogElement)) return;
	if (!dialog.open) dialog.showModal();
	requestAnimationFrame(() => {
		const input = document.getElementById("tree-input");
		if (input instanceof HTMLInputElement) input.focus({ preventScroll: true });
	});
}

export function bindDialogs() {
	// Dialog opening is intentionally synchronous in Datastar actions. This module
	// only owns browser focus behavior and the reusable tree entrypoint.
}
