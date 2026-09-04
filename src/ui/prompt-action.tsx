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
				class="btn prompt-action"
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
				<span class="prompt-action-icons">
					<Icon
						icon={ArrowUp}
						class="prompt-send-icon prompt-action-icon-exit"
					/>
					<Icon
						icon={Square}
						class="prompt-abort-icon prompt-action-icon-enter"
					/>
				</span>
				<ShortcutTooltip label="Abort" shortcut="Esc" />
			</button>,
		);
	}

	return syncHtml(
		<button
			id="prompt-action"
			class="btn prompt-action"
			data-size="icon"
			type="button"
			data-send-trigger
			data-attr:disabled="
				$_promptSubmitting ||
				!window.piUi.fileTransfer.canSubmit($prompt)
			"
			data-attr:aria-label="$_promptSubmitting ? 'Sending' : 'Send'"
			data-on:click={`
				window.piUi.messageScroll.scrollBottom();
				const submittedPrompt = $prompt;
				$_promptSubmitting = true;
				window.piUi.prompt.clear();
				window.piUi.fileTransfer.submit('${endpoints.prompt}', submittedPrompt);
			`}
			data-tooltip="Send"
			data-tooltip-delay
			data-align="end"
			aria-label="Send"
		>
			<span class="prompt-action-icons">
				<Icon icon={ArrowUp} class="prompt-send-icon prompt-action-icon-enter" />
				<Icon icon={Square} class="prompt-abort-icon prompt-action-icon-exit" />
			</span>
			<ShortcutTooltip label="Send" shortcut="Enter" />
		</button>,
	);
}
