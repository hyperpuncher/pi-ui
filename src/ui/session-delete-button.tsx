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
			class={["btn shrink-0", props.class]}
			data-variant="ghost"
			data-attr:data-variant={`$sessionDeleteHover === ${path} ? 'destructive' : 'ghost'`}
			data-size="icon-xs"
			aria-label={`Delete session ${props.session.title}`}
			data-on:mouseenter={`$sessionDeleteHover = ${path}`}
			data-on:mouseleave="$sessionDeleteHover = ''"
			data-on:focus={`$sessionDeleteHover = ${path}`}
			data-on:blur="$sessionDeleteHover = ''"
			data-on:click={`
				evt.stopPropagation();
				$sessionDeletePath = ${path};
				$sessionDeleteTitle = ${title};
				document.getElementById('session-delete-dialog')?.showModal();
			`}
		>
			<Icon icon={Trash2} class="text-current!" />
		</button>,
	);
}
