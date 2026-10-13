import { operatingSystem, type OperatingSystem } from "#src/utils/platform.ts";

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
