export function isComposing(event) {
	return event.isComposing || event.keyCode === 229;
}
