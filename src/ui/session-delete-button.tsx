import type { AppSessionSummary } from "../state/app-store.ts";
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
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="text-current!"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M10 11v6" />
				<path d="M14 11v6" />
				<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
				<path d="M3 6h18" />
				<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
			</svg>
		</button>,
	);
}
