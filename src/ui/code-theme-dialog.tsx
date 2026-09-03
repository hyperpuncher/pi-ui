import {
	codeThemesFor,
	type CodeThemeAppearance,
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
				codeThemeAppearance: "light",
				codeThemeSearch: "",
			})}
			data-on:pi-ui-open-code-theme__window={`
				$codeThemeAppearance = document.documentElement.classList.contains('dark')
					? 'dark'
					: 'light';
				$codeThemeSearch = '';
				if (!el.open) el.showModal();
				window.piUi.codeTheme.loadPreviews();
				requestAnimationFrame(() =>
					document.getElementById('code-theme-search')?.focus({ preventScroll: true })
				);
			`}
			data-on:pi-ui-code-theme-changed__window={`document.getElementById('code-theme-status').textContent =
				'Applied ' + ($codeThemeAppearance === 'dark' ? $_codeThemeDark : $_codeThemeLight)`}
			data-on:datastar-fetch={`if (evt.detail.type === 'error') {
				document.getElementById('code-theme-status').textContent =
					'Could not apply theme. Try again.';
			}`}
			onclick="if (event.target === this) this.close()"
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
									data-on:click={`$codeThemeAppearance = ${JSON.stringify(appearance)}`}
									data-attr:aria-pressed={`$codeThemeAppearance === ${JSON.stringify(appearance)} ? 'true' : 'false'`}
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
						data-bind:code-theme-search=""
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
						data-text={`$codeThemeSearch
						? ${JSON.stringify(themeLabels)}[$codeThemeAppearance]
						.filter((label) => label.includes($codeThemeSearch.trim().toLocaleLowerCase())).length + ' matching themes'
						: ${JSON.stringify(themeLabels)}[$codeThemeAppearance].length + ' ' + $codeThemeAppearance + ' themes'`}
					>
						Choose a light theme
					</span>
					<button
						type="button"
						class="btn"
						data-variant="outline"
						onclick="this.closest('dialog').close()"
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
				$codeThemeAppearance === ${JSON.stringify(theme.appearance)} &&
				(
					!$codeThemeSearch.trim() ||
					${JSON.stringify(theme.label.toLowerCase())}.includes(
						$codeThemeSearch.trim().toLocaleLowerCase()
					)
				)
			`}
			data-indicator:_code-theme-saving
			data-attr:disabled="$_codeThemeSaving"
			data-on:click={`
				document.getElementById('code-theme-status').textContent = ${JSON.stringify(`Applying ${theme.label}…`)};
				@post('${endpoints.codeTheme}', { payload: { codeThemeAppearance: ${JSON.stringify(theme.appearance)}, codeThemeName: ${JSON.stringify(theme.name)} } });
			`}
			data-attr:aria-pressed={`${theme.appearance === "light" ? "$_codeThemeLight" : "$_codeThemeDark"} === ${JSON.stringify(theme.name)}
			? 'true'
			: 'false'`}
			aria-pressed={theme.name === active ? "true" : "false"}
		>
			<pre class="code-theme-preview">
				<code safe>{sampleCode(theme.name, theme.appearance)}</code>
			</pre>
			<span class="code-theme-meta">
				<strong class="code-theme-name">{theme.label}</strong>
				<small class="code-theme-group">{theme.group}</small>
			</span>
		</button>,
	);
}

function sampleCode(name: string, appearance: CodeThemeAppearance): string {
	return `const theme = {\n  name: '${name}',\n  mode: '${appearance}',\n}`;
}
