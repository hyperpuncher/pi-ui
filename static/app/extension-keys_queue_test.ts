import { afterEach, test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { bindExtensionKeys, promptInputBusy, takesPromptKey } from "./extension-keys.js";

/** Patches a global via `Object.defineProperty` (see live-workspace-open_test.ts). */
function patchGlobal(name: string, value: unknown): () => void {
	const original = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, {
		configurable: true,
		writable: true,
		value,
	});
	return () => {
		if (original) Object.defineProperty(globalThis, name, original);
		else Reflect.deleteProperty(globalThis, name);
	};
}

class FakeKeyboardEvent extends Event {
	readonly key: string;
	readonly code: string;
	readonly ctrlKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
	readonly repeat = false;
	readonly isComposing = false;
	propagationStopped = false;

	constructor(
		type: string,
		init: EventInit & {
			key: string;
			code?: string;
			shiftKey?: boolean;
			ctrlKey?: boolean;
			altKey?: boolean;
		},
	) {
		super(type, init);
		this.key = init.key;
		this.code = init.code ?? init.key;
		this.ctrlKey = init.ctrlKey ?? false;
		this.altKey = init.altKey ?? false;
		this.metaKey = false;
		this.shiftKey = init.shiftKey ?? false;
	}

	getModifierState(): boolean {
		return false;
	}

	override stopPropagation() {
		this.propagationStopped = true;
		super.stopPropagation();
	}
}

type KeyOptions = { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean };

function describeKey(event: FakeKeyboardEvent): string {
	const mods = [
		event.ctrlKey && "ctrl",
		event.altKey && "alt",
		event.shiftKey && "shift",
	];
	return [...mods.filter(Boolean), event.key.toLowerCase()].join("+");
}

/** Just the `HTMLTextAreaElement` surface `extension-keys.js` edits through. */
class FakeTextarea extends EventTarget {
	readonly id = "prompt-input";
	value = "";
	selectionStart = 0;
	selectionEnd = 0;
	blurred = false;

	setRangeText(text: string, start: number, end: number) {
		this.value = this.value.slice(0, start) + text + this.value.slice(end);
		this.selectionStart = start + text.length;
		this.selectionEnd = this.selectionStart;
	}

	setSelectionRange(start: number, end: number) {
		this.selectionStart = start;
		this.selectionEnd = end;
	}

	blur() {
		this.blurred = true;
	}
}

type Deferred = { data: string; resolve: (consumed: boolean) => void };

type Harness = {
	input: FakeTextarea;
	aborts: number[];
	requests: Deferred[];
	submitted: string[];
	recalls: string[];
	/** Keydowns pi-ui's own `window`-level keybinds saw, bubbled or replayed. */
	windowKeys: string[];
	/** Key ids posted to the `registerShortcut()` invoke route. */
	shortcuts: string[];
	press: (key: string, options?: KeyOptions) => FakeKeyboardEvent;
	settle: () => Promise<void>;
};

const restores: (() => void)[] = [];

afterEach(() => {
	while (restores.length > 0) restores.pop()?.();
});

/**
 * Fakes the prompt, the `#extension-shortcuts-data` island (with an active
 * `onTerminalInput` listener, the ambient state `bash-background.ts` leaves
 * behind), and a `fetch` whose `/extensions/ui/prompt-input` round trips the
 * test resolves by hand, so two keydowns can land inside one round trip.
 */
