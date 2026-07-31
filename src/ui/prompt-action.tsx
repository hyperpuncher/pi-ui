import { endpoints } from "../server/routes/endpoints.ts";
import type { AppRenderSnapshot } from "../state/app-store.ts";
import { Icon } from "./icon.tsx";
import { ShortcutTooltip } from "./keyboard.tsx";

function StopIcon() {
	return (
		<Icon>
			<rect width="18" height="18" x="3" y="3" rx="2" fill="currentColor" />
		</Icon>
	);
}

function SendIcon() {
	return (
		<Icon>
			<path d="m5 12 7-7 7 7m-7 7V5" />
		</Icon>
	);
}

export function renderPromptAction(state: AppRenderSnapshot): string {
	if (state.activityText) {
		return (
			<button
				id="prompt-action"
				class="btn leading-none"
				data-variant="destructive"
				data-size="icon"
				type="button"
				data-on:click={`@post('${endpoints.abort}', { filterSignals: { include: /^$/ } })`}
				data-on:keydown__window={`if (
					evt.code === 'Escape' &&
					!evt.ctrlKey &&
					!evt.metaKey &&
					!evt.altKey &&
					!evt.shiftKey &&
					window.piUi.shouldAbortOnEscape(evt)
				) {
					evt.preventDefault();
					@post('${endpoints.abort}', { filterSignals: { include: /^$/ } });
				}`}
				data-tooltip="Abort"
				aria-label="Abort"
			>
				<StopIcon />
				<ShortcutTooltip label="Abort" shortcut="Esc" />
			</button>
		) as string;
	}

	return (
		<button
			id="prompt-action"
			class="btn leading-none"
			data-size="icon"
			type="button"
			data-send-trigger
			data-attr:disabled="$prompt.trim() === ''"
			data-on:click={`
				window.piUi.messageScroll.scrollBottom();
				const submittedPrompt = $prompt;
				$prompt = '';
				@post('${endpoints.prompt}', { payload: { prompt: submittedPrompt } });
			`}
			data-tooltip="Send"
			data-tooltip-delay
			aria-label="Send"
		>
			<SendIcon />
			<ShortcutTooltip label="Send" shortcut="Enter" />
		</button>
	) as string;
}
