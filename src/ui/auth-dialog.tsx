import type { AppAuthDialog, AppAuthProvider } from "../state/app-state.ts";

export function renderAuthDialog(dialog: AppAuthDialog | undefined): string {
	return (
		<dialog
			id="auth-dialog"
			class="dialog"
			aria-labelledby="auth-dialog-title"
			onclick="if (event.target === this) this.close()"
			data-on:close="@post('/auth/close')"
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
	if (dialog.phase === "api-key") {
		return renderApiKeyPrompt(dialog);
	}
	if (dialog.phase === "oauth") {
		return renderOAuthFlow(dialog);
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
	const action = mode === "login" ? "/auth/login/start" : "/auth/logout";
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

function renderApiKeyPrompt(dialog: AppAuthDialog): string {
	return (
		<>
			<header>
				<h2 id="auth-dialog-title" safe>
					Log in to {dialog.providerName}
				</h2>
				<p>
					The key is stored in ~/.pi/agent/auth.json with user-only permissions.
				</p>
			</header>
			<div
				role="group"
				class="field"
				data-invalid={dialog.error ? "true" : undefined}
			>
				<label for="auth-input">API key</label>
				<input
					id="auth-input"
					type="password"
					autocomplete="off"
					spellcheck="false"
					placeholder="Enter API key"
					aria-invalid={dialog.error ? "true" : undefined}
					aria-describedby={dialog.error ? "auth-input-error" : undefined}
					data-bind:auth-input
					data-on:keydown={`if (evt.key === 'Enter') {
						evt.preventDefault();
						@post('/auth/input', { filterSignals: { include: /^authInput$/ } });
					}`}
				/>
				{dialog.error && (
					<p id="auth-input-error" role="alert" safe>
						{dialog.error}
					</p>
				)}
			</div>
			<footer>
				<button
					type="button"
					class="btn"
					data-variant="outline"
					data-on:click="@post('/auth/open-login')"
				>
					Back
				</button>
				<button
					type="button"
					class="btn"
					data-on:click="@post('/auth/input', { filterSignals: { include: /^authInput$/ } })"
				>
					Save API key
				</button>
			</footer>
		</>
	) as string;
}

function renderOAuthFlow(dialog: AppAuthDialog): string {
	return (
		<>
			<header>
				<h2 id="auth-dialog-title" safe>
					Log in to {dialog.providerName}
				</h2>
				<p safe>{dialog.status || "Starting authentication…"}</p>
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
				{dialog.prompt && renderOAuthPrompt(dialog)}
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
			</footer>
		</>
	) as string;
}

function renderOAuthPrompt(dialog: AppAuthDialog): string {
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
						data-variant="ghost"
						data-on:click={`
							$authInput = ${JSON.stringify(option.id)};
							@post('/auth/input', { filterSignals: { include: /^authInput$/ } });
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
		<div class="space-y-3">
			<div role="group" class="field">
				<label for="auth-input" safe>
					{prompt.message}
				</label>
				<input
					id="auth-input"
					type="text"
					autocomplete="off"
					spellcheck="false"
					placeholder={prompt.placeholder}
					data-bind:auth-input
					data-on:keydown={`if (evt.key === 'Enter') {
						evt.preventDefault();
						@post('/auth/input', { filterSignals: { include: /^authInput$/ } });
					}`}
				/>
			</div>
			<button
				type="button"
				class="btn"
				data-on:click="@post('/auth/input', { filterSignals: { include: /^authInput$/ } })"
			>
				Continue
			</button>
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
