import {
	CombinedAutocompleteProvider,
	type AutocompleteItem,
} from "@earendil-works/pi-tui";

export async function searchFiles(
	workspacePath: string,
	query: string,
	signal: AbortSignal = new AbortController().signal,
	fdPath?: string,
): Promise<AutocompleteItem[]> {
	signal.throwIfAborted();
	if (!fdPath) return [];
	const provider = new CombinedAutocompleteProvider([], workspacePath, fdPath);
	const prefix = `@${query}`;
	const suggestions = await provider.getSuggestions([prefix], 0, prefix.length, {
		signal,
	});
	signal.throwIfAborted();
	return suggestions?.prefix.startsWith("@") ? suggestions.items : [];
}