function install(options: { running?: boolean; shortcutKeys?: string[] } = {}): Harness {
	const input = new FakeTextarea();
	const aborts: number[] = [];
	// prompt-action.tsx renders either the send button (`data-send-trigger`) or,
	// while a turn runs, the destructive abort button.
	const abortButton = { click: () => aborts.push(Date.now()) };
	const sendButton = {};
	const island = {
		dataset: { terminalInputActive: "" },
		children: (options.shortcutKeys ?? []).map((key) => ({
			dataset: { key, reachable: "" },
		})),
	};
	const windowKeys: string[] = [];
	const shortcuts: string[] = [];
	const documentListeners: ((event: Event) => void)[] = [];
	const requests: Deferred[] = [];
	const submitted: string[] = [];
	const recalls: string[] = [];

	// Stand-in for prompt-box.tsx's inline history recall (target phase), which
	// stands down for a key this module takes.
	input.addEventListener("keydown", (event) => {
		const keyEvent = event as FakeKeyboardEvent;
		if (keyEvent.key !== "ArrowUp" && keyEvent.key !== "ArrowDown") return;
		if (takesPromptKey(event)) return;
		event.preventDefault();
		recalls.push(keyEvent.key);
		input.value = "recalled";
	});

	// Stand-in for prompt-box.tsx's inline Enter-to-send (target phase).
	input.addEventListener("keydown", (event) => {
		const keyEvent = event as FakeKeyboardEvent;
		if (keyEvent.key !== "Enter" || keyEvent.shiftKey) return;
		if (promptInputBusy()) return;
		event.preventDefault();
		submitted.push(input.value);
	});

	const fakeDocument = {
		activeElement: input,
		body: {},
		getElementById: (id: string) =>
			id === "prompt-input"
				? input
				: id === "extension-shortcuts-data"
					? island
					: null,
		querySelector: (selector: string) =>
			selector === "[data-send-trigger]"
				? options.running
					? null
					: sendButton
				: selector.startsWith("#prompt-action[")
					? options.running
						? abortButton
						: null
					: null,
		addEventListener: (_type: string, listener: (event: Event) => void) => {
			documentListeners.push(listener);
		},
	};
	restores.push(patchGlobal("document", fakeDocument));
	restores.push(patchGlobal("HTMLTextAreaElement", FakeTextarea));
	restores.push(patchGlobal("KeyboardEvent", FakeKeyboardEvent));
	restores.push(
		patchGlobal("window", {
			piUi: {
				pickers: { isOpen: () => false },
				shouldAbortOnEscape: (event: Event) => !event.defaultPrevented,
			},
			dispatchEvent: (event: FakeKeyboardEvent) => {
				windowKeys.push(describeKey(event));
				return true;
			},
		}),
	);
	restores.push(
		patchGlobal("fetch", (url: string, init: { body: string }) => {
			if (url === "/extensions/ui/shortcut") {
				shortcuts.push((JSON.parse(init.body) as { keyId: string }).keyId);
				return Promise.resolve({ json: async () => ({}) });
			}
			const { data } = JSON.parse(init.body) as { data: string };
			return new Promise((resolveResponse) => {
				requests.push({
					data,
					resolve: (consumed) =>
						resolveResponse({ json: async () => ({ consumed }) }),
				});
			});
		}),
	);

	bindExtensionKeys();

	function press(key: string, keyOptions: KeyOptions = {}) {
		const event = new FakeKeyboardEvent("keydown", {
			key,
			bubbles: true,
			cancelable: true,
			...keyOptions,
		});
		// Target phase first (prompt-box.tsx), then the document listener, then
		// (unless stopped) `window`, where pi-ui's own keybinds listen.
		Object.defineProperty(event, "target", { value: input, configurable: true });
		input.dispatchEvent(event);
		for (const listener of documentListeners) listener(event);
		if (!event.propagationStopped) windowKeys.push(describeKey(event));
		return event;
	}

	async function settle() {
		for (let i = 0; i < 20; i += 1) await Promise.resolve();
	}

	return {
		input,
		aborts,
		requests,
		submitted,
		recalls,
		windowKeys,
		shortcuts,
		press,
		settle,
	};
}

test("two characters typed inside one round trip both land, in order", async () => {
	const { input, requests, press, settle } = install();
	const h = press("h");
	const i = press("i");
	assertEquals(h.defaultPrevented, true);
	assertEquals(i.defaultPrevented, true);
	await settle();
	// Only the first key was forwarded so far; the second waits its turn.
	assertEquals(requests.length, 1);
	requests[0]?.resolve(false);
	await settle();
	// The prompt is no longer empty, so "i" is played back without a forward.
	assertEquals(requests.length, 1);
	assertEquals(input.value, "hi");
	assertEquals(promptInputBusy(), false);
});

