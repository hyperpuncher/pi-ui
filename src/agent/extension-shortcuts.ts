import {
	type ExtensionRunner,
	type ExtensionShortcut,
} from "@earendil-works/pi-coding-agent";
import {
	type KeybindingsConfig,
	KeybindingsManager,
	type KeyId,
	TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";

import { parseShortcut } from "../utils/keyboard.ts";

/**
 * `pi.registerShortcut()` shortcuts, published to the client so it can match
 * browser `KeyboardEvent`s the same way pi-tui's `Component.handleInput()`
 * would (see `static/app/extension-keys.ts`). `key` is the normalized
 * (lowercased) pi-tui `KeyId` string `ExtensionRunner.getShortcuts()` keys
 * its map by — e.g. `"alt+o"`, `"ctrl+shift+p"`, `"escape"`.
 *
 * `reachableByKeyboard` is false when `key` collides with one of pi-ui's own
 * keybinds — see `AppExtensionShortcut`'s doc comment (`state/app-store.ts`)
 * for why such a shortcut still gets listed rather than dropped outright.
 */
export type ExtensionShortcutInfo = {
	readonly key: string;
	readonly description?: string;
	readonly extensionPath: string;
	readonly reachableByKeyboard: boolean;
};

/** pi-coding-agent's own `useWindowsKeybindings()` (`core/keybindings.js`),
 * which picks the Windows/WSL defaults for a few reserved `app.*` ids. */
const windowsKeybindings =
	process.platform === "win32" ||
	(process.platform === "linux" &&
		Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP));

/**
 * Default keys of the `app.*` ids in interactive-mode's
 * `RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS` (`core/extensions/runner.js`),
 * copied from pi-coding-agent's `KEYBINDINGS` table (`core/keybindings.js`).
 * That table and its `KeybindingsManager` subclass live outside the package's
 * public `exports` map, so they can't be imported; keep this in step with
 * them when the SDK is upgraded. pi-ui doesn't read the user's
 * `~/.pi/agent/keybindings.json` (it configures pi's *terminal* keys, not this
 * browser UI's — see `src/keybinds.ts`), so the defaults are what apply.
 */
const reservedAppKeybindings: KeybindingsConfig = {
	"app.interrupt": "escape",
	"app.clear": "ctrl+c",
	"app.exit": "ctrl+d",
	"app.suspend": process.platform === "win32" ? [] : "ctrl+z",
	"app.thinking.cycle": "shift+tab",
	"app.model.cycleForward": "ctrl+p",
	"app.model.cycleBackward": windowsKeybindings ? "alt+p" : "shift+ctrl+p",
	"app.model.select": "ctrl+l",
	"app.tools.expand": "ctrl+o",
	"app.thinking.toggle": "ctrl+t",
	"app.editor.external": "ctrl+g",
	"app.message.copy": "ctrl+x",
	"app.message.followUp": windowsKeybindings ? "ctrl+q" : "alt+enter",
};

/**
 * The `KeybindingsConfig` passed to `ExtensionRunner.getShortcuts()`: pi-tui's
 * resolved `TUI_KEYBINDINGS` plus the reserved `app.*` defaults above, so the
 * SDK drops every extension shortcut a real pi TUI session would drop — one
 * that collides with a reserved built-in (`tui.input.submit` "enter",
 * `tui.select.cancel` "escape", `app.exit` "ctrl+d", `app.thinking.cycle`
 * "shift+tab", …) never even reaches `getShortcuts()`'s returned map.
 *
 * pi-ui's OWN keys (Alt+L for the Live Workspace, Ctrl+B for the session
 * sidebar, Alt+O for "toggle tool output", …) are a separate, browser-only
 * catalog (`src/keybinds.ts`'s `appCommandCatalog`) with no real TUI
 * equivalent to defer to — real interactive-mode's copy of `btw.ts` happily
 * binds Alt+O, since the real TUI has no such bind to collide with (round-5
 * runtime-validation finding, using the real `btw.ts`/`plan-mode.ts`
 * extensions). So a collision there is resolved by `reachableByKeyboard`
 * below rather than by dropping the shortcut: pi-ui's own bind still wins
 * the keyboard chord, but the extension's shortcut stays invocable from the
 * `/hotkeys` dialog and the command palette, never silently unreachable.
 */
