import { endpoints } from "#src/server/routes/endpoints.ts";
import type { AppSessionSummary } from "#src/state/app-store.ts";
import { syncHtml } from "#src/ui/sync-html.ts";

function startSessionRenameAction(session: AppSessionSummary): string {
	return `
		const title = evt.currentTarget;
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
		<span
			class="session-rename"
			data-session-rename-title
			data-on:click__stop="true"
			data-on:dblclick__prevent__stop={startSessionRenameAction(props.session)}
		>
			<span class="session-rename-title" data-show={`!(${editing})`} safe>
				{props.session.title}
			</span>
			<input
				type="text"
				class="input session-rename-input"
				style="display: none"
				aria-label={`Rename session ${props.session.title}`}
				maxlength="96"
				data-session-rename-input
				data-show={editing}
				data-bind:session-rename-title
				data-indicator:_session-renaming
				data-attr:disabled="$_sessionRenaming"
				data-on:dblclick__stop="true"
				data-on:keydown__stop={`if (evt.key === 'Enter') {
					evt.preventDefault();
					evt.currentTarget.blur();
				} else if (evt.key === 'Escape') {
					evt.preventDefault();
					$sessionRenamePath = '';
					$sessionRenameTitle = '';
					evt.currentTarget.blur();
				}`}
				data-on:blur={finishSessionRenameAction(props.session)}
			/>
		</span>,
	);
}
