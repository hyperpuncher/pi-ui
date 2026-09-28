import { afterEach, test } from "bun:test";

import {
	activeKeybind,
	keybindAction,
	keybindAria,
	parseKeybindOverrides,
	setActiveKeybinds,
} from "#src/keybinds.ts";
import { operatingSystem } from "#src/utils/platform.ts";
import { assertEquals, assertStringIncludes } from "#testing/assertions";

afterEach(() => setActiveKeybinds({}));

function execute(expression: string, event: Partial<KeyboardEvent>) {
	let called = 0;
	let prevented = 0;
	new Function("evt", "document", "action", expression)(
		{ ...event, preventDefault: () => prevented++ },
		{ querySelector: () => null },
		() => called++,
	);
	return { called, prevented };
}

test("default keybinds come from commands and focus actions", () => {
	assertEquals(activeKeybind("new-chat"), "ctrl O");
	assertEquals(activeKeybind("cycle-model-backward"), "ctrl shift P");
	assertEquals(activeKeybind("toggle-sessions"), "ctrl B");
	assertEquals(activeKeybind("focus-workspace-editor"), "alt E");
	assertEquals(activeKeybind("session-tree"), "");
});

test("overrides replace defaults and are canonicalized", () => {
	setActiveKeybinds(
		parseKeybindOverrides({ "new-chat": "ALT CONTROL n", "focus-prompt": "alt Q" }),
	);
	assertEquals(activeKeybind("new-chat"), "ctrl alt N");
	assertEquals(activeKeybind("focus-prompt"), "alt Q");
});

test("invalid, untyped, and unknown overrides keep the default", () => {
	setActiveKeybinds(
		parseKeybindOverrides({
			"new-chat": "n",
			"resume-session": "bogus",
			"toggle-review": 5,
			"unknown-action": "ctrl Z",
		}),
	);
	assertEquals(activeKeybind("new-chat"), "ctrl O");
	assertEquals(activeKeybind("resume-session"), "ctrl R");
	assertEquals(activeKeybind("toggle-review"), "ctrl G");
});

test("only modal-guarded keybinds skip open dialogs", () => {
	assertStringIncludes(
		keybindAction("focus-prompt", "focus();"),
		"document.querySelector(':modal')",
	);
	assertEquals(keybindAction("new-chat", "go();").includes(":modal"), false);
});

test("generated actions match the effective chord on the running platform", () => {
	setActiveKeybinds({ "new-chat": "ctrl N" });
	const primary = operatingSystem === "darwin" ? { metaKey: true } : { ctrlKey: true };
	const expression = keybindAction("new-chat", "action();");
	assertEquals(execute(expression, { ...primary, code: "KeyN" }), {
		called: 1,
		prevented: 1,
	});
	assertEquals(execute(expression, { ...primary, code: "KeyO" }), {
		called: 0,
		prevented: 0,
	});
	assertEquals(execute(expression, { ...primary, altKey: true, code: "KeyN" }), {
		called: 0,
		prevented: 0,
	});
});

test("generated alt actions match only the alt chord", () => {
	const expression = keybindAction("focus-prompt", "action();");
	assertEquals(execute(expression, { altKey: true, code: "KeyP" }), {
		called: 1,
		prevented: 1,
	});
	assertEquals(execute(expression, { altKey: false, code: "KeyP" }), {
		called: 0,
		prevented: 0,
	});
	assertEquals(execute(expression, { altKey: true, code: "KeyO" }), {
		called: 0,
		prevented: 0,
	});
	assertEquals(execute(expression, { altKey: true, metaKey: true, code: "KeyP" }), {
		called: 0,
		prevented: 0,
	});
	assertEquals(execute(expression, { altKey: true, ctrlKey: true, code: "KeyP" }), {
		called: 0,
		prevented: 0,
	});
});

test("keybind aria reflects the effective chord", () => {
	setActiveKeybinds({ "new-chat": "ctrl N" });
	assertEquals(keybindAria("new-chat"), "Control+N Meta+N");
	assertEquals(keybindAria("focus-prompt"), "Alt+P");
});
