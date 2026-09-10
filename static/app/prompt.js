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

export function bindPromptInteractions() {
	document.addEventListener("pointerdown", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const trigger = target.closest("[data-tooltip]");
		if (!(trigger instanceof HTMLElement) || event.pointerType === "touch") return;
		trigger.setAttribute("data-tooltip-suppressed", "");
		trigger.addEventListener(
			"pointerleave",
			() => trigger.removeAttribute("data-tooltip-suppressed"),
			{ once: true },
		);
	});
}
