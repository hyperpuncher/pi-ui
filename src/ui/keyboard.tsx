import { formatShortcut, shortcutParts } from "../utils/keyboard.ts";
import { operatingSystem } from "../utils/platform.ts";

export function altShortcutAction(code: string, action: string): string {
	return `if (
		evt.code === '${code}' &&
		evt.altKey &&
		!evt.shiftKey &&
		!evt.ctrlKey &&
		!evt.metaKey &&
		!document.querySelector('dialog[open]')
	) {
		evt.preventDefault();
		${action}
	}`;
}

function shortcutGlyph(part: string): string {
	const key = part.toLowerCase();
	if (key === "alt") return "⌥";
	if (key === "ctrl") return "⌃";
	if (key === "shift") return "⇧";
	return part;
}

export function ShortcutKbd(props: { shortcut: string }) {
	const symbolic = operatingSystem === "darwin";
	const label = symbolic ? formatShortcut(props.shortcut) : undefined;
	return (
		<span class="shortcut" data-keybind-hint aria-label={label} title={label}>
			{shortcutParts(props.shortcut).map((part) => (
				<kbd class="kbd">{symbolic ? shortcutGlyph(part) : part}</kbd>
			))}
			<span hidden aria-hidden="true" />
		</span>
	);
}

export function ShortcutTooltip(props: { label: string; shortcut: string }) {
	return (
		<span class="shortcut-tooltip" role="tooltip" data-slot="tooltip-content">
			<span>{props.label}</span>
			<ShortcutKbd shortcut={props.shortcut} />
		</span>
	);
}
