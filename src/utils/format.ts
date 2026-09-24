export function formatMessageCount(count: number): string {
	return `${count} message${count === 1 ? "" : "s"}`;
}

export function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

/**
 * A short, human-facing name for an extension's source path: the file name
 * without its script extension (`…/extensions/btw.ts` → `btw`), or the
 * containing directory for a package entry point (`…/web-access/index.ts` →
 * `web-access`). Accepts either path separator, since paths come from the
 * host OS.
 */
export function formatExtensionName(extensionPath: string): string {
	const segments = extensionPath.split(/[\\/]/).filter((segment) => segment !== "");
	const file = segments.at(-1) ?? extensionPath;
	const stem = file.replace(/\.(?:[cm]?[jt]s|tsx|jsx)$/, "");
	if (stem === "index" && segments.length > 1) return segments.at(-2) ?? stem;
	return stem;
}
