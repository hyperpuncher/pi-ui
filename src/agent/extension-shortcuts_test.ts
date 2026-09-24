import { test } from "bun:test";

import { ExtensionRunner, type ExtensionShortcut } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

import { assertEquals } from "#testing/assertions";

import {
	appShortcutToKeyId,
	browserReservedKeyIds,
	extensionShortcutKeybindings,
	findExtensionShortcut,
	listExtensionShortcuts,
	normalizeKeyId,
	reservedAppKeyIds,
} from "./extension-shortcuts.ts";

function shortcut(
	overrides: Partial<ExtensionShortcut> & { extensionPath: string },
): ExtensionShortcut {
	return {
		shortcut: "alt+o" as KeyId,
		handler: () => {},
		...overrides,
	};
}

/** A minimal `Pick<ExtensionRunner, "getShortcuts">` double: real
 * `getShortcuts()` already lowercases its keys and ignores the
 * `resolvedKeybindings` argument's exact contents for this test's purposes
 * (only `listExtensionShortcuts`/`findExtensionShortcut`'s own filtering is
 * under test, not the SDK's own conflict resolution). */
function fakeRunner(entries: Record<string, ExtensionShortcut>) {
	return {
		getShortcuts: () =>
			new Map(Object.entries(entries)) as Map<KeyId, ExtensionShortcut>,
	};
}

test("appShortcutToKeyId converts pi-ui's canonical shortcut form to a pi-tui KeyId", () => {
	assertEquals(appShortcutToKeyId("ctrl alt O"), "ctrl+alt+o");
	assertEquals(appShortcutToKeyId("alt shift T"), "alt+shift+t");
	assertEquals(appShortcutToKeyId("ctrl ^"), "ctrl+^");
	assertEquals(appShortcutToKeyId("alt L"), "alt+l");
	assertEquals(appShortcutToKeyId("ctrl /"), "ctrl+/");
	// A malformed/empty shortcut string has no KeyId equivalent.
	assertEquals(appShortcutToKeyId(""), undefined);
	assertEquals(appShortcutToKeyId("ctrl ctrl O"), undefined);
});

test("reservedAppKeyIds converts every shortcut in the iterable, dropping unparseable ones", () => {
	const reserved = reservedAppKeyIds(["alt L", "ctrl B", "not a shortcut !!"]);
	assertEquals(reserved.has("alt+l"), true);
	assertEquals(reserved.has("ctrl+b"), true);
	assertEquals(reserved.size, 2);
});

test("normalizeKeyId lowercases a KeyId string", () => {
	assertEquals(normalizeKeyId("Alt+O"), "alt+o");
	assertEquals(normalizeKeyId("CTRL+SHIFT+P"), "ctrl+shift+p");
});

test("listExtensionShortcuts flags reserved keys unreachable-by-keyboard instead of dropping them, and sorts by key", () => {
	const runner = fakeRunner({
		"alt+o": shortcut({ description: "Open", extensionPath: "/ext/a.ts" }),
		"alt+l": shortcut({
			description: "Reserved by pi-ui",
			extensionPath: "/ext/b.ts",
		}),
		"ctrl+shift+x": shortcut({ extensionPath: "/ext/c.ts" }),
	});

	// btw.ts/plan-mode.ts's real Alt+O/Alt+M collide with pi-ui's own web-only
	// "toggle tool output"/"toggle minimal mode" binds even though the real TUI
	// has no such concept to defer to (round-5 runtime-validation finding) — a
	// colliding shortcut still gets listed (for the `/hotkeys` dialog and
	// command palette), just unreachable by keyboard, never silently dropped.
	const infos = listExtensionShortcuts(runner, new Set(["alt+l"]));
	assertEquals(infos, [
		{
			key: "alt+l",
			description: "Reserved by pi-ui",
			extensionPath: "/ext/b.ts",
			reachableByKeyboard: false,
		},
		{
			key: "alt+o",
			description: "Open",
			extensionPath: "/ext/a.ts",
			reachableByKeyboard: true,
		},
		{
			key: "ctrl+shift+x",
			description: undefined,
			extensionPath: "/ext/c.ts",
			reachableByKeyboard: true,
		},
	]);
});

test("listExtensionShortcuts flags a browser-reserved key unreachable-by-keyboard too", () => {
	// Round 6 F3: Ctrl+T/W/N etc. never reach page JS at all — a real browser
	// tab already claims them — so an extension shortcut on one of these is
	// muted the same way a pi-ui collision is, still invocable by tapping it.
	const runner = fakeRunner({
		"ctrl+t": shortcut({ description: "New thing", extensionPath: "/ext/a.ts" }),
		"ctrl+k": shortcut({ extensionPath: "/ext/b.ts" }),
	});
	const infos = listExtensionShortcuts(runner, new Set());
	assertEquals(infos.find((info) => info.key === "ctrl+t")?.reachableByKeyboard, false);
	assertEquals(infos.find((info) => info.key === "ctrl+k")?.reachableByKeyboard, true);
});

test("browserReservedKeyIds covers both the Ctrl and Cmd (super) forms", () => {
	for (const key of ["ctrl+t", "ctrl+w", "ctrl+n", "super+t", "super+w", "super+n"]) {
		assertEquals(browserReservedKeyIds.has(key), true);
	}
	assertEquals(browserReservedKeyIds.has("alt+o"), false);
});

test("listExtensionShortcuts returns an empty list only when none are registered", () => {
	assertEquals(listExtensionShortcuts(fakeRunner({}), new Set()), []);
});

test("findExtensionShortcut looks up a normalized keyId regardless of pi-ui's own reserved keys", () => {
	const target = shortcut({ description: "Open", extensionPath: "/ext/a.ts" });
	const runner = fakeRunner({ "alt+o": target });

	assertEquals(findExtensionShortcut(runner, "Alt+O"), target);
	// A direct lookup is never blocked by a pi-ui collision — reachability only
	// gates the CLIENT's keyboard matcher (`extension-keys.js`'s
	// `currentShortcutKeys()`), not this server-side invocation lookup itself
	// (see `findExtensionShortcut`'s doc comment).
	assertEquals(findExtensionShortcut(runner, "alt+o"), target);
	assertEquals(findExtensionShortcut(runner, "ctrl+z"), undefined);
});

test("the SDK drops extension shortcuts on keys a real pi TUI session reserves", () => {
	// Runs the SDK's own conflict resolution (`ExtensionRunner.getShortcuts`)
	// against the keybindings pi-ui passes it, over a minimal runner `this`.
	const register = (key: string) =>
		[
			key,
			shortcut({ shortcut: key as KeyId, extensionPath: `/ext/${key}.ts` }),
		] as const;
	const runnerThis = {
		extensions: [
			{
				shortcuts: new Map([
					register("ctrl+d"),
					register("shift+tab"),
					register("escape"),
					register("enter"),
					register("alt+k"),
				]),
			},
		],
		hasUI: () => true,
		shortcutDiagnostics: [],
	};
	// Only the fields `getShortcuts()` reads; the constructor's session wiring is irrelevant here.
	const runner: ExtensionRunner = Object.assign(
		Object.create(ExtensionRunner.prototype),
		runnerThis,
	);
	const shortcuts = runner.getShortcuts(extensionShortcutKeybindings());
	assertEquals([...shortcuts.keys()], ["alt+k"]);
});
