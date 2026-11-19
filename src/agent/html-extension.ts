import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { obj, str } from "@earendil-works/pi-schema";

import { asRecord, isString } from "#src/utils/type-guards.ts";

export const htmlToolName = "render_html";
const maxHtmlBytes = 512 * 1024;

// Stylesheets and style attributes only, skipping HTML comments.
// Consume unclosed comments, tags, or quotes through EOF to keep matching linear.
const styleSource =
	/<!--[\s\S]*?(?:-->|$)|<style\b[^>]*(?:>|$)([\s\S]*?)(?:<\/style\s*>|$)|\sstyle\s*=\s*(?:"([^"]*)(?:"|$)|'([^']*)(?:'|$)|([^\s>]+))/gi;
// The lookbehind skips base64 runs such as an inlined image containing "1vh".
const viewportHeightUnit = /(?<![\w.+/])(?:\d+(?:\.\d+)?|\.\d+)[sld]?vh(?![\w-])/i;

/** The frame grows to fit the page, so a viewport-relative height would grow it forever. */
export function findViewportHeightUnit(html: string): string | undefined {
	for (const [, sheet, doubleQuoted, singleQuoted, unquoted] of html.matchAll(
		styleSource,
	)) {
		const css = sheet ?? doubleQuoted ?? singleQuoted ?? unquoted;
		if (!css) continue;
		const found = viewportHeightUnit.exec(css);
		if (found) return found[0];
	}
	return undefined;
}

const parameters = obj({
	title: str({ minLength: 1, maxLength: 200, description: "Short page title." }),
	html: str({
		minLength: 1,
		description: `Self-contained HTML with inline CSS and JavaScript. Maximum ${maxHtmlBytes / 1024} KiB in UTF-8. Embed the page data. Let content set the height: avoid viewport height units or height: 100% on html and body.`,
	}),
});

/** Shows agent-written HTML pages in the transcript, inside a sandboxed frame. */
export function htmlExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: htmlToolName,
		label: "Render HTML",
		description: [
			"Show an interactive HTML page inline in the transcript (~760px desktop width, narrower on phones).",
			"Sit directly on the chat background: no outer card, border, or filled section boxes; use spacing and hairlines instead.",
			"Keep layouts fluid within 100% width with overflow-x: auto on wide tables or code, and give charts/canvases fixed pixel heights.",
			"The sandbox runs inline scripts, clipboard copy, and HTTPS assets, but blocks fetch and network form submissions; external links open in a new tab.",
			"Use theme variables instead of fixed colors: --text, --text-muted, --surface, --border, --accent, --chart-1 to --chart-8, --radius, --font-sans, --font-mono. Base control styles are already applied.",
		].join(" "),
		promptGuidelines: [
			"Use render_html for interactive tools, simulations, or custom visual layouts. Prefer Markdown for text and tables, and Mermaid for static charts and diagrams.",
		],
		parameters,
		async execute(_toolCallId, params) {
			const record = asRecord(params);
			const html = isString(record?.html) ? record.html : "";
			if (!html.trim()) throw new Error("HTML must not be empty.");
			if (Buffer.byteLength(html) > maxHtmlBytes)
				throw new Error(
					`HTML is larger than ${maxHtmlBytes / 1024} KiB. Remove embedded data or images.`,
				);
			const viewportUnit = findViewportHeightUnit(html);
			if (viewportUnit)
				throw new Error(
					`The page uses ${viewportUnit}. The frame grows to fit the page, so content that follows the viewport makes it grow forever. Use fixed pixel heights or let content set the height.`,
				);
			return {
				content: [
					{
						type: "text",
						text: "The page appears above your reply. Do not repeat it. If useful, give one thing to try, an expected result, or a limitation.",
					},
				],
				details: undefined,
			};
		},
	});
}
