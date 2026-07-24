export function createWindowFocusGuard(options = {}) {
	const activeElement = options.activeElement ?? (() => document.activeElement);
	const body = options.body ?? (() => document.body);
	const requestFrame =
		options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
	let suspendedElement;
	let generation = 0;

	function suspend() {
		generation += 1;
		const element = activeElement();
		if (!isFocusable(element) || element === body()) {
			suspendedElement = undefined;
			return;
		}
		suspendedElement = element;
		element.blur();
	}

	function restore() {
		const element = suspendedElement;
		suspendedElement = undefined;
		if (!isFocusable(element) || !element.isConnected) return;
		const restoreGeneration = generation;
		requestFrame(() => {
			if (generation !== restoreGeneration || !element.isConnected) return;
			const current = activeElement();
			if (current === element) return;
			if (current && current !== body()) return;
			element.focus({ preventScroll: true });
		});
	}

	return { restore, suspend };
}

function isFocusable(element) {
	return Boolean(
		element &&
		typeof element.blur === "function" &&
		typeof element.focus === "function",
	);
}

export const windowFocus = createWindowFocusGuard();
