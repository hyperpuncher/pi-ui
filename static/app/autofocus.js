/**
 * Autofocusing the prompt on load pops the on-screen keyboard immediately on a
 * touch cold start, jumping the layout before the user has asked for anything.
 * Only autofocus when a real pointing device with hover is present.
 */
export function shouldAutofocusPromptOnLoad(matchMedia = window.matchMedia) {
	return matchMedia("(hover: hover) and (pointer: fine)").matches;
}
