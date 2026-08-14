/** Resolve Kita's broad JSX type for templates that contain no async components. */
export function syncHtml(element: JSX.Element): string {
	if (element instanceof Promise) {
		throw new TypeError("Synchronous template returned a promise.");
	}
	return element;
}
