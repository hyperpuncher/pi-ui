import type { AppSessionSummary } from "../state/app-store.ts";
import { Icon } from "./icon.tsx";
import { syncHtml } from "./sync-html.ts";

export function SessionDeleteButton(props: { session: AppSessionSummary }): string {
	const path = JSON.stringify(props.session.path);
	const title = JSON.stringify(props.session.title);
	return syncHtml(
		<button
			type="button"
			class="btn row-action row-action-danger"
			data-variant="ghost"
			data-size="icon-xs"
			aria-label={`Delete session ${props.session.title}`}
			commandfor="session-delete-dialog"
			command="show-modal"
			data-on:click__stop={`
				$sessionDeletePath = ${path};
				$sessionDeleteTitle = ${title};
			`}
		>
			<Icon name="trash" />
		</button>,
	);
}
