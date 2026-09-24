import { formatShortcut, shortcutParts } from "../utils/keyboard.ts";
import { operatingSystem } from "../utils/platform.ts";

export function shortcutGlyph(part: string): string {
	const key = part.toLowerCase();
	if (key === "alt") return "⌥";
	if (key === "shift") return "⇧";
	return part;
}

export function ShortcutKbd(props: { shortcut: string }) {
	const symbolic = operatingSystem === "darwin";
	const label = symbolic ? formatShortcut(props.shortcut) : undefined;
	return (
		<span class="shortcut" data-keybind-hint title={label}>
			{shortcutParts(props.shortcut).map((part) => (
				<kbd class="kbd">{symbolic ? shortcutGlyph(part) : part}</kbd>
			))}
		</span>
	);
}

export function ShortcutTooltip(props: { label: string; shortcut?: string }) {
	return (
		<span
			class="shortcut-tooltip"
			role="tooltip"
			data-slot="tooltip-content"
			popover="manual"
		>
			<span>{props.label}</span>
			{props.shortcut && <ShortcutKbd shortcut={props.shortcut} />}
		</span>
	);
}
