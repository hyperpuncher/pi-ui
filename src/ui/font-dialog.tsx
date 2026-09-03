import {
	FONT_OPTIONS,
	type FontKind,
	fontLabel,
	fontStack,
	getActiveFonts,
} from "../fonts.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import { syncHtml } from "./sync-html.ts";

const codePreview = `type User = { name: string };

const names = users.map(
  ({ name }: User) => name,
);`;

export function renderFontDialog(): string {
	const active = getActiveFonts();
	return syncHtml(
		<dialog
			id="font-dialog"
			class="dialog font-dialog"
			aria-labelledby="font-dialog-title"
			data-signals__ifmissing={JSON.stringify({
				fontKind: "sans",
				fontSearch: "",
			})}
			data-on:pi-ui-open-fonts__window={`
				$fontKind = 'sans';
				$fontSearch = '';
				if (!el.open) el.showModal();
				window.piUi.codeTheme.loadFontPreviews($_codeThemeLight, $_codeThemeDark);
				requestAnimationFrame(() =>
					document.getElementById('font-search')?.focus({ preventScroll: true })
				);
			`}
			onclick="if (event.target === this) this.close()"
		>
			<div class="font-dialog-panel">
				<header class="preference-dialog-header">
					<div class="preference-dialog-heading">
						<div>
							<h2 id="font-dialog-title">Fonts</h2>
							<p class="preference-dialog-description">
								Local fonts are preferred, with a cached web fallback.
							</p>
						</div>
						<div
							class="font-kind segmented-control"
							role="group"
							aria-label="Font use"
						>
							{(["sans", "mono"] as const).map((kind) => (
								<button
									type="button"
									data-on:click={`$fontKind = ${JSON.stringify(kind)}`}
									data-attr:aria-pressed={`$fontKind === ${JSON.stringify(kind)} ? 'true' : 'false'`}
									aria-pressed={kind === "sans" ? "true" : "false"}
								>
									{kind === "sans" ? "Interface" : "Code"}
								</button>
							))}
						</div>
					</div>
					<input
						id="font-search"
						type="search"
						class="input preference-dialog-search"
						placeholder="Search fonts…"
						aria-label="Search fonts"
						autocomplete="off"
						spellcheck="false"
						data-bind:font-search=""
					/>
				</header>
				<div class="preference-dialog-body">
					{(["sans", "mono"] as const).map((kind) => (
						<div
							class="preference-grid"
							role="radiogroup"
							aria-label={kind === "sans" ? "Interface font" : "Code font"}
							data-show={`$fontKind === ${JSON.stringify(kind)}`}
						>
							{FONT_OPTIONS[kind].map((font, index) =>
								renderFontCard(kind, font, active[kind], index),
							)}
						</div>
					))}
				</div>
				<footer class="preference-dialog-footer">
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

function renderFontCard(
	kind: FontKind,
	font: string,
	active: string,
	index: number,
): string {
	const preferenceSignal = kind === "sans" ? "_fontSans" : "_fontMono";
	const label = fontLabel(kind, font);
	const id = `font-${kind}-${index}`;
	return syncHtml(
		<label
			for={id}
			class="font-card"
			style={`font-family: ${fontStack(kind, font)}`}
			data-show={`
				!$fontSearch.trim() ||
				${JSON.stringify(label.toLowerCase())}.includes(
					$fontSearch.trim().toLocaleLowerCase()
				)
			`}
		>
			<input
				id={id}
				type="radio"
				name={`font-${kind}`}
				value={font}
				class="sr-only"
				checked={font === active}
				data-bind={preferenceSignal}
				data-on:change={`@post('${endpoints.fonts}', { payload: { fontKind: ${JSON.stringify(kind)}, fontName: ${JSON.stringify(font)} } })`}
			/>
			<strong class="font-card-title">{label}</strong>
			{kind === "mono" ? (
				<pre data-font-code-preview class="font-card-code">
					<code>{codePreview}</code>
				</pre>
			) : (
				<>
					<span class="font-card-sample">
						The quick brown fox jumps over the lazy dog.
					</span>
					<span class="font-card-glyphs">Aa Bb Cc 0123456789</span>
				</>
			)}
		</label>,
	);
}
