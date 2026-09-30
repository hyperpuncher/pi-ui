import { getModelSelectorSearchText } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/model-search.js";

export function modelSearchText(id: string, provider: string, name: string): string {
	// Preserve camel-case boundaries that pi's case-insensitive matcher cannot see.
	const expandedName = name.replace(/([\p{Ll}\d])(\p{Lu})/gu, "$1 $2");
	return `${expandedName} ${id} ${provider} ${name} ${getModelSelectorSearchText({ id, provider, name })}`;
}
