export const primaryModifierKey = Deno.build.os === "darwin" ? "⌘" : "ctrl";

export function formatShortcut(shortcut: string): string {
	return shortcut.replace(/^ctrl\b/i, primaryModifierKey);
}

export function shortcutParts(shortcut: string): string[] {
	return formatShortcut(shortcut).split(/\s+/).filter(Boolean);
}
