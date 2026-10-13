import type { AppSessionSummary } from "#src/state/app-store.ts";
import { ShortcutKbd } from "#src/ui/keyboard.tsx";
import { SessionDeleteButton } from "#src/ui/session-delete-button.tsx";
import { syncHtml } from "#src/ui/sync-html.ts";

export function SessionRowAction(props: {
	session: AppSessionSummary;
	shortcut?: string;
	deletable: boolean;
}): string {
	if (!props.shortcut && !props.deletable) return "";
	return syncHtml(
		<span class="session-row-actions">
			{props.shortcut && (
				<span class={props.deletable ? "session-row-shortcut" : undefined}>
					<ShortcutKbd shortcut={props.shortcut} />
				</span>
			)}
			{props.deletable && <SessionDeleteButton session={props.session} />}
		</span>,
	);
}
