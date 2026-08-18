export function bindFileLinks() {
	document.addEventListener(
		"click",
		(event) => {
			if (event.button !== 0) return;
			const link =
				event.target instanceof Element ? event.target.closest("a[href]") : null;
			if (!(link instanceof HTMLAnchorElement)) return;
			if (!link.hasAttribute("data-pi-file-link") && !isFileUri(link.href)) {
				return;
			}

			// File navigation is forbidden from the HTTP UI. Claim the click even if
			// another client handler already prevented it, then delegate to the backend.
			event.preventDefault();
			void followFileLink(link.href);
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
		if (response.status === 204) return;

		const blobUrl = URL.createObjectURL(await response.blob());
		const download = document.createElement("a");
		download.href = blobUrl;
		download.download = downloadName(response);
		download.click();
		setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
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

function downloadName(response) {
	try {
		return decodeURIComponent(response.headers.get("x-pi-file-name")) || "download";
	} catch {
		return "download";
	}
}
