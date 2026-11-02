import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function mermaidExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections.mermaid =
			"Use compact Mermaid 12.1 diagrams in `mermaid` fences when useful. Use short labels and add accTitle/accDescr where supported. The app applies colors and fonts automatically; do not override them. Arbitrary HTML, JavaScript callbacks, external plugins, custom icon packs, and typeset math are not supported.";
	});
}
