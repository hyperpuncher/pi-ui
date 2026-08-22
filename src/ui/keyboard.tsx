import { shortcutParts } from "../utils/keyboard.ts";

export function ShortcutKbd(props: { shortcut: string; shortcutSlot?: boolean }) {
	return (
		<span class="flex items-center gap-1" data-shortcut={props.shortcutSlot}>
			{shortcutParts(props.shortcut).map((part) => (
				<kbd class="kbd">{part}</kbd>
			))}
			<span class="hidden" aria-hidden="true" />
		</span>
	);
}

export function ShortcutTooltip(props: { label: string; shortcut: string }) {
	return (
		<span class="font-sans" role="tooltip" data-slot="tooltip-content">
			<span>{props.label}</span>
			<ShortcutKbd shortcut={props.shortcut} />
		</span>
	);
}
