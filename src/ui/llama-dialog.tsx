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
			data-on:close={`@post('${endpoints.llamaClose}', { filterSignals: { include: /^$/ } })`}
		>
			{renderLlamaDialogContent(dialog)}
		</dialog>,
	);
}

export function renderLlamaDialogContent(dialog: AppLlamaDialog | undefined): string {
	const haystacks = dialog?.models.map((model) => model.id.toLowerCase()) ?? [];
	return syncHtml(
		<div id="llama-dialog-content" class="sm:max-w-2xl">
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
								class="input w-full"
								placeholder="Search models..."
								autocomplete="off"
								autocorrect="off"
								spellcheck="false"
								data-bind:_llama-search
								data-init="$_llamaSearch = ''"
								autofocus
							/>
						</div>
					)}
					<div class="max-h-[60vh] overflow-y-auto py-1">
						{dialog.models.length === 0 ? (
							<p
								class="py-6 text-center text-sm text-muted-foreground"
								safe
							>
								{dialog.error ?? dialog.status ?? "No models found."}
							</p>
						) : (
							<>
								{dialog.models.map((model) => renderModel(model, dialog))}
								<p
									class="py-6 text-center text-sm text-muted-foreground"
									style="display: none"
									data-show={`!${JSON.stringify(haystacks)}.some((model) => model.includes($_llamaSearch.trim().toLowerCase()))`}
								>
									No models found.
								</p>
							</>
						)}
					</div>
					{dialog.progress && (
						<div class="space-y-2">
							<div class="flex justify-between gap-4 text-sm text-muted-foreground">
								<span safe>{dialog.progress.label}</span>
								{dialog.progress.ratio !== undefined && (
									<span>
										{Math.round(dialog.progress.ratio * 100)}%
									</span>
								)}
							</div>
							<div
								class="h-2 overflow-hidden rounded-full bg-muted"
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
									class="h-full bg-primary transition-[width]"
									style={`width: ${(dialog.progress.ratio ?? 0) * 100}%`}
								/>
							</div>
						</div>
					)}
					{(dialog.status || dialog.error) && dialog.models.length > 0 && (
						<p
							class={[
								"text-sm",
								dialog.error
									? "pi-error-foreground"
									: "text-muted-foreground",
							]}
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
			class="btn h-auto w-full justify-between gap-4 px-3 py-2 text-left"
			data-variant="ghost"
			disabled={busy}
			data-show={`${JSON.stringify(model.id.toLowerCase())}.includes($_llamaSearch.trim().toLowerCase())`}
			data-on:click={`
				$llamaModel = ${JSON.stringify(model.id)};
				@post('${endpoints.llamaToggle}', { filterSignals: { include: /^llamaModel$/ } });
			`}
		>
			<span class="min-w-0 truncate font-mono text-sm" safe>
				{model.id}
			</span>
			<span
				class="badge shrink-0"
				data-variant={active ? "default" : "secondary"}
				safe
			>
				{dialog.busyModel === model.id
					? active
						? "unloading"
						: "loading"
					: model.status}
			</span>
		</button>,
	);
}
