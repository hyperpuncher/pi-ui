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
		<span class="grid shrink-0 items-center justify-items-end *:[grid-area:1/1]">
			{props.shortcut && (
				<span
					class={
						props.deletable
							? "transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0 motion-reduce:transition-none"
							: undefined
					}
				>
					<ShortcutKbd shortcut={props.shortcut} />
				</span>
			)}
			{props.deletable && (
				<SessionDeleteButton
					session={props.session}
					class="pointer-events-none opacity-0 transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 motion-reduce:transition-none"
				/>
			)}
		</span>,
	);
}
