import { promptInput, setPromptValue } from "./prompt.js";

export class PromptHistoryNavigator {
	#entries = [];
	#index = -1;
	#draft = "";
	#source = "";

	sync(entries) {
		const source = JSON.stringify(entries);
		if (source === this.#source) return;
		this.#source = source;
		this.#entries = entries;
		this.reset();
	}

	get browsing() {
		return this.#index >= 0;
	}

	reset() {
		this.#index = -1;
		this.#draft = "";
	}

	navigate(value, direction) {
		if (direction === "up") {
			if (!this.browsing) {
				if (value !== "" || this.#entries.length === 0) return undefined;
				this.#draft = value;
				this.#index = 0;
			} else if (this.#index < this.#entries.length - 1) {
				this.#index += 1;
			}
			return { value: this.#entries[this.#index], cursor: "start" };
		}

		if (!this.browsing) return undefined;
		if (this.#index > 0) {
			this.#index -= 1;
			return { value: this.#entries[this.#index], cursor: "end" };
		}
		const valueToRestore = this.#draft;
		this.reset();
		return { value: valueToRestore, cursor: "end" };
	}
}

export function createPromptHistory() {
	const navigator = new PromptHistoryNavigator();
	let applying = false;

	function handleKeydown(event, entries) {
		if (
			event.defaultPrevented ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			(event.key !== "ArrowUp" && event.key !== "ArrowDown")
		)
			return false;
		const input = promptInput();
		if (event.target !== input || window.piUi.pickers.isOpen()) return false;

		navigator.sync(Array.isArray(entries) ? entries : []);
		if (navigator.browsing && !isAtHistoryBoundary(input, event.key)) return false;
		const result = navigator.navigate(
			input.value,
			event.key === "ArrowUp" ? "up" : "down",
		);
		if (!result) return false;

		event.preventDefault();
		applying = true;
		setPromptValue(result.value);
		applying = false;
		const cursor = result.cursor === "start" ? 0 : input.value.length;
		input.selectionStart = cursor;
		input.selectionEnd = cursor;
		return true;
	}

	function handleInput() {
		if (!applying) navigator.reset();
	}

	return { handleInput, handleKeydown };
}

function isAtHistoryBoundary(input, key) {
	if (input.selectionStart !== input.selectionEnd) return false;
	if (key === "ArrowUp") {
		const firstLineEnd = input.value.indexOf("\n");
		return firstLineEnd < 0 || input.selectionStart <= firstLineEnd;
	}
	const lastLineStart = input.value.lastIndexOf("\n") + 1;
	return input.selectionEnd >= lastLineStart;
}