test("a consumed key never reaches the prompt and the next one is forwarded too", async () => {
	const { input, requests, press, settle } = install();
	press("j");
	press("x");
	await settle();
	requests[0]?.resolve(true);
	await settle();
	assertEquals(requests.length, 2);
	requests[1]?.resolve(false);
	await settle();
	assertEquals(input.value, "x");
});

test("Backspace and Enter queued behind a forward apply after it, not before", async () => {
	const { input, requests, submitted, press, settle } = install();
	press("a");
	press("b");
	const backspace = press("Backspace");
	const enter = press("Enter");
	assertEquals(backspace.defaultPrevented, true);
	// prompt-box.tsx stood down (busy), so this module queued the Enter.
	assertEquals(submitted.length, 0);
	assertEquals(enter.defaultPrevented, true);
	await settle();
	requests[0]?.resolve(false);
	await settle();
	assertEquals(input.value, "a");
	assertEquals(submitted, ["a"]);
});

test("an unconsumed Escape blurs the prompt", async () => {
	const { input, requests, press, settle } = install();
	press("Escape");
	await settle();
	requests[0]?.resolve(false);
	await settle();
	assertEquals(input.blurred, true);
});

test("an unconsumed Escape aborts a running turn instead of blurring", async () => {
	const { input, aborts, requests, press, settle } = install({ running: true });
	press("Escape");
	await settle();
	requests[0]?.resolve(false);
	await settle();
	assertEquals(aborts.length, 1);
	assertEquals(input.blurred, false);
});

test("a consumed Escape never aborts a running turn", async () => {
	const { aborts, requests, press, settle } = install({ running: true });
	press("Escape");
	await settle();
	requests[0]?.resolve(true);
	await settle();
	assertEquals(aborts.length, 0);
});

test("a manage-mode ArrowUp at an empty prompt reaches the listener before history", async () => {
	const { input, recalls, requests, press, settle } = install();
	const up = press("ArrowUp");
	assertEquals(up.defaultPrevented, true);
	await settle();
	assertEquals(
		requests.map((request) => request.data),
		["[A"],
	);
	requests[0]?.resolve(true);
	await settle();
	assertEquals(recalls, []);
	assertEquals(input.value, "");
});

test("an unconsumed ArrowUp still recalls prompt history", async () => {
	const { input, recalls, requests, press, settle } = install();
	press("ArrowUp");
	await settle();
	requests[0]?.resolve(false);
	await settle();
	assertEquals(recalls, ["ArrowUp"]);
	assertEquals(input.value, "recalled");
});

test("a chord a listener consumes never reaches pi-ui's own keybinds", async () => {
	const { input, requests, windowKeys, press, settle } = install();
	const chord = press("o", { altKey: true });
	assertEquals(chord.defaultPrevented, true);
	assertEquals(windowKeys, []);
	await settle();
	assertEquals(
		requests.map((request) => request.data),
		["o"],
	);
	requests[0]?.resolve(true);
	await settle();
	assertEquals(windowKeys, []);
	assertEquals(input.value, "");
});

test("an unconsumed chord reaches pi-ui's own keybinds once, after the listeners", async () => {
	const { input, requests, windowKeys, shortcuts, press, settle } = install();
	press("o", { altKey: true });
	await settle();
	assertEquals(windowKeys, []);
	requests[0]?.resolve(false);
	await settle();
	assertEquals(windowKeys, ["alt+o"]);
	assertEquals(shortcuts, []);
	assertEquals(input.value, "");
});

test("an unconsumed chord fires the extension shortcut registered on it", async () => {
	const { requests, windowKeys, shortcuts, press, settle } = install({
		shortcutKeys: ["alt+k"],
	});
	press("k", { altKey: true });
	await settle();
	requests[0]?.resolve(false);
	await settle();
	assertEquals(shortcuts, ["alt+k"]);
	assertEquals(windowKeys, []);
});

test("a shortcut chord a listener consumes does not fire the shortcut", async () => {
	const { requests, shortcuts, press, settle } = install({ shortcutKeys: ["alt+k"] });
	press("k", { altKey: true });
	await settle();
	requests[0]?.resolve(true);
	await settle();
	assertEquals(shortcuts, []);
});
