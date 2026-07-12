export function promptInput() {
	const input = document.getElementById("prompt-input");
	return input instanceof HTMLTextAreaElement ? input : undefined;
}

export function promptValue() {
	return promptInput()?.value ?? "";
}

export function setPromptValue(value) {
	const input = promptInput();
	if (!input) return;
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function focusPromptEnd() {
	const input = promptInput();
	if (!input) return;
	input.focus({ preventScroll: true });
	input.selectionStart = input.value.length;
	input.selectionEnd = input.value.length;
}

export function insertPromptText(text) {
	const input = promptInput();
	if (!input) return;
	const start = input.selectionStart ?? input.value.length;
	const end = input.selectionEnd ?? start;
	input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
	const cursor = start + text.length;
	input.selectionStart = cursor;
	input.selectionEnd = cursor;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function deletePromptCharBeforeCursor() {
	const input = promptInput();
	if (!input) return;
	const start = input.selectionStart ?? input.value.length;
	const end = input.selectionEnd ?? start;
	if (start !== end) {
		input.value = `${input.value.slice(0, start)}${input.value.slice(end)}`;
		input.selectionStart = start;
		input.selectionEnd = start;
	} else if (start > 0) {
		input.value = `${input.value.slice(0, start - 1)}${input.value.slice(start)}`;
		input.selectionStart = start - 1;
		input.selectionEnd = start - 1;
	}
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function bindPromptInteractions() {
	document.addEventListener("pointerdown", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const trigger = target.closest("[data-tooltip]");
		if (!(trigger instanceof HTMLElement)) return;
		trigger.setAttribute("data-tooltip-suppressed", "");
		trigger.addEventListener(
			"pointerleave",
			() => trigger.removeAttribute("data-tooltip-suppressed"),
			{ once: true },
		);
	});
}
