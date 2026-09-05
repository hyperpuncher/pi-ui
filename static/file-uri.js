/** @param {string} uri */
export function isHtmlFileUri(uri) {
	const path = fileUriToPath(uri);
	return path !== undefined && /\.html?$/i.test(path);
}

/** @param {string} uri */
export function fileUriToPath(uri) {
	try {
		const url = new URL(uri);
		if (url.protocol !== "file:") return undefined;

		const pathname = decodeURIComponent(url.pathname);
		if (url.hostname && url.hostname.toLowerCase() !== "localhost") {
			return `//${url.hostname}${pathname}`;
		}
		if (/^\/[A-Za-z]:(?:\/|$)/.test(pathname)) {
			return pathname.slice(1);
		}
		return pathname;
	} catch {
		return undefined;
	}
}