const shortcutKeybindings: KeybindingsConfig = {
	...new KeybindingsManager(TUI_KEYBINDINGS).getResolvedBindings(),
	...reservedAppKeybindings,
};

export function extensionShortcutKeybindings(): KeybindingsConfig {
	return shortcutKeybindings;
}

/**
 * Converts one of pi-ui's own shortcut strings (`src/keybinds.ts`'s
 * canonical `"ctrl alt O"` form — `parseShortcut`'s `ShortcutSpec`) into the
 * pi-tui `KeyId` form (`"ctrl+alt+o"`) `ExtensionRunner.getShortcuts()` keys
 * its map by, so `listExtensionShortcuts`/`findExtensionShortcut` can drop
 * any extension shortcut that collides with it. `pi-ui`'s catalog only ever
 * binds a single letter/digit/`/`/`^` key (`shortcutKey()` in `keyboard.ts`),
 * so every entry converts; `undefined` only for a malformed or empty
 * override string, which the caller just won't be able to reserve.
 */
export function appShortcutToKeyId(shortcut: string): string | undefined {
	const spec = parseShortcut(shortcut);
	if (!spec) return undefined;
	const parts: string[] = [];
	if (spec.primary) parts.push("ctrl");
	if (spec.alt) parts.push("alt");
	if (spec.shift) parts.push("shift");
	const token = spec.key.kind === "code" ? spec.key.token : spec.key.key;
	parts.push(token.toLowerCase());
	return parts.join("+");
}

/**
 * pi-ui's own reserved `KeyId`s (every shortcut in `src/keybinds.ts`'s
 * catalog, converted with `appShortcutToKeyId`) — passed as `excludeKeys` to
 * `listExtensionShortcuts` so a colliding extension shortcut is flagged
 * `reachableByKeyboard: false` instead of ever matching pi-ui's own keybind.
 * `pi-ui`'s catalog has no notion of
 * "primary" mapping to Cmd on macOS the way `KeyId` does either (pi-tui's
 * `super` modifier is a distinct bit) — `primary` always becomes `ctrl` here,
 * matching how a Mac browser still reports `evt.ctrlKey` for a literal
 * Ctrl-chord shortcut (pi-ui's own Cmd equivalents are handled entirely
 * client-side by `primaryModifierExpression`, never registered as `KeyId`s).
 */
export function reservedAppKeyIds(shortcuts: Iterable<string>): Set<string> {
	const reserved = new Set<string>();
	for (const shortcut of shortcuts) {
		const keyId = appShortcutToKeyId(shortcut);
		if (keyId) reserved.add(keyId);
	}
	return reserved;
}

/** Normalizes a `KeyId` string the same way `ExtensionRunner.getShortcuts()`
 * keys its map (lowercased) — used to look an invoked shortcut back up, and
 * to compare against `excludeKeys`. */
export function normalizeKeyId(keyId: string): string {
	return keyId.toLowerCase();
}

/**
 * `KeyId`s a real browser tab already reserves for its own chrome — new/close
 * tab, new window, tab switching, reload — before the keydown ever reaches
 * page JavaScript (Round 6 F3). Unlike a collision with one of pi-ui's own
 * binds (`excludeKeys`), the client's `matchesKeyId()`
 * (`static/app/extension-keys.js`) never even gets a chance to see one of
 * these: the browser intercepts it first. `listExtensionShortcuts` flags a
 * shortcut on one of these keys `reachableByKeyboard: false` for the same
 * reason it does for a pi-ui collision — so `/hotkeys` and the command
 * palette show it muted with an explanation instead of a keyboard chord that
 * silently never fires — while `findExtensionShortcut` still invokes it
 * directly for a tap on that row, same as any other unreachable shortcut.
 * Both the Ctrl (Windows/Linux) and Cmd (`super`, macOS) forms are listed,
 * since either could appear in an extension's registered `KeyId` regardless
 * of which platform this server runs on.
 */
