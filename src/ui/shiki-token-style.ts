import type { ThemedToken } from "@pierre/diffs";

export function shikiTokenStyle(token: ThemedToken): string {
	const style: Record<string, string> = token.htmlStyle ?? {};
	if (!token.htmlStyle) {
		if (token.color) style.color = token.color;
		if (token.bgColor) style["background-color"] = token.bgColor;
	}
	return Object.entries(style)
		.map(([key, value]) => `${key}:${value}`)
		.join(";");
}
