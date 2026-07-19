import { endpoints } from "../server/routes/endpoints.ts";
import type { AppRenderSnapshot } from "../state/app-store.ts";
import { ShortcutKbd } from "./keyboard.tsx";
import { renderSlashPicker } from "./pickers.tsx";
import { renderPromptAction } from "./prompt-action.tsx";
import {
	renderModelPicker,
	renderThinkingPicker,
	renderWorkspacePicker,
} from "./prompt-pickers.tsx";
import { renderPromptStatus } from "./prompt-status.tsx";
import { renderPromptToolbar } from "./prompt-toolbar.tsx";

export function renderPromptBox(
	state: AppRenderSnapshot,
	reviewAvailable = false,
): string {
	return (
		<div
			id="prompt-box"
			class="absolute inset-x-4 bottom-6 z-10 mx-auto max-w-[var(--pi-prompt-max-width)] overflow-visible text-sm"
		>
			<div
				id="prompt-slash-popover"
				class="bg-popover text-popover-foreground absolute right-0 bottom-full left-0 z-30 mb-2 rounded-md border p-1 shadow-md"
				style="display: none;"
				data-show="$_slashPickerOpen"
			>
				{renderSlashPicker(state)}
			</div>
			<div
				id="prompt-file-popover"
				class="bg-popover text-popover-foreground absolute right-0 bottom-full left-0 z-30 mb-2 rounded-md border p-1 shadow-md"
				style="display: none;"
				data-show="$_filePickerOpen"
			>
				<div id="file-picker-results" aria-live="polite" />
			</div>
			{renderPromptQueue(state)}
			<div
				class="input-group pi-raised-surface pi-prompt-surface relative z-10 overflow-visible p-3 text-sm transition-none"
				data-orientation="vertical"
			>
				<textarea
					id="prompt-input"
					class="field-sizing-content max-h-44 min-h-7 resize-none overflow-y-auto p-1 text-[15px]"
					placeholder="Ask pi anything..."
					aria-label="Message"
					rows="1"
					data-bind:prompt
					data-on:input="
						window.piUi.promptHistory.handleInput();
						$_slashPickerOpen = $prompt.startsWith('/') &&
						!$prompt.includes(' ');
					"
					data-on:pi-ui-picker-close="$_slashPickerOpen = false"
					data-on:pi-ui-file-query={`
						$fileQuery = evt.detail.query;
						$_filePickerOpen = true;
						@get('${endpoints.filesSearch}', {
						filterSignals: { include: /^fileQuery$/ },
						requestCancellation: 'cleanup',
					});
					`}
					data-on:pi-ui-file-close="$_filePickerOpen = false"
					data-effect={`if ($isSessionReady) {
						el.focus({ preventScroll: true });
						el.selectionStart = el.value.length;
						el.selectionEnd = el.value.length;
					}`}
					data-on:paste={`if (window.piUi.fileTransfer.hasFiles(evt.clipboardData)) {
						evt.preventDefault();
						window.piUi.fileTransfer.insert(evt.clipboardData);
					}`}
					data-on:keydown={`
						window.piUi.promptHistory.handleKeydown(evt, $promptHistory);
						if (
							evt.key === 'Escape' &&
							!evt.ctrlKey &&
							!evt.metaKey &&
							!evt.altKey &&
							!evt.shiftKey &&
							!$isBusy
						) {
							evt.preventDefault();
							el.blur();
						}
						if (evt.altKey && evt.key === 'ArrowUp') {
							evt.preventDefault();
							@post('${endpoints.promptDequeue}', { filterSignals: { include: /^$/ } });
						}
						if (
							evt.key === 'Enter' &&
							!evt.shiftKey &&
							$prompt.trim() !== '' &&
							!window.piUi.pickers.isOpen()
						) {
							evt.preventDefault();
							window.piUi.messageScroll.scrollBottom();
							if ($prompt.trim() === '/tree') window.piUi.dialogs.openTree();
							evt.altKey
								? @post('${endpoints.promptFollowUp}', { filterSignals: { include: /^prompt$/ } })
								: @post('${endpoints.prompt}', { filterSignals: { include: /^prompt$/ } });
							$prompt = '';
						};
					`}
				></textarea>
				<footer
					class="flex flex-wrap items-center justify-between gap-2 p-0"
					data-align="end"
				>
					{renderPromptToolbar(state, reviewAvailable)}
					<div class="flex min-w-0 flex-1 items-center justify-end gap-1.5">
						{renderPromptStatus(state)}
						{renderWorkspacePicker(state)}
						<span
							class="border-border hidden h-4 w-0 shrink-0 border-l sm:block"
							aria-hidden="true"
						/>
						{renderModelPicker(state)}
						<span
							class="border-border hidden h-4 w-0 shrink-0 border-l sm:block"
							aria-hidden="true"
						/>
						{renderThinkingPicker(state)}
						{renderPromptAction(state)}
					</div>
				</footer>
			</div>
		</div>
	) as string;
}

