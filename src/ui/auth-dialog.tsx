import { endpoints } from "../server/routes/endpoints.ts";
import type { AppAuthDialog, AppAuthProvider } from "../state/app-store.ts";

export function renderAuthDialog(dialog: AppAuthDialog | undefined): string {
	return (
		<dialog
			id="auth-dialog"
			class="dialog"
			aria-labelledby="auth-dialog-title"
			onclick="if (event.target === this) this.close()"
			data-on:close={`@post('${endpoints.authClose}', { filterSignals: { include: /^$/ } })`}
		>
			{renderAuthDialogContent(dialog)}
		</dialog>
	) as string;
}

export function renderAuthDialogContent(dialog: AppAuthDialog | undefined): string {
	return (
		<div id="auth-dialog-content" class="sm:max-w-lg">
			{dialog ? renderDialogContent(dialog) : <div />}
		</div>
	) as string;
}

function renderDialogContent(dialog: AppAuthDialog): string {
	if (dialog.phase === "providers") {
		return renderProviderPicker(dialog);
	}
	if (dialog.phase === "api-key" || dialog.phase === "oauth") {
		return renderAuthenticationFlow(dialog);
	}
	return renderResult(dialog);
}

function renderProviderPicker(dialog: AppAuthDialog): string {
	const title = dialog.mode === "login" ? "Log in" : "Log out";
	return (
		<>
			<header>
				<h2 id="auth-dialog-title" class="outline-none" tabindex="-1" autofocus>
					{title}
				</h2>
				<p>
					{dialog.mode === "login"
						? "Choose a provider and authentication method."
						: "Remove credentials stored in ~/.pi/agent/auth.json."}
				</p>
			</header>
			<div class="max-h-[60vh] overflow-y-auto py-1">
				{dialog.providers.length === 0 ? (
					<p class="text-muted-foreground py-6 text-center text-sm" safe>
						{dialog.error ??
							dialog.status ??
							(dialog.mode === "login"
								? "No authentication providers are available."
								: "No stored credentials to remove.")}
					</p>
				) : (
					dialog.providers.map((provider) =>
						renderProviderButton(provider, dialog.mode),
					)
				)}
			</div>
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
	) as string;
}

function renderProviderButton(
	provider: AppAuthProvider,
	mode: AppAuthDialog["mode"],
): string {
	const action = mode === "login" ? endpoints.authLoginStart : endpoints.authLogout;
	return (
		<button
			type="button"
			class="btn h-auto w-full justify-between gap-4 px-3 py-2 text-left"
			data-variant="ghost"
			data-on:click={`
				$authProvider = ${JSON.stringify(provider.id)};
				$authType = ${JSON.stringify(provider.authType)};
				@post('${action}', { filterSignals: { include: /^auth(Provider|Type)$/ } });
			`}
		>
			<span class="min-w-0">
				<span class="block truncate" safe>
					{provider.name}
				</span>
				<span class="text-muted-foreground block truncate font-mono text-xs" safe>
					{provider.id}
				</span>
			</span>
			<span class="badge shrink-0" data-variant="secondary">
				{provider.authType === "oauth" ? "Subscription" : "API key"}
			</span>
		</button>
	) as string;
}

function renderAuthenticationFlow(dialog: AppAuthDialog): string {
	const hasTextPrompt = Boolean(dialog.prompt && !dialog.prompt.options);
	return (
		<>
			<header>
				<h2 id="auth-dialog-title" safe>
					Log in to {dialog.providerName}
				</h2>
				{dialog.status && <p safe>{dialog.status}</p>}
			</header>
			<div class="space-y-4">
				{dialog.url && (
					<div class="space-y-2">
						<a
							class="text-primary block break-all underline"
							href={dialog.url}
							target="_blank"
							rel="noreferrer"
							safe
						>
							{dialog.url}
						</a>
						{dialog.instructions && (
							<p class="text-muted-foreground text-sm" safe>
								{dialog.instructions}
							</p>
						)}
					</div>
				)}
				{dialog.deviceCode && (
					<div class="rounded-lg border p-3">
						<p class="text-muted-foreground text-sm">
							Enter this code in the browser:
						</p>
						<code class="mt-1 block text-lg font-semibold" safe>
							{dialog.deviceCode}
						</code>
					</div>
				)}
				{dialog.prompt && renderAuthenticationPrompt(dialog)}
				{dialog.progress.length > 0 && (
					<div class="text-muted-foreground space-y-1 text-sm">
						{dialog.progress.map((message) => (
							<p safe>{message}</p>
						))}
					</div>
				)}
				{dialog.error && (
					<p class="text-destructive text-sm" safe>
						{dialog.error}
					</p>
				)}
			</div>
			<footer>
				<button
					type="button"
					class="btn"
					data-variant="outline"
					onclick="this.closest('dialog').close()"
				>
					Cancel
				</button>
				{hasTextPrompt && (
					<button
						type="button"
						class="btn"
						data-on:click={`@post('${endpoints.authInput}', { filterSignals: { include: /^authInput$/ } })`}
					>
						Continue
					</button>
				)}
			</footer>
		</>
	) as string;
}

function renderAuthenticationPrompt(dialog: AppAuthDialog): string {
	const prompt = dialog.prompt!;
	if (prompt.options) {
		return (
			<div class="space-y-2">
				<p class="text-sm font-medium" safe>
					{prompt.message}
				</p>
				{prompt.options.map((option) => (
					<button
						type="button"
						class="btn h-auto w-full justify-start px-3 py-2 text-left"
						data-variant="outline"
						data-on:click={`
							$authInput = ${JSON.stringify(option.id)};
							@post('${endpoints.authInput}', { filterSignals: { include: /^authInput$/ } });
						`}
						safe
					>
						{option.label}
					</button>
				))}
			</div>
		) as string;
	}
	return (
		<div role="group" class="field" data-invalid={dialog.error ? "true" : undefined}>
			<label for="auth-input" safe>
				{prompt.message}
			</label>
			<input
				id="auth-input"
				type={prompt.secret ? "password" : "text"}
				autocomplete="off"
				spellcheck="false"
				placeholder={prompt.placeholder}
				aria-invalid={dialog.error ? "true" : undefined}
				data-bind:auth-input
				autofocus
				data-on:keydown={`if (evt.key === 'Enter') {
					evt.preventDefault();
					@post('${endpoints.authInput}', {
						filterSignals: { include: /^authInput$/ },
					});
				}`}
			/>
		</div>
	) as string;
}

function renderResult(dialog: AppAuthDialog): string {
	return (
		<>
			<header>
				<h2 id="auth-dialog-title">
					{dialog.error ? "Authentication failed" : "Authentication updated"}
				</h2>
				<p class={dialog.error ? "text-destructive" : undefined} safe>
					{dialog.error ?? dialog.status}
				</p>
			</header>
			<footer>
				<button
					type="button"
					class="btn"
					onclick="this.closest('dialog').close()"
				>
					Done
				</button>
			</footer>
		</>
	) as string;
}
