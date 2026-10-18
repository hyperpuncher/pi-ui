import { BoundedCache } from "#src/ui/render-cache.ts";

const diagrams = new BoundedCache<string, string | null>(100, {
	maxWeight: 8 * 1024 * 1024,
	weight: (key, value) => 2 * (key.length + (value?.length ?? 0)),
});

export function renderMermaid(
	source: string,
	scope: string,
	index: number,
	cache = true,
): string | undefined {
	const idPrefix = `mermaid-${Bun.hash(scope).toString(16)}-${index}`;
	const key = cache ? `${idPrefix}\0${source}` : "";
	const cached = cache ? diagrams.get(key) : undefined;
	if (cached !== undefined) return cached ?? undefined;
	// Load Pele only when a diagram is needed, without making streaming asynchronous.
	const { PeleError, render }: typeof import("pele") = require("pele");
	try {
		const { svg } = render(source, {
			idPrefix,
			responsive: false,
			maxWidth: 640,
		});
		const html = `<div class="mermaid-diagram" role="group" aria-label="Mermaid diagram" tabindex="0">${svg}</div>`;
		if (cache) diagrams.set(key, html);
		return html;
	} catch (error) {
		if (!(error instanceof PeleError)) throw error;
		if (cache) diagrams.set(key, null);
		return undefined;
	}
}
