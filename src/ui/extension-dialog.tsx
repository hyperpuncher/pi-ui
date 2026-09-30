import { endpoints } from "../server/routes/endpoints.ts";
import type { AppExtensionDialog } from "../state/app-store.ts";
import { syncHtml } from "./sync-html.ts";

export function renderExtensionDialog(dialog: AppExtensionDialog | undefined): string {
	return syncHtml(
		<dialog
			id="extension-dialog"
			class="dialog"
			aria-labelledby="extension-dialog-title"
			closedby="any"
			data-preserve-attr="open"
			data-effect={
				dialog ? "if (!el.open) el.showModal()" : "if (el.open) el.close()"
			}
			data-on:close={
				dialog &&
				`if (!el.open) { ${postResponse(JSON.stringify(dialog.id), "''", true)} }`
			}
			data-signals:_extension-response__ifmissing="''"
		>
			{renderExtensionDialogContent(dialog)}
		</dialog>,
	);
}

function renderExtensionDialogContent(dialog: AppExtensionDialog | undefined): string {
	return syncHtml(
		<div
			id="extension-dialog-content"
			class="dialog-wide"
			data-effect={!dialog && "$_extensionResponse = ''"}
		>
			{dialog ? renderContent(dialog) : <div />}
		</div>,
	);
}

function renderContent(dialog: AppExtensionDialog): string {
	if (dialog.kind === "select") return renderSelect(dialog);
	if (dialog.kind === "confirm") return renderConfirm(dialog);
	return renderText(dialog);
}

function renderSelect(dialog: Extract<AppExtensionDialog, { kind: "select" }>): string {
	return syncHtml(
		<>
			<header>
				<h2 id="extension-dialog-title" safe>
					{dialog.title}
				</h2>
			</header>
			<div class="dialog-option-list">
				{dialog.options.map((option) => (
					<button
						type="button"
						class="btn dialog-option"
						data-variant="ghost"
						data-on:click={responseAction(
							dialog.id,
							"el.textContent ?? ''",
							true,
						)}
						safe
					>
						{option}
					</button>
				))}
			</div>
			{cancelFooter()}
		</>,
	);
}

function renderConfirm(dialog: Extract<AppExtensionDialog, { kind: "confirm" }>): string {
	return syncHtml(
		<>
			<header>
				<h2 id="extension-dialog-title" safe>
					{dialog.title}
				</h2>
				<p safe>{dialog.message}</p>
			</header>
			<footer>
				<button
					type="button"
					class="btn"
					data-variant="outline"
					commandfor="extension-dialog"
					command="close"
				>
					Cancel
				</button>
				<button
					type="button"
					class="btn"
					data-on:click={responseAction(dialog.id, "confirm")}
					autofocus
				>
					Confirm
				</button>
			</footer>
		</>,
	);
}

function renderText(
	dialog: Extract<AppExtensionDialog, { kind: "input" | "editor" }>,
): string {
	const submit = responseAction(dialog.id, "$_extensionResponse", true);
	return syncHtml(
		<>
			<header>
				<h2 id="extension-dialog-title" safe>
					{dialog.title}
				</h2>
			</header>
			<div
				id={`extension-input-${dialog.id}`}
				class="field"
				data-prefill={dialog.prefill ?? ""}
				data-init="$_extensionResponse = el.dataset.prefill"
			>
				<label class="sr-only" for="extension-dialog-input" safe>
					{dialog.title}
				</label>
				{dialog.kind === "editor" ? (
					<textarea
						id="extension-dialog-input"
						class="dialog-editor"
						placeholder={dialog.placeholder}
						data-bind:_extension-response
						autofocus
					/>
				) : (
					<input
						id="extension-dialog-input"
						type="text"
						placeholder={dialog.placeholder}
						data-bind:_extension-response
						autocomplete="off"
						data-on:keydown={`if (evt.code === 'Enter' && !evt.isComposing) { evt.preventDefault(); ${submit} }`}
						autofocus
					/>
				)}
			</div>
			<footer>
				<button
					type="button"
					class="btn"
					data-variant="outline"
					commandfor="extension-dialog"
					command="close"
				>
					Cancel
				</button>
				<button type="button" class="btn" data-on:click={submit}>
					Continue
				</button>
			</footer>
		</>,
	);
}

function cancelFooter(): string {
	return syncHtml(
		<footer>
			<button
				type="button"
				class="btn"
				data-variant="outline"
				commandfor="extension-dialog"
				command="close"
			>
				Cancel
			</button>
		</footer>,
	);
}

function responseAction(id: string, value: string, expression = false): string {
	return postResponse(
		JSON.stringify(id),
		expression ? value : JSON.stringify(value),
		false,
	);
}

function postResponse(id: string, value: string, cancelled: boolean): string {
	return `@post('${endpoints.extensionUiResponse}', { payload: {
		extensionRequestId: ${id},
		extensionResponse: ${value},
		extensionCancelled: ${cancelled},
	} })`;
}
