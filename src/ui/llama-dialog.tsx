import { endpoints } from "../server/routes/endpoints.ts";
import type { AppLlamaDialog, AppLlamaModel } from "../state/app-store.ts";
import { syncHtml } from "./sync-html.ts";

export function renderLlamaDialog(dialog: AppLlamaDialog | undefined): string {
	return syncHtml(
		<dialog
			id="llama-dialog"
			class="dialog"
			aria-labelledby="llama-dialog-title"
			onclick="if (event.target === this) this.close()"
			data-on:close={`@post('${endpoints.llamaClose}', { payload: {} })`}
			data-signals:_llama-search__ifmissing="''"
		>
			{renderLlamaDialogContent(dialog)}
		</dialog>,
	);
}

export function renderLlamaDialogContent(dialog: AppLlamaDialog | undefined): string {
	const haystacks = dialog?.models.map((model) => model.id.toLowerCase()) ?? [];
	return syncHtml(
		<div id="llama-dialog-content" class="dialog-extra-wide">
			{dialog ? (
				<>
					<header>
						<h2 id="llama-dialog-title">llama.cpp models</h2>
						<p safe>
							{dialog.serverUrl ?? "Manage models loaded by the router."}
						</p>
					</header>
					{dialog.models.length > 0 && (
						<div>
							<label class="sr-only" for="llama-model-search">
								Search models
							</label>
							<input
								id="llama-model-search"
								type="search"
								class="input"
								placeholder="Search models..."
								autocomplete="off"
								autocorrect="off"
								spellcheck="false"
								data-bind:_llama-search
								autofocus
							/>
						</div>
					)}
					<div class="dialog-option-list">
						{dialog.models.length === 0 ? (
							<p class="dialog-empty" safe>
								{dialog.error ?? dialog.status ?? "No models found."}
							</p>
						) : (
							<>
								{dialog.models.map((model) => renderModel(model, dialog))}
								<p
									class="dialog-empty"
									style="display: none"
									data-show={`!${JSON.stringify(haystacks)}.some((model) => model.includes($_llamaSearch.trim().toLowerCase()))`}
								>
									No models found.
								</p>
							</>
						)}
					</div>
					{dialog.progress && (
						<div class="dialog-flow-compact">
							<div class="dialog-progress-heading">
								<span safe>{dialog.progress.label}</span>
								{dialog.progress.ratio !== undefined && (
									<span>
										{Math.round(dialog.progress.ratio * 100)}%
									</span>
								)}
							</div>
							<div
								class="dialog-progress-track"
								role="progressbar"
								aria-label={dialog.progress.label}
								aria-valuemin="0"
								aria-valuemax="100"
								aria-valuenow={
									dialog.progress.ratio === undefined
										? undefined
										: Math.round(dialog.progress.ratio * 100)
								}
							>
								<div
									class="dialog-progress-value"
									style={`width: ${(dialog.progress.ratio ?? 0) * 100}%`}
								/>
							</div>
						</div>
					)}
					{(dialog.status || dialog.error) && dialog.models.length > 0 && (
						<p
							class={["dialog-message", dialog.error && "error-foreground"]}
							safe
						>
							{dialog.error ?? dialog.status}
						</p>
					)}
					<footer>
						<button
							type="button"
							class="btn"
							data-variant="outline"
							onclick="this.closest('dialog').close()"
						>
							Close
						</button>
					</footer>
				</>
			) : (
				<div />
			)}
		</div>,
	);
}

function renderModel(model: AppLlamaModel, dialog: AppLlamaDialog): string {
	const active = model.status === "loaded" || model.status === "sleeping";
	const busy = Boolean(dialog.busyModel);
	return syncHtml(
		<button
			type="button"
			class="btn dialog-option dialog-option-between"
			data-variant="ghost"
			disabled={busy}
			data-show={`${JSON.stringify(model.id.toLowerCase())}.includes($_llamaSearch.trim().toLowerCase())`}
			data-on:click={`@post('${endpoints.llamaToggle}', {
			payload: { llamaModel: ${JSON.stringify(model.id)} },
			})`}
		>
			<span class="dialog-model-name" safe>
				{model.id}
			</span>
			<span class="badge" data-variant={active ? "default" : "secondary"} safe>
				{dialog.busyModel === model.id
					? active
						? "unloading"
						: "loading"
					: model.status}
			</span>
		</button>,
	);
}
