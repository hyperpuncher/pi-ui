import { operatingSystem, type OperatingSystem } from "./platform.ts";

type KeyboardModifiers = Pick<KeyboardEvent, "ctrlKey" | "metaKey">;

const primaryModifierKey = operatingSystem === "darwin" ? "⌘" : "ctrl";

export function hasPrimaryModifier(
	event: KeyboardModifiers,
	os: OperatingSystem = operatingSystem,
): boolean {
	return os === "darwin"
		? event.metaKey && !event.ctrlKey
		: event.ctrlKey && !event.metaKey;
}

export function primaryModifierExpression(
	event = "evt",
	os: OperatingSystem = operatingSystem,
): string {
	return os === "darwin"
		? `${event}.metaKey && !${event}.ctrlKey`
		: `${event}.ctrlKey && !${event}.metaKey`;
}

export function formatShortcut(shortcut: string): string {
	return shortcut.replace(/^ctrl\b/i, primaryModifierKey);
}

export function shortcutParts(shortcut: string): string[] {
	return formatShortcut(shortcut).split(/\s+/).filter(Boolean);
}

export type ShortcutKey =
	| { kind: "code"; code: string; token: string }
	| { kind: "key"; key: string; token: string };

export type ShortcutSpec = {
	primary: boolean;
	alt: boolean;
	shift: boolean;
	key: ShortcutKey;
};

function modifierField(token: string): "primary" | "alt" | "shift" | undefined {
	if (token === "ctrl" || token === "control") return "primary";
	if (token === "alt") return "alt";
	if (token === "shift") return "shift";
	return undefined;
}

function shortcutKey(token: string): ShortcutKey | undefined {
	const value = token.toLowerCase();
	if (/^[a-z]$/.test(value)) {
		const upper = value.toUpperCase();
		return { kind: "code", code: `Key${upper}`, token: upper };
	}
	if (/^[0-9]$/.test(value)) {
		return { kind: "code", code: `Digit${value}`, token: value };
	}
	if (value === "/") return { kind: "code", code: "Slash", token: "/" };
	if (value === "^") return { kind: "key", key: "^", token: "^" };
	return undefined;
}

/**
 * Parse a canonical shortcut such as `ctrl alt O`, `alt shift T` or `ctrl ^`
 * into a typed spec. Modifiers must precede exactly one key; unknown tokens are
 * rejected so untrusted config never reaches a generated expression verbatim.
 */
export function parseShortcut(shortcut: string): ShortcutSpec | undefined {
	const tokens = shortcut.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const key = shortcutKey(tokens.at(-1) ?? "");
	if (!key) return undefined;
	const spec: ShortcutSpec = { primary: false, alt: false, shift: false, key };
	for (const token of tokens.slice(0, -1)) {
		const field = modifierField(token);
		if (!field || spec[field]) return undefined;
		spec[field] = true;
	}
	return spec;
}

export function canonicalShortcut(spec: ShortcutSpec): string {
	const parts: string[] = [];
	if (spec.primary) parts.push("ctrl");
	if (spec.alt) parts.push("alt");
	if (spec.shift) parts.push("shift");
	parts.push(spec.key.token);
	return parts.join(" ");
}

export function shortcutMatchExpression(
	spec: ShortcutSpec,
	event = "evt",
	os: OperatingSystem = operatingSystem,
): string {
	const conditions: string[] = [
		spec.primary
			? primaryModifierExpression(event, os)
			: `!${event}.ctrlKey && !${event}.metaKey`,
	];
	conditions.push(spec.alt ? `${event}.altKey` : `!${event}.altKey`);
	if (spec.key.kind === "code") {
		conditions.push(spec.shift ? `${event}.shiftKey` : `!${event}.shiftKey`);
	}
	conditions.push(
		spec.key.kind === "code"
			? `${event}.code === '${spec.key.code}'`
			: `${event}.key === '${spec.key.key}'`,
	);
	return conditions.join(" && ");
}

// A `Map` (rather than an indexed `Record<string, string>`) so this lookup table's own
// declaration carries no open-dictionary type annotation — `formatKeyId` below indexes it
// with an arbitrary token straight from `keyId.split("+")`.
const keyIdTokenLabels = new Map<string, string>([
	["ctrl", "ctrl"],
	["alt", "alt"],
	["shift", "shift"],
	["super", "cmd"],
	["escape", "Esc"],
	["esc", "Esc"],
	["enter", "Enter"],
	["return", "Enter"],
	["tab", "Tab"],
	["space", "Space"],
	["backspace", "Backspace"],
	["delete", "Del"],
	["insert", "Ins"],
	["clear", "Clear"],
	["home", "Home"],
	["end", "End"],
	["pageup", "PgUp"],
	["pagedown", "PgDn"],
	["up", "↑"],
	["down", "↓"],
	["left", "←"],
	["right", "→"],
]);

/**
 * A display label for a pi-tui `KeyId` string (`"alt+o"` → `"alt O"`,
 * `"ctrl+shift+p"` → `"ctrl shift P"`, `"escape"` → `"Esc"`) — a plain
 * `Map` lookup rather than routing through `ShortcutSpec` (which only
 * covers pi-ui's own narrower letter/digit/`/`/`^` catalog and would drop
 * every special key an extension shortcut is free to use). Only used for
 * display (the `/hotkeys` dialog); matching still goes through
 * `static/app/extension-keys.ts`'s own token table.
 */
export function formatKeyId(keyId: string): string {
	return keyId
		.split("+")
		.map(
			(token) =>
				keyIdTokenLabels.get(token) ??
				(token.length === 1 ? token.toUpperCase() : token),
		)
		.join(" ");
}

export function ariaKeyshortcuts(spec: ShortcutSpec): string {
	const combos: string[] = [];
	const bases = spec.primary ? ["Control", "Meta"] : [""];
	for (const base of bases) {
		const parts = base ? [base] : [];
		if (spec.alt) parts.push("Alt");
		if (spec.shift && spec.key.kind === "code") {
			parts.push("Shift");
		}
		parts.push(spec.key.token);
		combos.push(parts.join("+"));
	}
	return combos.join(" ");
}