export function renderPromptQueue(state: AppRenderSnapshot): string {
	return (
		<div
			id="prompt-queue"
			class="pointer-events-none absolute bottom-full left-1/2 flex w-[calc(100%-2rem)] -translate-x-1/2 flex-col items-center sm:w-[calc(100%-4rem)]"
			aria-live="polite"
		>
			{renderLatestButton()}
			{renderQueuedMessages(state)}
		</div>
	) as string;
}

function renderLatestButton() {
	return (
		<button
			id="messages-latest"
			type="button"
			class="btn pointer-events-auto z-20 mb-4 rounded-full"
			data-variant="secondary"
			data-size="icon"
			data-preserve-attr="hidden inert tabindex"
			data-on:click="window.piUi.messageScroll.scrollBottom('smooth')"
			aria-label="Jump to latest message"
			hidden
			inert
			tabindex="-1"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="32"
				height="32"
				viewBox="0 0 24 24"
				aria-hidden="true"
			>
				<path
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 5v14m7-7l-7 7l-7-7"
				/>
			</svg>
		</button>
	);
}

function renderQueuedMessages(state: AppRenderSnapshot): string {
	const items = [
		...state.queuedSteeringMessages.map((text) => ["Steering", text] as const),
		...state.queuedFollowUpMessages.map((text) => ["Follow-up", text] as const),
	];
	if (items.length === 0) return "";
	return (
		<section class="prompt-queue-surface pi-raised-surface pi-prompt-surface pointer-events-auto -mb-3 w-full translate-y-0 overflow-hidden border border-transparent opacity-100 transition-[opacity,translate] duration-150 ease-out motion-reduce:translate-y-0 motion-reduce:transition-opacity motion-reduce:duration-100 starting:translate-y-full starting:opacity-0">
			<header class="flex h-8 items-center justify-between gap-3 px-3">
				<div class="text-muted-foreground flex min-w-0 items-center gap-2 text-xs font-medium">
					<span class="text-muted-foreground">
						<QueueIcon />
					</span>
					<span>
						{items.length} queued{" "}
						{items.length === 1 ? "message" : "messages"}
					</span>
				</div>
				<button
					type="button"
					class="text-muted-foreground hover:bg-muted hover:text-foreground -mr-1 flex h-7 items-center gap-2 rounded-md px-2 text-xs transition-colors"
					data-on:click={`@post('${endpoints.promptDequeue}', { filterSignals: { include: /^$/ } })`}
					aria-label="Restore queued messages to the prompt"
				>
					<span>Restore</span>
					<ShortcutKbd shortcut="alt ↑" />
				</button>
			</header>
			<div class="flex max-h-32 flex-col overflow-y-auto px-1.5 pb-4">
				{items.map(([label, text]) => (
					<div class="prompt-queue-item hover:bg-muted/60 flex min-w-0 translate-y-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-xs opacity-100 transition-[opacity,translate] duration-100 ease-out motion-reduce:translate-y-0 motion-reduce:transition-opacity starting:translate-y-1 starting:opacity-0">
						<span
							class={[
								"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
								label === "Steering"
									? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
									: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
							]}
						>
							{label}
						</span>
						<span class="text-muted-foreground truncate" safe>
							{text}
						</span>
					</div>
				))}
			</div>
		</section>
	) as string;
}

function QueueIcon() {
	return (
		<Icon>
			<>
				<path d="M8 6h13M8 12h13M8 18h13" />
				<path d="M3 6h.01M3 12h.01M3 18h.01" />
			</>
		</Icon>
	);
}

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
