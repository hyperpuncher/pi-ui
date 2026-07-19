import { endpoints } from "../server/routes/endpoints.ts";
import type { AppRenderSnapshot } from "../state/app-store.ts";
import { ShortcutTooltip } from "./keyboard.tsx";

function Icon(props: { children: JSX.Element }) {
	return (
		<svg
			class="size-3.5"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			aria-hidden="true"
		>
			{props.children}
		</svg>
	);
}

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
					evt.key === 'Escape' &&
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
				@post('${endpoints.prompt}', { filterSignals: { include: /^prompt$/ } });
				$prompt = '';
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
