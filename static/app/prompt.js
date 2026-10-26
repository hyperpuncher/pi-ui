export function promptInput() {
	const input = document.getElementById("prompt-input");
	return input instanceof HTMLTextAreaElement ? input : undefined;
}

export function setPromptValue(value) {
	const input = promptInput();
	if (!input) return;
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function autofocusPrompt() {
	if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
	focusPromptEnd();
}

export function focusPromptEnd() {
	const input = promptInput();
	if (!input) return;
	input.focus({ preventScroll: true });
	input.selectionStart = input.value.length;
	input.selectionEnd = input.value.length;
}
