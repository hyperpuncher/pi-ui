type ElementClass<ElementType extends Element> = abstract new (
	...args: never[]
) => ElementType;

function required<ElementType extends Element>(
	id: string,
	elementClass: ElementClass<ElementType>,
): ElementType {
	const element = document.getElementById(id);
	if (!(element instanceof elementClass)) throw new Error(`Missing #${id}`);
	return element;
}

/** Typed lookup helpers for required workspace DOM nodes. */
export function requiredElement(id: string): HTMLElement {
	return required(id, HTMLElement);
}

export function requiredButton(id: string): HTMLButtonElement {
	return required(id, HTMLButtonElement);
}

export function requiredDialog(id: string): HTMLDialogElement {
	return required(id, HTMLDialogElement);
}

export function requiredInput(id: string): HTMLInputElement {
	return required(id, HTMLInputElement);
}
