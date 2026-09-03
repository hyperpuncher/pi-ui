import type { ThemedToken } from "@pierre/diffs";

export function shikiTokenStyle(token: ThemedToken): string {
	const style = { ...token.htmlStyle };
	if (!token.htmlStyle) {
		if (token.color) style.color = token.color;
		if (token.bgColor) style["background-color"] = token.bgColor;
	}
	if (style.color && style["--shiki-dark"]) {
		style["--shiki-light"] = style.color;
		delete style.color;
	}
	if (style["background-color"] && style["--shiki-dark-bg"]) {
		style["--shiki-light-bg"] = style["background-color"];
		delete style["background-color"];
	}
	return Object.entries(style)
		.map(([key, value]) => `${key}:${value}`)
		.join(";");
}
