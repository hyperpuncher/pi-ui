export function bindFileLinks() {
	document.addEventListener("click", (event) => {
		if (event.defaultPrevented || event.button !== 0) return;
		const link =
			event.target instanceof Element
				? event.target.closest("a[data-pi-file-link]")
				: null;
		if (!(link instanceof HTMLAnchorElement)) return;

		event.preventDefault();
		void followFileLink(link.href);
	});
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
