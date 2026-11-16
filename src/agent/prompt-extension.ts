import { existsSync } from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { getDocsPath, getExamplesPath, getReadmePath, VERSION } from "#pi/config.js";
import { version } from "#src/version.ts";

const piUiSection = `You run inside pi-ui, a browser interface for pi. The user reads your replies in a web page, not a terminal: Markdown, tables, images and clickable file links render. Questions about the interface, its keybindings, themes and settings refer to pi-ui; its docs are at https://raw.githubusercontent.com/hyperpuncher/pi-ui/refs/tags/v${version}/README.md. The pi docs describe the terminal app; use them for pi itself, such as extensions, skills, models and the SDK.
Use compact Mermaid 12.1 diagrams in \`mermaid\` fences when useful. Use short labels and add accTitle/accDescr where supported. The app applies colors and fonts automatically; do not override them. Arbitrary HTML, JavaScript callbacks, external plugins, custom icon packs, and typeset math are not supported.`;

const piDocsUrl = `https://raw.githubusercontent.com/earendil-works/pi/refs/tags/v${VERSION}/packages/coding-agent`;
// Raw URLs serve files only, so the examples folder links to its listing page.
const piExamplesUrl = `https://github.com/earendil-works/pi/tree/v${VERSION}/packages/coding-agent/examples`;

/** Point pi's local docs paths at the matching release, for builds that do not ship them. */
export function linkPiDocs(docs: string): string {
	return docs
		.replaceAll(getReadmePath(), `${piDocsUrl}/README.md`)
		.replaceAll(getDocsPath(), `${piDocsUrl}/docs`)
		.replaceAll(getExamplesPath(), piExamplesUrl);
}

export function promptExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		const { sections } = event.systemPromptOptions;
		sections["pi-ui"] = piUiSection;
		// The compiled binary looks for pi's docs next to itself, where they do not exist.
		const docs = /<docs>\n([\s\S]*?)\n<\/docs>/.exec(event.systemPrompt)?.[1];
		if (docs && !existsSync(getReadmePath())) sections.docs = linkPiDocs(docs);
	});
}
