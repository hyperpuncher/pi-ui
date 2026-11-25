import { activeFontStacks } from "#src/fonts.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";
import icons from "#src/ui/icons.json";

import frameScript from "./html-page-frame.js" with { type: "text" };

import frameCss from "./html-page-frame.css" with { type: "text" };

/** A Lucide icon as a CSS mask, so it follows the page's currentColor. */
function iconMask(name: keyof typeof icons): string {
	const body = icons[name].replaceAll("currentColor", "black");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="2">${body}</svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const iconVars = `--chevron-icon: ${iconMask("chevron-down")}; --check-icon: ${iconMask("check")};`;

/** Agent HTML pages, keyed by content so a re-render keeps the same frame URL. */
export class HtmlPageStore {
	readonly #pages = new Map<string, string>();

	register(html: string): string {
		const id = Bun.hash(html).toString(36);
		this.#pages.set(id, html);
		return `${endpoints.sessionsPage}?id=${id}`;
	}

	get(id: string): string | undefined {
		return this.#pages.get(id);
	}

	clear(): void {
		this.#pages.clear();
	}
}

/**
 * Wraps an agent page with base styles and the frame bridge, before its own markup.
 * The scheme must match the frame element's, or the frame paints an opaque backdrop.
 */
export function htmlPageDocument(html: string, colorScheme: string): string {
	// A second doctype would be ignored, so the page's own one is dropped.
	const body = html.replace(/^\s*<!doctype[^>]*>/i, "");
	const fonts = activeFontStacks();
	return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root { color-scheme: ${colorScheme}; --font-sans: ${fonts.sans}; --font-mono: ${fonts.mono}; ${iconVars} }\n${frameCss}</style><script>${frameScript}</script>${body}`;
}

/** Opaque origin. Blocks fetch, network form submissions and popups, but allows HTTPS assets. */
export const htmlPageSecurityPolicy = [
	"sandbox allow-scripts allow-forms",
	"default-src 'none'",
	"script-src 'unsafe-inline' https:",
	"style-src 'unsafe-inline' https:",
	"img-src data: blob: https:",
	"font-src data: https:",
	"media-src data: blob: https:",
	"connect-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'self'",
].join("; ");
