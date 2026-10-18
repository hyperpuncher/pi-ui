import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function mermaidExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections.mermaid =
			"Use compact Mermaid 12.1 diagrams and charts in `mermaid` fences when useful. Keep each block self-contained, use short labels, and add accTitle/accDescr where supported. Do not override app colors or fonts. HTML labels and JavaScript callbacks are not supported.";
	});
}
