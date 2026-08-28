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
