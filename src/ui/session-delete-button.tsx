import type { AppSessionSummary } from "../state/app-store.ts";
import { Icon } from "./icon.tsx";
import { Trash2 } from "./icons.ts";
import { syncHtml } from "./sync-html.ts";

export function SessionDeleteButton(props: {
	session: AppSessionSummary;
	class?: string;
}): string {
	const path = JSON.stringify(props.session.path);
	const title = JSON.stringify(props.session.title);
	return syncHtml(
		<button
			type="button"
			class={["btn session-delete-button", props.class]}
			data-variant="ghost"
			data-attr:data-variant={`$sessionDeleteHover === ${path} ? 'destructive' : 'ghost'`}
			data-size="icon-xs"
			aria-label={`Delete session ${props.session.title}`}
			commandfor="session-delete-dialog"
			command="show-modal"
			data-on:mouseenter={`$sessionDeleteHover = ${path}`}
			data-on:mouseleave="$sessionDeleteHover = ''"
			data-on:focus={`$sessionDeleteHover = ${path}`}
			data-on:blur="$sessionDeleteHover = ''"
			data-on:click={`
				evt.stopPropagation();
				$sessionDeletePath = ${path};
				$sessionDeleteTitle = ${title};
			`}
		>
			<Icon icon={Trash2} />
		</button>,
	);
}
