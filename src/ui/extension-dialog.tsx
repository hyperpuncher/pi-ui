import { endpoints } from "../server/routes/endpoints.ts";
import type { AppExtensionDialog } from "../state/app-store.ts";
import { syncHtml } from "./sync-html.ts";

export function renderExtensionDialog(dialog: AppExtensionDialog | undefined): string {
	return syncHtml(
		<dialog
			id="extension-dialog"
			class="dialog"
			aria-labelledby="extension-dialog-title"
			onclick="if (event.target === this) this.close()"
			data-on:close={cancelCurrentAction()}
			data-signals__ifmissing={JSON.stringify({
				extensionRequestId: "",
				extensionResponse: "",
			})}
		>
			{renderExtensionDialogContent(dialog)}
		</dialog>,
	);
}

export function renderExtensionDialogContent(
	dialog: AppExtensionDialog | undefined,
): string {
	return syncHtml(
		<div id="extension-dialog-content" class="sm:max-w-lg">
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
			<div class="max-h-[60vh] space-y-1 overflow-y-auto py-1">
				{dialog.options.map((option) => (
					<button
						type="button"
						class="btn h-auto w-full justify-start px-3 py-2 text-left"
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
			{cancelFooter(dialog.id)}
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
					data-on:click={cancelAction(dialog.id)}
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
	const submit = responseAction(dialog.id, "$extensionResponse", true);
	return syncHtml(
		<>
			<header>
				<h2 id="extension-dialog-title" safe>
					{dialog.title}
				</h2>
			</header>
			<div class="field">
				<label class="sr-only" for="extension-dialog-input" safe>
					{dialog.title}
				</label>
				{dialog.kind === "editor" ? (
					<textarea
						id="extension-dialog-input"
						class="min-h-40 resize-y"
						placeholder={dialog.placeholder}
						data-bind:extension-response
						autofocus
					/>
				) : (
					<input
						id="extension-dialog-input"
						type="text"
						placeholder={dialog.placeholder}
						data-bind:extension-response
						autocomplete="off"
						data-on:keydown={`if (evt.code === 'Enter') { evt.preventDefault(); ${submit} }`}
						autofocus
					/>
				)}
			</div>
			<footer>
				<button
					type="button"
					class="btn"
					data-variant="outline"
					data-on:click={cancelAction(dialog.id)}
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

function cancelFooter(id: string): string {
	return syncHtml(
		<footer>
			<button
				type="button"
				class="btn"
				data-variant="outline"
				data-on:click={cancelAction(id)}
			>
				Cancel
			</button>
		</footer>,
	);
}

function cancelAction(id: string): string {
	return postResponse(JSON.stringify(id), "''", true);
}

function cancelCurrentAction(): string {
	return postResponse("$extensionRequestId", "''", true);
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
