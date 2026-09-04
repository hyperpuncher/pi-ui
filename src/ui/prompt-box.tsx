import { endpoints } from "../server/routes/endpoints.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { renderExtensionWidgets } from "./extension-widgets.tsx";
import { Icon } from "./icon.tsx";
import { ArrowDown, X } from "./icons.ts";
import { altShortcutAction, ShortcutKbd } from "./keyboard.tsx";
import { renderSlashPicker, slashPickerOpenExpression } from "./pickers.tsx";
import { renderPromptAction } from "./prompt-action.tsx";
import {
	renderModelPicker,
	renderThinkingPicker,
	renderWorkspacePicker,
} from "./prompt-pickers.tsx";
import { renderPromptStatus } from "./prompt-status.tsx";
import { renderPromptToolbar } from "./prompt-toolbar.tsx";
import { syncHtml } from "./sync-html.ts";

export function renderPromptBox(
	state: AppStateSnapshot,
	reviewAvailable = false,
): string {
	return syncHtml(
		<div
			id="prompt-box"
			class="prompt-box"
			data-signals__ifmissing={JSON.stringify({
				prompt: state.promptEditorText,
				_filePickerOpen: false,
				_fileSearchController: "",
				_slashPickerOpen: false,
				_promptSubmitting: false,
				fileQuery: "",
			})}
			data-on:pointerdown__outside="window.piUi.pickers.close()"
			data-on:pi-ui-prompt-submit-finished="$_promptSubmitting = false"
		>
			<div class="prompt-popovers">
				{renderLatestButton()}
				<div
					id="prompt-slash-popover"
					class="prompt-picker-popover"
					style="display: none;"
					data-show={`$_slashPickerOpen && (${slashPickerOpenExpression(state)})`}
				>
					{renderSlashPicker(state)}
				</div>
				<div
					id="prompt-file-popover"
					class="prompt-picker-popover"
					style="display: none;"
					data-show="$_filePickerOpen"
				>
					<div id="file-picker-results" aria-live="polite" />
				</div>
			</div>
			{renderPromptQueue(state)}
			<div
				id="prompt-attachments"
				class="prompt-attachments"
				data-style:filter="$_promptSubmitting ? 'brightness(0.75)' : ''"
				aria-label="Attachments"
				data-attr:inert="$_promptSubmitting"
				data-attr:aria-busy="$_promptSubmitting ? 'true' : 'false'"
				data-ignore-morph
				hidden
			/>
			<div
				class="input-group raised-surface prompt-surface"
				data-orientation="vertical"
			>
				<div class="prompt-shortcut-hint">
					<ShortcutKbd shortcut="alt P" />
				</div>
				{renderExtensionWidgets(state, "aboveEditor")}
				<textarea
					id="prompt-input"
					class="prompt-input"
					placeholder="Ask pi anything..."
					aria-label="Message"
					aria-keyshortcuts="Alt+P"
					rows="1"
					data-bind:prompt
					attrs={{
						"data-on:input__debounce.150ms": `@post('${endpoints.extensionUiEditor}', { payload: { prompt: $prompt } })`,
						"data-on:keydown__window": altShortcutAction(
							"KeyP",
							`el.focus({ preventScroll: true });
							el.selectionStart = el.value.length;
							el.selectionEnd = el.value.length;`,
						),
					}}
					data-on:input="
						window.piUi.promptHistory.handleInput();
						$_slashPickerOpen = $prompt.startsWith('/') &&
						!$prompt.includes(' ');
					"
					data-on:pi-ui-picker-close="$_slashPickerOpen = false"
					data-on:pi-ui-file-query={`
						if (typeof $_fileSearchController?.abort === 'function') {
							$_fileSearchController.abort();
						}
						$_fileSearchController = new AbortController();
						$fileQuery = evt.detail.query;
						@get('${endpoints.filesSearch}', {
						payload: { fileQuery: $fileQuery },
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
							!$_isBusy &&
							!window.piUi.pickers.isOpen()
						) {
							evt.preventDefault();
							el.blur();
						}
						if (evt.altKey && evt.code === 'ArrowUp') {
							evt.preventDefault();
							@post('${endpoints.promptDequeue}', { payload: {} });
						}
						if (
							evt.key === 'Enter' &&
							!evt.shiftKey &&
							!evt.isComposing &&
							window.piUi.fileTransfer.canSubmit($prompt) &&
							!window.piUi.pickers.isOpen()
						) {
							evt.preventDefault();
							window.piUi.messageScroll.scrollBottom();
							const submittedPrompt = $prompt;
							$_promptSubmitting = true;
							window.piUi.prompt.clear();
							window.piUi.fileTransfer.submit(
								evt.altKey ? '${endpoints.promptFollowUp}' : '${endpoints.prompt}',
								submittedPrompt,
								evt.altKey ? 'followUp' : undefined,
							);
						};
					`}
				></textarea>
				{renderExtensionWidgets(state, "belowEditor")}
				<footer
					id="prompt-footer"
					class="prompt-footer"
					data-align="end"
					data-init="window.piUi.prompt.bindLayout()"
					data-preserve-attr="data-toolbar-compact data-context-compact"
				>
					{renderPromptToolbar(state, reviewAvailable)}
					<div id="prompt-context" class="prompt-context">
						{renderPromptStatus(state)}
						{renderWorkspacePicker(state)}
						<span class="prompt-context-divider" aria-hidden="true" />
						{renderModelPicker(state)}
						<span class="prompt-context-divider" aria-hidden="true" />
						{renderThinkingPicker(state)}
						{renderPromptAction(state)}
					</div>
				</footer>
			</div>
		</div>,
	);
}

export function renderPromptQueue(state: AppStateSnapshot): string {
	return syncHtml(
		<div id="prompt-queue" class="prompt-queue" aria-live="polite">
			{renderQueuedMessages(state)}
		</div>,
	);
}

function renderLatestButton() {
	return (
		<button
			id="messages-latest"
			type="button"
			class="btn messages-latest"
			data-variant="outline"
			data-size="icon"
			data-preserve-attr="hidden inert tabindex"
			data-on:click="window.piUi.messageScroll.scrollBottom('smooth')"
			aria-label="Jump to latest message"
			hidden
			inert
			tabindex="-1"
		>
			<Icon icon={ArrowDown} />
		</button>
	);
}

function renderQueuedMessages(state: AppStateSnapshot): string {
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
	return syncHtml(
		<section class="prompt-queue-list">
			{items.map(({ behavior, index, label, text }, itemIndex) => (
				<div class="prompt-queue-item raised-surface">
					<span
						class={[
							"prompt-queue-dot",
							label === "Steering"
								? "prompt-queue-dot-steer"
								: "prompt-queue-dot-follow-up",
						]}
						aria-hidden="true"
					/>
					<span
						class={[
							"prompt-queue-label",
							label === "Steering"
								? "warning-foreground prompt-queue-label-steer"
								: "fine-print prompt-queue-label-follow-up",
						]}
					>
						{label}
					</span>
					<span class="prompt-queue-text" safe>
						{text}
					</span>
					{itemIndex === 0 ? (
						<button
							type="button"
							class="prompt-queue-restore"
							data-on:click={`@post('${endpoints.promptDequeue}', { payload: {} })`}
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
						class="prompt-queue-remove"
						data-on:click={`@post('${endpoints.promptQueueRemove}', { payload: { queueBehavior: '${behavior}', queueIndex: ${index} } })`}
						aria-label="Remove queued message"
					>
						<Icon icon={X} />
					</button>
				</div>
			))}
		</section>,
	);
}
