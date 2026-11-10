import { endpoints } from "#src/server/routes/endpoints.ts";
import type { AppAuthDialog, AppAuthProvider } from "#src/state/app-store.ts";
import { syncHtml } from "#src/ui/sync-html.ts";

export function renderAuthDialog(dialog: AppAuthDialog | undefined): string {
	return syncHtml(
		<dialog
			id="auth-dialog"
			class="dialog"
			aria-labelledby="auth-dialog-title"
			closedby="any"
			data-preserve-attr="open"
			data-init={
				dialog ? "if (!el.open) el.showModal()" : "if (el.open) el.close()"
			}
			data-on:close={
				dialog && `if (!el.open) @post('${endpoints.authClose}', { payload: {} })`
			}
			data-signals__ifmissing={JSON.stringify({
				_authSearch: "",
				_authInput: "",
			})}
		>
			<div
				id="auth-dialog-content"
				class="dialog-wide"
				data-init={!dialog?.prompt && "$_authInput = ''"}
			>
				{dialog && renderDialogContent(dialog)}
			</div>
		</dialog>,
	);
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
	const providerHaystacks = dialog.providers.map(providerSearchHaystack);
	return syncHtml(
		<>
			<header>
				<h2 id="auth-dialog-title">{title}</h2>
				<p>
					{dialog.mode === "login"
						? "Choose a provider and authentication method."
						: "Remove credentials stored in ~/.pi/agent/auth.json."}
				</p>
			</header>
			{dialog.providers.length > 0 && (
				<div>
					<label class="sr-only" for="auth-provider-search">
						Search providers
					</label>
					<input
						id="auth-provider-search"
						type="search"
						class="input"
						placeholder="Search providers..."
						autocomplete="off"
						autocorrect="off"
						spellcheck="false"
						aria-controls="auth-provider-list"
						data-bind:_auth-search
						autofocus
					/>
				</div>
			)}
			<div id="auth-provider-list" class="dialog-option-list">
				{dialog.providers.length === 0 ? (
					<p class="dialog-empty" safe>
						{dialog.error ??
							dialog.status ??
							(dialog.mode === "login"
								? "No authentication providers are available."
								: "No stored credentials to remove.")}
					</p>
				) : (
					<>
						{dialog.providers.map((provider) =>
							renderProviderButton(provider, dialog.mode),
						)}
						<p
							class="dialog-empty"
							role="status"
							style="display: none"
							data-show={`!${JSON.stringify(providerHaystacks)}.some((provider) => provider.includes($_authSearch.trim().toLowerCase()))`}
						>
							No providers found.
						</p>
					</>
				)}
			</div>
			<footer>
				<button
					type="button"
					class="btn"
					data-variant="outline"
					commandfor="auth-dialog"
					command="close"
				>
					Close
				</button>
			</footer>
		</>,
	);
}

function renderProviderButton(
	provider: AppAuthProvider,
	mode: AppAuthDialog["mode"],
): string {
	const action = mode === "login" ? endpoints.authLoginStart : endpoints.authLogout;
	return syncHtml(
		<button
			type="button"
			class="btn dialog-option dialog-option-between"
			data-variant="ghost"
			data-show={`${JSON.stringify(providerSearchHaystack(provider))}.includes($_authSearch.trim().toLowerCase())`}
			data-on:click={`@post('${action}', {
			payload: { authProvider: ${JSON.stringify(provider.id)}, authType: ${JSON.stringify(provider.authType)} },
			retry: 'never',
			});`}
		>
			<span class="dialog-option-text">
				<span class="dialog-option-title" safe>
					{provider.name}
				</span>
				<span class="dialog-option-description" safe>
					{provider.id}
				</span>
			</span>
			<span class="badge" data-variant="secondary">
				{authTypeLabel(provider)}
			</span>
		</button>,
	);
}

function authTypeLabel(provider: AppAuthProvider): string {
	if (provider.authType === "api_key") return "API key";
	return provider.subscription ? "Subscription" : "Account";
}

function providerSearchHaystack(provider: AppAuthProvider): string {
	return `${provider.name} ${provider.id} ${authTypeLabel(provider)} ${provider.authType}`.toLowerCase();
}

