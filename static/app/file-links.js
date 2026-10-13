import { responseErrorMessage } from "#src/utils/errors.ts";
import { fileUriToPath } from "#static/file-uri.js";

export function bindFileLinks() {
	document.addEventListener(
		"click",
		(event) => {
			if (event.button !== 0) return;
			const link =
				event.target instanceof Element ? event.target.closest("a[href]") : null;
			if (!(link instanceof HTMLAnchorElement)) return;
			const markedUri = link.getAttribute("data-pi-file-link") ?? "";
			const markedPath = markedUri ? fileUriToPath(markedUri) : undefined;
			const uri = markedPath === undefined ? link.href : markedUri;
			const path = markedPath ?? fileUriToPath(uri);
			if (path === undefined) return;

			// File navigation is forbidden from the HTTP UI. Claim the click even if
			// another client handler already prevented it, then delegate to the backend.
			event.preventDefault();
			void followFileLink(uri);
		},
		{ capture: true },
	);
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
		if (!response.ok) {
			throw new Error(
				await responseErrorMessage(response, "Could not open the file."),
			);
		}
		const result = await response.json();
		if (result.opened) return;
		const { openLinkedWorkspaceFile } =
			await import("#src/client/workspace-review.ts");
		await openLinkedWorkspaceFile(result.path, result.workspacePath);
	} catch (error) {
		alert(Error.isError(error) ? error.message : "Could not open the file.");
	}
}
