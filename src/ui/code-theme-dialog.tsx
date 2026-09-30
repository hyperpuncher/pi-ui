import {
	CODE_THEME_PREVIEW,
	codeThemesFor,
	type CodeThemeOption,
} from "../code-themes.ts";
import { getPierreThemes } from "../pierre-theme.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import { syncHtml } from "./sync-html.ts";

export function renderCodeThemeDialog(): string {
	const active = getPierreThemes();
	const themeLabels = Object.fromEntries(
		(["light", "dark"] as const).map((appearance) => [
			appearance,
			codeThemesFor(appearance).map((theme) => theme.label.toLowerCase()),
		]),
	);
	return syncHtml(
		<dialog
			id="code-theme-dialog"
			class="dialog code-theme-dialog"
			aria-labelledby="code-theme-title"
			data-signals__ifmissing={JSON.stringify({
				_codeThemeAppearance: "light",
				_codeThemeSearch: "",
				_codeThemeStatus: "",
			})}
			data-on:pi-ui-open-code-theme__window={`
				$_codeThemeAppearance = document.documentElement.classList.contains('dark')
					? 'dark'
					: 'light';
				$_codeThemeSearch = '';
				$_codeThemeStatus = '';
				if (!el.open) el.showModal();
				window.piUi.codeTheme.loadPreviews();
			`}
			data-on:pi-ui-code-theme-changed__window={`if ($_codeThemeStatus.startsWith('Applying ')) {
				$_codeThemeStatus =
					'Applied ' +
					($_codeThemeAppearance === 'dark' ? $_codeThemeDark : $_codeThemeLight);
			}`}
			data-on:datastar-fetch={`if (
				(evt.detail.type === 'error' || evt.detail.type === 'retries-failed') &&
				evt.detail.el?.matches('.code-theme-card')
			) {
				$_codeThemeStatus = 'Could not apply theme. Try again.';
			}`}
			closedby="any"
		>
			<div class="code-theme-dialog-panel">
				<header class="preference-dialog-header">
					<div class="preference-dialog-heading">
						<div>
							<h2 id="code-theme-title">Code themes</h2>
							<p class="preference-dialog-description">
								Choose light and dark syntax themes independently.
							</p>
						</div>
						<div
							class="code-theme-mode segmented-control"
							role="group"
							aria-label="Theme appearance"
						>
							{(["light", "dark"] as const).map((appearance) => (
								<button
									type="button"

									data-code-theme-mode={appearance}
									data-on:click={`$_codeThemeStatus = ''; $_codeThemeAppearance = ${JSON.stringify(appearance)}`}
									data-attr:aria-pressed={`$_codeThemeAppearance === ${JSON.stringify(appearance)} ? 'true' : 'false'`}
									aria-pressed={
										appearance === "light" ? "true" : "false"
									}
								>
									{appearance}
								</button>
							))}
						</div>
					</div>
					<input
						id="code-theme-search"
						type="search"
						class="input preference-dialog-search"
						placeholder="Search themes…"
						autocomplete="off"
						spellcheck="false"
						autofocus
						data-bind:_code-theme-search=""
						data-on:input="$_codeThemeStatus = ''"
					/>
				</header>
				<div
					id="code-theme-gallery"
					class="preference-dialog-body preference-grid"
				>
					{(["light", "dark"] as const).flatMap((appearance) =>
						codeThemesFor(appearance).map((theme) =>
							renderThemeCard(theme, active[appearance]),
						),
					)}
				</div>
				<footer class="preference-dialog-footer preference-dialog-footer-between">
					<span
						id="code-theme-status"
						role="status"
						data-text={`$_codeThemeStatus || ($_codeThemeSearch
						? ${JSON.stringify(themeLabels)}[$_codeThemeAppearance]
						.filter((label) => label.includes($_codeThemeSearch.trim().toLocaleLowerCase())).length + ' matching themes'
						: ${JSON.stringify(themeLabels)}[$_codeThemeAppearance].length + ' ' + $_codeThemeAppearance + ' themes')`}
					>
						Choose a light theme
					</span>
					<button
						type="button"
						class="btn"
						data-variant="outline"
						commandfor="code-theme-dialog"
						command="close"
					>
						Done
					</button>
				</footer>
			</div>
		</dialog>,
	);
}

function renderThemeCard(theme: CodeThemeOption, active: string): string {
	return syncHtml(
		<button
			type="button"
			class="code-theme-card"
			data-theme-name={theme.name}
			data-theme-label={theme.label.toLowerCase()}
			data-theme-appearance={theme.appearance}
			data-show={`
				$_codeThemeAppearance === ${JSON.stringify(theme.appearance)} &&
				(
					!$_codeThemeSearch.trim() ||
					${JSON.stringify(theme.label.toLowerCase())}.includes(
						$_codeThemeSearch.trim().toLocaleLowerCase()
					)
				)
			`}
			data-indicator:_code-theme-saving
			data-attr:disabled="$_codeThemeSaving"
			data-on:click={`
				$_codeThemeStatus = ${JSON.stringify(`Applying ${theme.label}…`)};
				@post('${endpoints.codeTheme}', { payload: { codeThemeAppearance: ${JSON.stringify(theme.appearance)}, codeThemeName: ${JSON.stringify(theme.name)} } });
			`}
			data-attr:aria-pressed={`${theme.appearance === "light" ? "$_codeThemeLight" : "$_codeThemeDark"} === ${JSON.stringify(theme.name)}
			? 'true'
			: 'false'`}
			aria-pressed={theme.name === active ? "true" : "false"}
		>
			<pre class="code-theme-preview">
				<code safe>{CODE_THEME_PREVIEW}</code>
			</pre>
			<span class="code-theme-meta">
				<strong class="code-theme-name">{theme.label}</strong>
			</span>
		</button>,
	);
}
