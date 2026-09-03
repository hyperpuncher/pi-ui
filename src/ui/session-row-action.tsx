import type { AppSessionSummary } from "../state/app-store.ts";
import { ShortcutKbd } from "./keyboard.tsx";
import { SessionDeleteButton } from "./session-delete-button.tsx";
import { syncHtml } from "./sync-html.ts";

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
			{props.deletable && (
				<SessionDeleteButton session={props.session} class="session-row-delete" />
			)}
		</span>,
	);
}
