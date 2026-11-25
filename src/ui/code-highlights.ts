import type { ThemedToken } from "@pierre/highlights";

export type HighlightPalette = {
	styles: string[];
	index: Map<string, number>;
};

export function createHighlightPalette(): HighlightPalette {
	return { styles: [], index: new Map() };
}

export function encodeHighlightLines(
	lines: readonly (readonly ThemedToken[])[],
	palette: HighlightPalette,
	styleOf: (token: ThemedToken) => string,
) {
	let text = "";
	const runs: string[] = [];
	let pendingStyle = "";
	let pendingStart = 0;
	let pendingEnd = 0;
	const flush = () => {
		if (!pendingStyle || pendingEnd <= pendingStart) return;
		let idx = palette.index.get(pendingStyle);
		if (idx === undefined) {
			idx = palette.styles.length;
			palette.styles.push(pendingStyle);
			palette.index.set(pendingStyle, idx);
		}
		runs.push(`${idx}:${pendingStart}:${pendingEnd}`);
		pendingStyle = "";
	};
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		if (lineIndex > 0) text += "\n";
		for (const token of lines[lineIndex]) {
			if (!token.content) continue;
			const start = text.length;
			text += token.content;
			if (!/\S/.test(token.content)) continue;
			const style = styleOf(token);
			if (style === pendingStyle) {
				pendingEnd = text.length;
			} else {
				flush();
				pendingStyle = style;
				pendingStart = start;
				pendingEnd = text.length;
			}
		}
	}
	flush();
	return { text, runs: runs.join(",") };
}
