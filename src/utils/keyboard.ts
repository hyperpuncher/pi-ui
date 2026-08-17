type KeyboardModifiers = Pick<KeyboardEvent, "ctrlKey" | "metaKey">;
type OperatingSystem = typeof Deno.build.os;

const primaryModifierKey = Deno.build.os === "darwin" ? "⌘" : "ctrl";

export function hasPrimaryModifier(
	event: KeyboardModifiers,
	os: OperatingSystem = Deno.build.os,
): boolean {
	return os === "darwin"
		? event.metaKey && !event.ctrlKey
		: event.ctrlKey && !event.metaKey;
}

export function primaryModifierExpression(
	event = "evt",
	os: OperatingSystem = Deno.build.os,
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
