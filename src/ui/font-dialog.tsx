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
			<div class="flex h-[min(48rem,calc(100vh-2rem))] w-[min(42rem,calc(100vw-2rem))] max-w-none flex-col overflow-hidden p-0">
				<header class="shrink-0 border-b border-border px-5 pt-5 pb-4">
					<div class="flex items-start justify-between gap-4">
						<div>
							<h2 id="font-dialog-title" class="text-base font-semibold">
								Fonts
							</h2>
							<p class="mt-1 text-xs text-muted-foreground">
								Local fonts are preferred, with a cached web fallback.
							</p>
						</div>
						<div
							class="font-kind flex rounded-md border border-border bg-muted p-0.5"
							role="group"
							aria-label="Font use"
						>
							{(["sans", "mono"] as const).map((kind) => (
								<button
									type="button"
									class="rounded-sm px-3 py-1 text-xs text-muted-foreground"
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
						class="input mt-4 h-8 w-full text-xs"
						placeholder="Search fonts…"
						aria-label="Search fonts"
						autocomplete="off"
						spellcheck="false"
						data-bind:font-search=""
					/>
				</header>
				<div class="min-h-0 flex-1 overflow-y-auto p-5">
					{(["sans", "mono"] as const).map((kind) => (
						<div
							class="grid auto-rows-max grid-cols-2 content-start gap-2 max-sm:grid-cols-1"
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
				<footer class="flex min-h-11 shrink-0 items-center justify-end border-t border-border px-5 py-2">
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
			class="block min-w-0 cursor-pointer rounded-lg border border-border bg-card p-4 text-left transition-[border-color,transform] duration-150 ease-(--pi-ease-out) hover:border-foreground/35 active:scale-[0.985] has-[input:checked]:border-primary has-[input:checked]:ring-2 has-[input:checked]:ring-primary has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring motion-reduce:transition-colors active:motion-reduce:scale-100"
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
			<strong class="block truncate text-sm font-semibold">{label}</strong>
			{kind === "mono" ? (
				<pre
					data-font-code-preview
					class="m-0 mt-3 overflow-x-auto font-[inherit] text-[13px] leading-5 whitespace-pre [&_code]:font-[inherit]"
				>
					<code>{codePreview}</code>
				</pre>
			) : (
				<>
					<span class="mt-3 block text-base leading-7">
						The quick brown fox jumps over the lazy dog.
					</span>
					<span class="mt-2 block truncate text-[11px] text-muted-foreground">
						Aa Bb Cc 0123456789
					</span>
				</>
			)}
		</label>,
	);
}