function renderAuthenticationFlow(dialog: AppAuthDialog): string {
	const hasTextPrompt = Boolean(dialog.prompt && !dialog.prompt.options);

	return syncHtml(
		<>
			<header>
				<h2 id="auth-dialog-title" safe>
					Log in to {dialog.providerName}
				</h2>
				{dialog.status && <p safe>{dialog.status}</p>}
			</header>
			<div class="dialog-flow">
				{renderAuthenticationLink(dialog)}
				{renderDeviceCode(dialog)}
				{dialog.prompt && renderAuthenticationPrompt(dialog)}
				{dialog.progress.length > 0 && (
					<div class="dialog-progress-messages">
						{dialog.progress.map((message) => (
							<p safe>{message}</p>
						))}
					</div>
				)}
				{dialog.error && (
					<p id="auth-input-error" class="error-foreground dialog-message" safe>
						{dialog.error}
					</p>
				)}
			</div>
			<footer>
				<button
					type="button"
					class="btn"
					data-variant="outline"
					commandfor="auth-dialog"
					command="close"
				>
					Cancel
				</button>
				{hasTextPrompt && (
					<button
						type="button"
						class="btn"
						data-on:click={`@post('${endpoints.authInput}', {
							payload: { authInput: $_authInput },
							retry: 'never',
						})`}
					>
						Continue
					</button>
				)}
			</footer>
		</>,
	);
}

const copyDeviceCodeAction = `window.piUi.copyText(el.dataset.code).then((copied) => {
	$_authCopyStatus = copied ? 'Code copied.' : 'Copy the code shown above.';
});`;

function renderAuthenticationLink(dialog: AppAuthDialog): string {
	if (!dialog.url) return "";
	const copyOnLink =
		dialog.deviceCode && dialog.copyCodeOnConfirm && dialog.openBrowserOnConfirm;
	return syncHtml(
		<div class="dialog-flow-compact">
			<a
				class="dialog-link"
				href={dialog.url}
				target="_blank"
				rel="noreferrer"
				data-code={!!copyOnLink && dialog.deviceCode}
				data-on:click={!!copyOnLink && copyDeviceCodeAction}
				safe
			>
				{copyOnLink ? "Copy code and open browser" : dialog.url}
			</a>
			{dialog.instructions && (
				<p class="dialog-description" safe>
					{dialog.instructions}
				</p>
			)}
		</div>,
	);
}

function renderDeviceCode(dialog: AppAuthDialog): string {
	if (!dialog.deviceCode) return "";
	const copyOnLink = dialog.openBrowserOnConfirm && dialog.url;
	return syncHtml(
		<div class="dialog-callout" data-signals:_auth-copy-status="''">
			<p class="dialog-description">Enter this code in the browser:</p>
			<code class="dialog-device-code" safe>
				{dialog.deviceCode}
			</code>
			{dialog.copyCodeOnConfirm && !copyOnLink && (
				<button
					type="button"
					class="btn"
					data-code={dialog.deviceCode}
					data-on:click={copyDeviceCodeAction}
				>
					Copy code
				</button>
			)}
			{dialog.copyCodeOnConfirm && (
				<p
					class="dialog-description"
					role="status"
					data-text="$_authCopyStatus"
				/>
			)}
		</div>,
	);
}

function renderAuthenticationPrompt(dialog: AppAuthDialog): string {
	const prompt = dialog.prompt!;
	if (prompt.options) {
		return syncHtml(
			<div class="dialog-flow-compact">
				<p class="dialog-prompt" safe>
					{prompt.message}
				</p>
				{prompt.options.map((option) => (
					<button
						type="button"
						class="btn dialog-option"
						data-variant="outline"
						data-on:click={`@post('${endpoints.authInput}', { payload: { authInput: ${JSON.stringify(option.id)} }, retry: 'never' });`}
						safe
					>
						{option.label}
					</button>
				))}
			</div>,
		);
	}
	return syncHtml(
		<div
			id={`auth-prompt-${prompt.id}`}
			role="group"
			class="field"
			data-init="$_authInput = ''"
			data-invalid={!!dialog.error && "true"}
		>
			<label for="auth-input" safe>
				{prompt.message}
			</label>
			<input
				id="auth-input"
				type={prompt.secret ? "password" : "text"}
				autocomplete="off"
				spellcheck="false"
				placeholder={prompt.placeholder}
				aria-invalid={!!dialog.error && "true"}
				aria-describedby={!!dialog.error && "auth-input-error"}
				data-bind:_auth-input
				autofocus
				data-on:keydown={`if (evt.key === 'Enter' && !evt.isComposing) {
					evt.preventDefault();
					@post('${endpoints.authInput}', {
						payload: { authInput: $_authInput },
						retry: 'never',
					});
				}`}
			/>
		</div>,
	);
}

function renderResult(dialog: AppAuthDialog): string {
	return syncHtml(
		<>
			<header>
				<h2 id="auth-dialog-title">
					{dialog.error ? "Authentication failed" : "Authentication updated"}
				</h2>
				<p class={[dialog.error && "error-foreground"]} safe>
					{dialog.error ?? dialog.status}
				</p>
			</header>
			<footer>
				<button
					type="button"
					class="btn"
					commandfor="auth-dialog"
					command="close"
				>
					Done
				</button>
			</footer>
		</>,
	);
}