export const browserReservedKeyIds: ReadonlySet<string> = new Set([
	"ctrl+t",
	"ctrl+w",
	"ctrl+n",
	"ctrl+shift+t",
	"ctrl+shift+w",
	"ctrl+shift+n",
	"ctrl+tab",
	"ctrl+shift+tab",
	"super+t",
	"super+w",
	"super+n",
	"super+shift+t",
	"super+shift+w",
	"super+shift+n",
	"f5",
	"ctrl+f5",
	"shift+f5",
]);

function isKeyboardReachable(key: string, excludeKeys: ReadonlySet<string>): boolean {
	return !excludeKeys.has(key) && !browserReservedKeyIds.has(key);
}

/**
 * Every active `pi.registerShortcut()` shortcut that doesn't collide with a
 * pi-tui built-in (already excluded from `getShortcuts()`'s own returned map
 * by the SDK — see `extensionShortcutKeybindings()`'s doc comment), flagged
 * `reachableByKeyboard: false` for any that collides with one of pi-ui's own
 * keys (`excludeKeys`) instead of being dropped — see `AppExtensionShortcut`'s
 * doc comment. Sorted by key so the client's data island and the `/hotkeys`
 * dialog render in a stable order.
 */
export function listExtensionShortcuts(
	extensionRunner: Pick<ExtensionRunner, "getShortcuts">,
	excludeKeys: ReadonlySet<string>,
): ExtensionShortcutInfo[] {
	const shortcuts = extensionRunner.getShortcuts(shortcutKeybindings);
	const infos: ExtensionShortcutInfo[] = [];
	for (const [key, shortcut] of shortcuts) {
		infos.push(shortcutInfo(key, shortcut, isKeyboardReachable(key, excludeKeys)));
	}
	return infos.sort((a, b) => a.key.localeCompare(b.key));
}

function shortcutInfo(
	key: string,
	shortcut: ExtensionShortcut,
	reachableByKeyboard: boolean,
): ExtensionShortcutInfo {
	return {
		key,
		description: shortcut.description,
		extensionPath: shortcut.extensionPath,
		reachableByKeyboard,
	};
}

/**
 * Looks up the extension shortcut bound to `keyId` (as the client's
 * `matchesKeyId()` — `static/app/extension-keys.ts` — resolved it, or a
 * direct tap on a command-palette/`/hotkeys` row — `command-menu.tsx`'s
 * `renderExtensionShortcutRow`), re-deriving the live shortcut map rather
 * than trusting a possibly-stale client-cached one. Unlike
 * `listExtensionShortcuts`, this never excludes a `keyId` that collides with
 * one of pi-ui's own keys: `reachableByKeyboard` already keeps the client's
 * own keyboard matcher (`currentShortcutKeys()`) from ever sending one here
 * off a keydown, so a request that names one directly is, by construction,
 * an explicit tap — exactly the reachability path a colliding shortcut is
 * for — not a keyboard-chord ambiguity to arbitrate. The caller
 * (`RuntimeController.invokeExtensionShortcut`) invokes `.handler` and
 * reports a thrown/rejected handler the way real interactive-mode's
 * `setupExtensionShortcuts` dispatch does. Returns `undefined` when no
 * shortcut is bound to `keyId` — e.g. the extension that registered it
 * unloaded, or the client sent a stale/foreign key id.
 */
export function findExtensionShortcut(
	extensionRunner: Pick<ExtensionRunner, "getShortcuts">,
	keyId: string,
): ExtensionShortcut | undefined {
	const normalized = normalizeKeyId(keyId);
	// SAFETY: `getShortcuts()` keys its map by the same lowercased string this
	// function just produced (`runner.js`'s `getShortcuts` normalizes every
	// registered shortcut with `key.toLowerCase()`); an unrecognized or
	// malformed `keyId` from the client just misses, like any other `Map.get`.
	return extensionRunner.getShortcuts(shortcutKeybindings).get(normalized as KeyId);
}
