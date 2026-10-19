import { endpoints } from "#src/server/routes/endpoints.ts";
import type { AppStateSnapshot } from "#src/state/app-store.ts";
import { Icon } from "#src/ui/icon.tsx";
import { syncHtml } from "#src/ui/sync-html.ts";

const themes = {
	system: { label: "System", icon: "monitor" },
	light: { label: "Light", icon: "sun" },
	dark: { label: "Dark", icon: "moon" },
} as const;

export function renderThemeDialog(theme: AppStateSnapshot["theme"]): string {
	return syncHtml(
		<dialog
			id="theme-dialog"
			class="command-dialog theme-dialog"
			aria-labelledby="theme-title"
			closedby="any"
			data-signals:_theme-status__ifmissing="''"
			data-on:toggle="if (evt.newState === 'open') $_themeStatus = '';"
			data-on:datastar-fetch={`if (
				(evt.detail.type === 'error' || evt.detail.type === 'retries-failed') &&
				el.contains(evt.detail.el)
			)
				$_themeStatus = 'Could not save theme. Try again.';`}
		>
			<div class="command">
				<div role="group" aria-labelledby="theme-title">
					<span id="theme-title" class="command-group-label">
						Theme
					</span>
					{Object.entries(themes).map(([mode, { label, icon }]) => (
						<button
							type="button"
							class="command-choice"
							aria-pressed={theme === mode ? "true" : "false"}
							data-attr:aria-pressed={`$_theme === '${mode}' ? 'true' : 'false'`}
							data-indicator:_theme-saving
							data-attr:disabled="$_themeSaving"
							data-on:click={`
								$_themeStatus = '';
								@post('${endpoints.theme}', { payload: { theme: '${mode}' }, retryMaxCount: 0 })
							`}
						>
							<Icon name={icon} />
							{label}
							<span
								class="selection-dot"
								aria-hidden="true"
								hidden={theme !== mode}
								data-attr:hidden={`$_theme !== '${mode}'`}
							/>
						</button>
					))}
					<p
						class="command-group-label"
						role="status"
						data-text="$_themeStatus"
						hidden
						data-attr:hidden="!$_themeStatus"
					></p>
				</div>
			</div>
		</dialog>,
	);
}
