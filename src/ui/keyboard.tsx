import { shortcutParts } from "../utils/keyboard.ts";

export function ShortcutKbd(props: { shortcut: string; shortcutSlot?: boolean }) {
	return (
		<span
			class="flex items-center gap-1"
			data-shortcut={props.shortcutSlot ? "" : undefined}
		>
			{shortcutParts(props.shortcut).map((part) => (
				<kbd class="kbd">{part}</kbd>
			))}
			<span class="hidden" aria-hidden="true" />
		</span>
	);
}
