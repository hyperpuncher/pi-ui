import { Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";

export type TerminalSurfaceColorScheme = "light" | "dark";

/**
 * Maps every `Theme` semantic color to a **basic (0–15) ANSI palette index**
 * rather than a literal RGB/hex value. This is deliberate, not a
 * simplification of convenience: `ansi-to-html.ts`'s `paletteColor()`
 * already maps indices 0–15 onto pi-ui's own CSS tokens (`var(--status-
 * error)`, `var(--text)`, …) — see its `ansiBasicToken` table — while a
 * literal RGB/truecolor SGR code would render as a hardcoded color that
 * ignores pi-ui's tokens (and light/dark) entirely. Routing every extension
 * `Component` through the basic palette is what makes "map ANSI colors onto
 * pi-ui tokens, not the raw xterm palette" (Round 2 plan, "Visual
 * consistency") actually hold for arbitrary `custom()` content, not just the
 * lines this module authors directly.
 *
 * `getThemeByName`/`getAvailableThemesWithPaths`/the `theme` singleton
 * aren't part of `pi-coding-agent`'s public package export surface (only
 * `Theme`, `initTheme`, and a handful of derived-theme helpers are) — and
 * `initTheme()` mutates a process-wide singleton besides, which a multi-
 * tab, multi-session server must not do per-surface. Constructing a `Theme`
 * instance directly, once per color scheme, sidesteps both problems.
 */
const darkPalette: Record<ThemeColor, number> = {
	accent: 4,
	border: 8,
	borderAccent: 4,
	borderMuted: 8,
	success: 2,
	error: 1,
	warning: 3,
	muted: 8,
	dim: 8,
	text: 7,
	thinkingText: 8,
	scrollbarTrack: 8,
	scrollbarThumb: 7,
	searchMatchText: 0,
	userMessageText: 4,
	customMessageText: 6,
	customMessageLabel: 6,
	toolTitle: 7,
	toolOutput: 8,
	mdHeading: 4,
	mdLink: 4,
	mdLinkUrl: 8,
	mdCode: 3,
	mdCodeBlock: 8,
	mdCodeBlockBorder: 8,
	mdQuote: 8,
	mdQuoteBorder: 8,
	mdHr: 8,
	mdListBullet: 8,
	toolDiffAdded: 2,
	toolDiffRemoved: 1,
	toolDiffContext: 8,
	syntaxComment: 8,
	syntaxKeyword: 5,
	syntaxFunction: 4,
	syntaxVariable: 7,
	syntaxString: 2,
	syntaxNumber: 6,
	syntaxType: 3,
	syntaxOperator: 7,
	syntaxPunctuation: 8,
	thinkingOff: 8,
	thinkingMinimal: 3,
	thinkingLow: 3,
	thinkingMedium: 3,
	thinkingHigh: 3,
	thinkingXhigh: 3,
	thinkingMax: 3,
	bashMode: 3,
};

/**
 * Light mode reuses the same basic-palette indices: `ansiBasicToken`'s
 * tokens are theme-aware CSS custom properties (`var(--status-error)` etc.),
 * already redefined for `html.dark`/light in `tokens.css` — the index chosen
 * here only has to pick the right *semantic* color, not a literal light or
 * dark RGB value.
 */
const lightPalette: Record<ThemeColor, number> = darkPalette;

const backgroundPalette = {
	selectedBg: 4,
	searchMatchBg: 3,
	userMessageBg: 4,
	customMessageBg: 6,
	toolPendingBg: 3,
	toolSuccessBg: 2,
	toolErrorBg: 1,
};

const themeCache = new Map<TerminalSurfaceColorScheme, Theme>();

/** Resolves (and caches) the real `Theme` a terminal surface mounts extension `Component`s with. */
export function resolveTerminalTheme(scheme: TerminalSurfaceColorScheme): Theme {
	const cached = themeCache.get(scheme);
	if (cached) return cached;
	const palette = scheme === "light" ? lightPalette : darkPalette;
	const theme = new Theme(palette, backgroundPalette, "256color", {
		name: `pi-ui-${scheme}`,
	});
	themeCache.set(scheme, theme);
	return theme;
}

/**
 * The palette overrides for a `registerMessageRenderer`/`registerEntryRenderer`
 * render inside a transcript card, where pi-ui's own card already supplies the
 * surface. The SDK's conventional custom-message box paints its whole block
 * with `customMessageBg` and `customMessageText`; mapped onto the basic palette
 * (cyan has no pi-ui token), that turned every render into a striped teal
 * "success" band. Here the box background is the terminal default (none), the
 * body text is the default text color, and the label uses the accent color.
 * `""` is `Theme`'s documented "default terminal color" value.
 */
const transcriptThemeCache = new Map<TerminalSurfaceColorScheme, Theme>();

/** Resolves (and caches) the `Theme` custom message/entry renderers get in the transcript. */
export function resolveTranscriptTheme(scheme: TerminalSurfaceColorScheme): Theme {
	const cached = transcriptThemeCache.get(scheme);
	if (cached) return cached;
	const palette = scheme === "light" ? lightPalette : darkPalette;
	const theme = new Theme(
		{ ...palette, customMessageText: "", customMessageLabel: palette.accent },
		{ ...backgroundPalette, customMessageBg: "" },
		"256color",
		{ name: `pi-ui-transcript-${scheme}` },
	);
	transcriptThemeCache.set(scheme, theme);
	return theme;
}
