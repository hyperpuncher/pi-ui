/** Keeps unsent prompt text per session in the browser. */
export class PromptDrafts {
	#drafts = new Map();
	#key;

	/**
	 * Saves the current text when the session changes and returns the draft to
	 * restore, or null when the session did not change.
	 */
	sync(key, text) {
		if (this.#key === undefined) {
			this.#key = key;
			return null;
		}
		if (key === this.#key) return null;
		this.#drafts.set(this.#key, text);
		this.#key = key;
		return this.#drafts.get(key) ?? "";
	}

	/** Restores failed prompt text to a background session if its draft is still empty. */
	restore(key, text) {
		if (!text || key === this.#key) return;
		if ((this.#drafts.get(key) ?? "") === "") {
			this.#drafts.set(key, text);
		}
	}
}
