import { endpoints } from "../server/routes/endpoints.ts";
import type { AppRenderSnapshot } from "../state/app-store.ts";
import { Icon } from "./icon.tsx";
import { ShortcutKbd } from "./keyboard.tsx";
import { renderSlashPicker, slashPickerOpenExpression } from "./pickers.tsx";
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
			class="absolute inset-x-4 bottom-6 z-10 mx-auto max-w-(--pi-prompt-max-width) overflow-visible text-sm"
		>
			<div
				id="prompt-slash-popover"
				class="absolute right-0 bottom-full left-0 z-30 mb-2 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
				style="display: none;"
				data-show={`$_slashPickerOpen && (${slashPickerOpenExpression(state)})`}
			>
				{renderSlashPicker(state)}
			</div>
			<div
				id="prompt-file-popover"
				class="absolute right-0 bottom-full left-0 z-30 mb-2 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
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
				<div
					id="prompt-attachments"
					class="absolute bottom-full left-3 z-20 mb-2 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2 overflow-visible"
					aria-label="Attachments"
					data-ignore-morph
					hidden
				/>
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
						const send = document.querySelector('[data-send-trigger]');
						if (send) send.disabled = !window.piUi.fileTransfer.canSubmit($prompt);
					"
					data-on:pi-ui-picker-close="$_slashPickerOpen = false"
					data-on:pi-ui-file-query={`
						if (typeof $_fileSearchController?.abort === 'function') {
							$_fileSearchController.abort();
						}
						$_fileSearchController = new AbortController();
						$fileQuery = evt.detail.query;
						@get('${endpoints.filesSearch}', {
						filterSignals: { include: /^fileQuery$/ },
						requestCancellation: $_fileSearchController,
					});
					`}
					data-on:pi-ui-file-close={`
						if (typeof $_fileSearchController?.abort === 'function') {
							$_fileSearchController.abort();
						}
						$_fileSearchController = '';
						$_filePickerOpen = false;
					`}
					data-effect={`if ($_isSessionReady) {
						el.focus({ preventScroll: true });
						el.selectionStart = el.value.length;
						el.selectionEnd = el.value.length;
					}`}
					data-on:paste={`if (window.piUi.fileTransfer.hasFiles(evt.clipboardData)) {
						evt.preventDefault();
						window.piUi.fileTransfer.insert(evt.clipboardData);
					}`}
					data-on:keydown={`
						window.piUi.promptHistory.handleKeydown(evt, $_promptHistory);
						if (
							evt.code === 'Escape' &&
							!evt.ctrlKey &&
							!evt.metaKey &&
							!evt.altKey &&
							!evt.shiftKey &&
							!$_isBusy
						) {
							evt.preventDefault();
							el.blur();
						}
						if (evt.altKey && evt.code === 'ArrowUp') {
							evt.preventDefault();
							@post('${endpoints.promptDequeue}', { filterSignals: { include: /^$/ } });
						}
						if (
							evt.key === 'Enter' &&
							!evt.shiftKey &&
							window.piUi.fileTransfer.canSubmit($prompt) &&
							!window.piUi.pickers.isOpen()
						) {
							evt.preventDefault();
							window.piUi.messageScroll.scrollBottom();
							const submittedPrompt = $prompt;
							$prompt = '';
							if (submittedPrompt.trim() === '/tree') window.piUi.dialogs.openTree();
							window.piUi.fileTransfer.submit(
								evt.altKey ? '${endpoints.promptFollowUp}' : '${endpoints.prompt}',
								submittedPrompt,
								evt.altKey ? 'followUp' : undefined,
							);
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
							class="hidden h-4 w-0 shrink-0 border-l border-border sm:block"
							aria-hidden="true"
						/>
						{renderModelPicker(state)}
						<span
							class="hidden h-4 w-0 shrink-0 border-l border-border sm:block"
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
			class="pointer-events-none mx-auto flex w-[calc(100%-2rem)] flex-col items-center sm:w-[calc(100%-4rem)]"
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
			class="btn pointer-events-auto z-20 mb-4 rounded-full border-foreground/10! bg-background/40! backdrop-blur-[2px] transition-[translate,background-color] duration-150 ease-out hover:bg-muted/70! motion-reduce:transition-none dark:bg-input/30! hover:dark:bg-input/50!"
			data-variant="outline"
			data-size="icon"
			data-preserve-attr="hidden inert tabindex style"
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
		...state.queuedSteeringMessages.map((text, index) => ({
			behavior: "steer" as const,
			index,
			label: "Steering",
			text,
		})),
		...state.queuedFollowUpMessages.map((text, index) => ({
			behavior: "followUp" as const,
			index,
			label: "Follow-up",
			text,
		})),
	];
	if (items.length === 0) return "";
	return (
		<section class="pointer-events-auto -mx-3 -mb-3 flex max-h-40 w-[calc(100%+1.5rem)] flex-col gap-1 overflow-y-auto px-3 pt-2 pb-4">
			{items.map(({ behavior, index, label, text }, itemIndex) => (
				<div class="prompt-queue-item pi-raised-surface pi-prompt-surface group flex min-h-9 min-w-0 translate-y-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs opacity-100 shadow-md transition-[opacity,translate] duration-100 ease-out motion-reduce:translate-y-0 motion-reduce:transition-opacity starting:translate-y-1 starting:opacity-0">
					<span
						class={[
							"size-1 shrink-0 rounded-full",
							label === "Steering" ? "bg-amber-400" : "bg-sky-400",
						]}
						aria-hidden="true"
					/>
					<span
						class={[
							"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
							label === "Steering"
								? "pi-warning-fine-print bg-amber-500/10"
								: "pi-info-fine-print bg-sky-500/10",
						]}
					>
						{label}
					</span>
					<span class="min-w-0 flex-1 truncate text-muted-foreground" safe>
						{text}
					</span>
					{itemIndex === 0 ? (
						<button
							type="button"
							class="-my-1 flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							data-on:click={`@post('${endpoints.promptDequeue}', { filterSignals: { include: /^$/ } })`}
							aria-label="Restore all queued messages to the prompt"
						>
							<span>Restore all</span>
							<ShortcutKbd shortcut="alt ↑" />
						</button>
					) : (
						""
					)}
					<button
						type="button"
						class="-my-1 -mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,opacity] hover:bg-muted hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 focus-visible:sm:opacity-100"
						data-on:click={`@post('${endpoints.promptQueueRemove}', { payload: { queueBehavior: '${behavior}', queueIndex: ${index} } })`}
						aria-label="Remove queued message"
					>
						<Icon>
							<path d="m18 6-12 12M6 6l12 12" />
						</Icon>
					</button>
				</div>
			))}
		</section>
	) as string;
}
