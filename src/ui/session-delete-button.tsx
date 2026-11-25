import type { AppSessionSummary } from "#src/state/app-store.ts";
import { Icon } from "#src/ui/icon.tsx";
import { syncHtml } from "#src/ui/sync-html.ts";

export function SessionDeleteButton(props: { session: AppSessionSummary }): string {
	return syncHtml(
		<button
			type="button"
			class="btn row-action row-action-danger"
			data-variant="ghost"
			data-size="icon-xs"
			aria-label={`Delete session ${props.session.title}`}
			commandfor="session-delete-dialog"
			command="show-modal"
			data-delete-session-path={props.session.path}
			data-delete-session-title={props.session.title}
		>
			<Icon name="trash" />
		</button>,
	);
}
