import { isHtmlFileUri } from "../file-uri.js";

export function bindFileLinks() {
	document.addEventListener(
		"click",
		(event) => {
			if (event.button !== 0) return;
			const link =
				event.target instanceof Element ? event.target.closest("a[href]") : null;
			if (!(link instanceof HTMLAnchorElement)) return;
			const markedUri = link.getAttribute("data-pi-file-link") ?? "";
			const uri = isFileUri(markedUri) ? markedUri : link.href;
			if (!isFileUri(uri)) return;

			// File navigation is forbidden from the HTTP UI. Claim the click even if
			// another client handler already prevented it, then delegate to the backend.
			event.preventDefault();
			if (isHtmlFileUri(uri)) {
				const endpoint = document.body.dataset.filesOpenEndpoint;
				if (endpoint)
					window.open(
						`${endpoint}?uri=${encodeURIComponent(uri)}`,
						"_blank",
						"noopener,noreferrer",
					);
			} else {
				void followFileLink(uri);
			}
		},
		{ capture: true },
	);
}

export function isFileUri(uri) {
	try {
		return new URL(uri).protocol === "file:";
	} catch {
		return false;
	}
}

async function followFileLink(uri) {
	const endpoint = document.body.dataset.filesOpenEndpoint;
	if (!endpoint) return;

	try {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ uri }),
		});
		if (!response.ok) throw new Error(await responseError(response));
		const { path, workspacePath } = await response.json();
		const { openLinkedWorkspaceFile } =
			await import("../../src/client/workspace-review.ts");
		await openLinkedWorkspaceFile(path, workspacePath);
	} catch (error) {
		alert(error instanceof Error ? error.message : "Could not open the file.");
	}
}

async function responseError(response) {
	try {
		const body = await response.json();
		return body.error || body.message || "Could not open the file.";
	} catch {
		return "Could not open the file.";
	}
}
