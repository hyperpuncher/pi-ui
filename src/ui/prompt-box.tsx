import { activeKeybind, keybindAction, keybindAria } from "../keybinds.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { renderExtensionWidgets } from "./extension-widgets.tsx";
import { Icon } from "./icon.tsx";
import { ArrowDown, Paperclip, X } from "./icons.ts";
import { ShortcutKbd, ShortcutTooltip } from "./keyboard.tsx";
import { renderPiUiWidgets } from "./pi-ui-elements.tsx";
import { renderSlashPicker, slashPickerOpenExpression } from "./pickers.tsx";
import { renderPromptAction } from "./prompt-action.tsx";
import { renderModelPicker, renderThinkingPicker } from "./prompt-pickers.tsx";
import { renderPromptStart } from "./prompt-start.tsx";
import { renderPromptStatus } from "./prompt-status.tsx";
import { syncHtml } from "./sync-html.ts";
import { renderTerminalSurfacePersistent } from "./terminal-surface.tsx";

export function renderPromptBox(state: AppStateSnapshot): string {
	return syncHtml(
		<div
			id="prompt-box"
			class="prompt-box"
			data-signals__ifmissing={JSON.stringify({
				prompt: state.promptEditorText,
				_filePickerOpen: false,
				_fileSearchController: "",
				_argumentPickerOpen: false,
				_argumentSearchController: "",
				_slashPickerOpen: false,
				_promptSubmitting: false,
				fileQuery: "",
			})}
			data-on:pointerdown__outside="window.piUi.pickers.close()"
			data-effect="
				$_filePickerOpen;
				$_argumentPickerOpen;
				$_slashPickerOpen;
				$prompt;
				window.piUi.pickers.sync(true);
			"
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
				<div
					id="prompt-argument-popover"
					class="prompt-picker-popover"
					style="display: none;"
					data-show="$_argumentPickerOpen"
				>
					<div id="argument-picker-results" aria-live="polite" />
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
				data-prompt-initial
				data-init="el.removeAttribute('data-prompt-initial')"
			>
				{renderExtensionWidgets(state, "aboveEditor")}
				{renderPiUiWidgets(state)}
				{renderTerminalSurfacePersistent(state, "aboveEditor")}
				<div class="prompt-editor-row">
					<textarea
						id="prompt-input"
						class="prompt-input"
						placeholder={
							state.isTemporarySession
								? "Temporary chat"
								: "Ask pi anything..."
						}
						data-attr:placeholder="$_temporarySession ? 'Temporary chat' : 'Ask pi anything...'"
						aria-label="Message"
						aria-autocomplete="list"
						aria-haspopup="listbox"
						data-preserve-attr="aria-controls aria-activedescendant"
						aria-keyshortcuts={keybindAria("focus-prompt")}
						rows="1"
						data-bind:prompt
						attrs={{
							"data-on:input__debounce.150ms": `@post('${endpoints.extensionUiEditor}', { payload: { prompt: $prompt } })`,
							"data-on:pi-ui-file-query__debounce.20ms": `
								if (typeof evt.detail?.query === 'string') {
									$_fileSearchController?.abort?.();
									$_fileSearchController = new AbortController();
									$fileQuery = evt.detail.query;
									@get('${endpoints.filesSearch}', {
										payload: { fileQuery: $fileQuery },
										requestCancellation: $_fileSearchController,
									});
								}
							`,
							// Aborting the previous controller before creating a fresh one (rather
							// than passing requestCancellation: "auto", which only dedupes by
							// method+URL) guarantees a slower, older completions response can
							// never land after — and overwrite — a newer one: its fetch is
							// cancelled synchronously, in this same handler, before the next
							// request is ever issued. See argument-completions.ts for the
							// matching result-count cap (the other half of the stale/unbounded
							// completions gap).
							"data-on:pi-ui-argument-query__debounce.20ms": `
								if (typeof evt.detail?.command === 'string') {
									$_argumentSearchController?.abort?.();
									$_argumentSearchController = new AbortController();
									@get('${endpoints.commandArgumentCompletions}', {
										payload: {
											argumentCommand: evt.detail.command,
											argumentPrefix: evt.detail.prefix,
										},
										requestCancellation: $_argumentSearchController,
									});
								}
							`,
							"data-on:keydown__window": keybindAction(
								"focus-prompt",
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
						data-on:pi-ui-file-close={`
							$_fileSearchController?.abort?.();
							$_fileSearchController = '';
							$_filePickerOpen = false;
						`}
						data-on:pi-ui-argument-close={`
							$_argumentSearchController?.abort?.();
							$_argumentSearchController = '';
							$_argumentPickerOpen = false;
						`}
						data-effect={`if (
							$_sessionTransitionStatus !== 'loading' &&
							!window.matchMedia('(pointer: coarse)').matches
						) {
							el.focus({ preventScroll: true });
							el.selectionStart = el.value.length;
							el.selectionEnd = el.value.length;
						}`}
						data-on:paste={`if (window.piUi.fileTransfer.hasFiles(evt.clipboardData)) {
							evt.preventDefault();
							window.piUi.fileTransfer.insert(evt.clipboardData);
						}`}
						data-on:keydown={`
							if (!window.piUi.extensionKeys.takesPromptKey(evt)) {
								window.piUi.promptHistory.handleKeydown(evt, $_promptHistory);
							}
							if (
							evt.code === 'Escape' &&
							!evt.ctrlKey &&
							!evt.metaKey &&
							!evt.altKey &&
							!evt.shiftKey &&
							!window.piUi.pickers.isOpen() &&
							document.querySelector('[data-send-trigger]') &&
							!window.piUi.extensionKeys.promptLevelInputActive()
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
							!window.piUi.extensionKeys.promptInputBusy() &&
							window.piUi.fileTransfer.canSubmit($prompt) &&
							!window.piUi.pickers.isOpen()
						) {
							evt.preventDefault();
							if ($prompt.trim() === '/copy') {
								window.piUi.prompt.clear();
								// Only the browser can reach the clipboard; when there is
								// nothing to copy, fall through to the server so it can
								// show a notice instead of silently doing nothing.
								if (!window.piUi.pickers.copyLastMessage()) {
									@post('${endpoints.prompt}', { payload: { prompt: '/copy' } });
								}
								return;
							}
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
					<div class="prompt-editor-actions">
						<div class="prompt-shortcut-hint">
							<ShortcutKbd shortcut={activeKeybind("focus-prompt")} />
						</div>
						<button
							type="button"
							class="btn prompt-file-button"
							data-variant="ghost"
							data-size="icon"
							data-on:click="window.piUi.fileTransfer.pick()"
							data-tooltip="Files"
							data-tooltip-delay
							data-align="center"
							aria-label="Files"
						>
							<Icon icon={Paperclip} />
							<ShortcutTooltip label="Files" shortcut="@" />
						</button>
						{renderPromptAction(state)}
					</div>
				</div>
				{renderExtensionWidgets(state, "belowEditor")}
				{renderTerminalSurfacePersistent(state, "belowEditor")}
			</div>
			<footer id="prompt-footer" class="raised-surface prompt-footer">
				{renderPromptStart(state)}
				{renderPromptStatus(state)}
				<div id="prompt-context" class="prompt-context">
					{renderModelPicker(state)}
					{renderThinkingPicker(state)}
				</div>
			</footer>
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
