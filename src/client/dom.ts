/** Typed lookup helpers for required workspace DOM nodes. */
export function requiredElement(id: string): HTMLElement {
	const element = document.getElementById(id);
	if (!(element instanceof HTMLElement)) throw new Error(`Missing #${id}`);
	return element;
}

export function requiredButton(id: string): HTMLButtonElement {
	const element = document.getElementById(id);
	if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing #${id}`);
	return element;
}

export function requiredDialog(id: string): HTMLDialogElement {
	const element = document.getElementById(id);
	if (!(element instanceof HTMLDialogElement)) throw new Error(`Missing #${id}`);
	return element;
}

export function requiredInput(id: string): HTMLInputElement {
	const element = document.getElementById(id);
	if (!(element instanceof HTMLInputElement)) throw new Error(`Missing #${id}`);
	return element;
}
