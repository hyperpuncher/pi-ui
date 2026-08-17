import {
	codeThemesFor,
	type CodeThemeAppearance,
	type CodeThemeOption,
} from "../code-themes.ts";
import { getPierreThemes } from "../pierre-theme.ts";
import { syncHtml } from "./sync-html.ts";

export function renderCodeThemeDialog(): string {
	const active = getPierreThemes();
	return syncHtml(
		<dialog
			id="code-theme-dialog"
			class="dialog code-theme-dialog"
			aria-labelledby="code-theme-title"
			onclick="if (event.target === this) this.close()"
		>
			<div class="flex h-[min(48rem,calc(100vh-2rem))] w-[min(48rem,calc(100vw-2rem))] max-w-none flex-col overflow-hidden p-0">
				<header class="shrink-0 border-b border-border px-5 pt-5 pb-4">
					<div class="flex items-start justify-between gap-4">
						<div>
							<h2 id="code-theme-title" class="text-base font-semibold">
								Code themes
							</h2>
							<p class="mt-1 text-xs text-muted-foreground">
								Choose light and dark syntax themes independently.
							</p>
						</div>
						<div
							class="code-theme-mode flex rounded-md border border-border bg-muted p-0.5"
							role="group"
							aria-label="Theme appearance"
						>
							{(["light", "dark"] as const).map((appearance) => (
								<button
									type="button"
									class="rounded-sm px-2.5 py-1 text-xs text-muted-foreground"
									data-code-theme-mode={appearance}
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
						class="input mt-4 h-8 w-full text-xs"
						placeholder="Search themes…"
						autocomplete="off"
						spellcheck="false"
					/>
				</header>
				<div
					id="code-theme-gallery"
					class="grid min-h-0 flex-1 auto-rows-max grid-cols-2 content-start gap-2 overflow-y-auto p-5 max-sm:grid-cols-1"
				>
					{(["light", "dark"] as const).flatMap((appearance) =>
						codeThemesFor(appearance).map((theme) =>
							renderThemeCard(theme, active[appearance]),
						),
					)}
				</div>
				<footer class="flex min-h-11 shrink-0 items-center justify-between border-t border-border px-5 py-2 text-xs text-muted-foreground">
					<span id="code-theme-status" role="status">
						Choose a light theme
					</span>
					<button
						type="button"
						class="btn h-7 px-3 text-xs"
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
			class="code-theme-card relative block min-w-0 shrink-0 overflow-hidden rounded-lg border border-border bg-card text-left"
			data-theme-name={theme.name}
			data-theme-label={theme.label.toLowerCase()}
			data-theme-appearance={theme.appearance}
			aria-pressed={theme.name === active ? "true" : "false"}
			hidden={theme.appearance === "dark"}
		>
			<pre class="code-theme-preview m-0 block h-24 overflow-hidden p-3 text-[11px] leading-[1.55]">
				<code safe>{sampleCode(theme.name, theme.appearance)}</code>
			</pre>
			<span class="flex items-center justify-between gap-3 border-t border-white/8 bg-card px-3 py-2.5">
				<strong class="truncate text-xs font-semibold">{theme.label}</strong>
				<small class="shrink-0 text-[10px] text-muted-foreground">
					{theme.group}
				</small>
			</span>
		</button>,
	);
}

function sampleCode(name: string, appearance: CodeThemeAppearance): string {
	return `const theme = {\n  name: '${name}',\n  mode: '${appearance}',\n}`;
}
