import { expect, test } from "bun:test";

import { autofocusPrompt, focusPromptEnd } from "#static/app/prompt.js";

test("automatic prompt focus requires a fine pointer and hover; explicit focus still works", () => {
	const originals = Object.getOwnPropertyDescriptors(globalThis);
	let desktop = false;
	let focusCount = 0;
	class Textarea {
		value = "draft";
		selectionStart = 0;
		selectionEnd = 0;
		focus(options: FocusOptions) {
			expect(options).toEqual({ preventScroll: true });
			focusCount++;
		}
	}
	const input = new Textarea();
	Object.defineProperties(globalThis, {
		HTMLTextAreaElement: { configurable: true, value: Textarea },
		document: {
			configurable: true,
			value: { getElementById: () => input },
		},
		window: {
			configurable: true,
			value: {
				matchMedia(query: string) {
					expect(query).toBe("(hover: hover) and (pointer: fine)");
					return { matches: desktop };
				},
			},
		},
	});
	try {
		autofocusPrompt();
		expect(focusCount).toBe(0);
		expect(input.selectionStart).toBe(0);

		focusPromptEnd();
		expect(focusCount).toBe(1);
		expect(input.selectionStart).toBe(5);
		expect(input.selectionEnd).toBe(5);

		desktop = true;
		autofocusPrompt();
		expect(focusCount).toBe(2);
	} finally {
		for (const key of ["HTMLTextAreaElement", "document", "window"]) {
			const descriptor = originals[key];
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
});
