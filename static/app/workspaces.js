function showPickerError(message) {
	const error = document.getElementById("workspace-picker-error");
	if (!(error instanceof HTMLElement)) return;
	error.textContent = message;
	error.hidden = !message;
}

export async function pickDirectory() {
	showPickerError("");
	try {
		const endpoint = document.body.dataset.workspacePickEndpoint;
		const response = await fetch(endpoint, { method: "POST" });
		if (!response.ok) throw new Error(`Native picker failed: ${response.status}`);
		const result = await response.json();
		if (typeof result.path !== "string" || !result.path) return;
		window.dispatchEvent(
			new CustomEvent("pi-ui-workspace-picked", {
				detail: { path: result.path },
			}),
		);
	} catch (error) {
		console.error(error);
		showPickerError(error?.message || "Could not open the native folder picker.");
	}
}
