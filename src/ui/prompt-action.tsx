import { endpoints } from "../server/routes/endpoints.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { Icon } from "./icon.tsx";
import { ArrowUp, Square } from "./icons.ts";
import { ShortcutTooltip } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

export function renderPromptAction(state: AppStateSnapshot): string {
	if (state.activityText) {
		return syncHtml(
			<button
				id="prompt-action"
				class="btn leading-none"
				data-variant="destructive"
				data-size="icon"
				type="button"
				data-on:click={`@post('${endpoints.abort}', { payload: {} })`}
				data-on:keydown__window={`if (
					evt.code === 'Escape' &&
					!evt.ctrlKey &&
					!evt.metaKey &&
					!evt.altKey &&
					!evt.shiftKey &&
					window.piUi.shouldAbortOnEscape(evt)
				) {
					evt.preventDefault();
					@post('${endpoints.abort}', { payload: {} });
				}`}
				data-tooltip="Abort"
				data-align="end"
				aria-label="Abort"
			>
				<Icon icon={Square} class="size-3.5 [&_rect]:fill-current" />
				<ShortcutTooltip label="Abort" shortcut="Esc" />
			</button>,
		);
	}

	return syncHtml(
		<button
			id="prompt-action"
			class="btn leading-none"
			data-size="icon"
			type="button"
			data-send-trigger
			data-attr:disabled="
				$prompt.trim() === '' &&
				!window.piUi.fileTransfer.hasAttachments()
			"
			data-on:click={`
				window.piUi.messageScroll.scrollBottom();
				const submittedPrompt = $prompt;
				window.piUi.prompt.clear();
				if (submittedPrompt.trim() === '/tree') window.piUi.dialogs.openTree();
				window.piUi.fileTransfer.submit('${endpoints.prompt}', submittedPrompt);
			`}
			data-tooltip="Send"
			data-tooltip-delay
			data-align="end"
			aria-label="Send"
		>
			<Icon icon={ArrowUp} />
			<ShortcutTooltip label="Send" shortcut="Enter" />
		</button>,
	);
}
