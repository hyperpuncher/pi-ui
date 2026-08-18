import { endpoints } from "../server/routes/endpoints.ts";
import type { AppSessionSummary } from "../state/app-store.ts";
import { syncHtml } from "./sync-html.ts";

function startSessionRenameAction(session: AppSessionSummary): string {
	return `
		evt.preventDefault();
		evt.stopPropagation();
		const title = evt.currentTarget.parentElement;
		$sessionRenamePath = ${JSON.stringify(session.path)};
		$sessionRenameTitle = ${JSON.stringify(session.title)};
		queueMicrotask(() => {
			const input = title?.querySelector('[data-session-rename-input]');
			input?.focus();
			input?.select();
		});
	`;
}

function finishSessionRenameAction(session: AppSessionSummary): string {
	const path = JSON.stringify(session.path);
	const title = JSON.stringify(session.title);
	return `
		if ($sessionRenamePath === ${path}) {
			const nextTitle = $sessionRenameTitle.trim();
			if (nextTitle && nextTitle !== ${title}) {
				@post('${endpoints.sessionsRename}', {
					payload: {
						sessionRenamePath: $sessionRenamePath,
						sessionRenameTitle: nextTitle,
					},
				});
			} else {
				$sessionRenamePath = '';
				$sessionRenameTitle = '';
			}
		}
	`;
}

export function SessionRenameTitle(props: { session: AppSessionSummary }): string {
	const editing = `$sessionRenamePath === ${JSON.stringify(props.session.path)}`;
	return syncHtml(
		<span class="pointer-events-auto min-w-0 flex-1 cursor-text text-[13px] font-medium text-foreground">
			<span
				class="block truncate"
				data-show={`!(${editing})`}
				data-on:dblclick={startSessionRenameAction(props.session)}
				safe
			>
				{props.session.title}
			</span>
			<input
				type="text"
				class="input pointer-events-auto h-6 w-full min-w-0 rounded-sm px-1 py-0 text-[13px]"
				style="display: none"
				aria-label={`Rename session ${props.session.title}`}
				maxlength="96"
				data-session-rename-input
				data-show={editing}
				data-bind:session-rename-title
				data-indicator:_session-renaming
				data-attr:disabled="$_sessionRenaming"
				data-on:click="evt.stopPropagation()"
				data-on:dblclick="evt.stopPropagation()"
				data-on:keydown={`
					evt.stopPropagation();
					if (evt.key === 'Enter') {
						evt.preventDefault();
						evt.currentTarget.blur();
					} else if (evt.key === 'Escape') {
						evt.preventDefault();
						$sessionRenamePath = '';
						$sessionRenameTitle = '';
						evt.currentTarget.blur();
					};
				`}
				data-on:blur={finishSessionRenameAction(props.session)}
			/>
		</span>,
	);
}
