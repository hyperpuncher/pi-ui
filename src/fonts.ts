import { isRecord, isString } from "./utils/type-guards.ts";

export type FontKind = "sans" | "mono";

export type FontPreferences = Readonly<{
	mono: string;
	sans: string;
}>;

const SYSTEM_FONT = "system";

export const FONT_OPTIONS = {
	mono: [
		SYSTEM_FONT,
		"Atkinson Hyperlegible Mono",
		"Cascadia Code",
		"Commit Mono",
		"Fira Code",
		"Geist Mono",
		"IBM Plex Mono",
		"Intel One Mono",
		"Iosevka",
		"JetBrains Mono",
		"Maple Mono",
		"Martian Mono",
		"Monaspace Neon",
		"Roboto Mono",
		"Source Code Pro",
		"Space Mono",
		"Ubuntu Mono",
		"Victor Mono",
	],
	sans: [
		SYSTEM_FONT,
		"Atkinson Hyperlegible Next",
		"Geist",
		"IBM Plex Sans",
		"Inter",
		"Manrope",
		"Source Sans 3",
	],
} as const satisfies Readonly<Record<FontKind, readonly string[]>>;

const DEFAULT_FONTS = {
	mono: SYSTEM_FONT,
	sans: SYSTEM_FONT,
} satisfies FontPreferences;
let activeFonts = DEFAULT_FONTS;

export function defaultFonts(): FontPreferences {
	return { ...DEFAULT_FONTS };
}

export function findFontOption<Value>(kind: FontKind, value: Value): string | undefined {
	return isString(value)
		? FONT_OPTIONS[kind].find((font) => font === value)
		: undefined;
}

export function fontLabel(kind: FontKind, font: string): string {
	if (font !== SYSTEM_FONT) return font;
	return kind === "mono" ? "System mono" : "System";
}

export function validFonts<Value>(value: Value): FontPreferences | undefined {
	if (!isRecord(value)) return undefined;
	const mono = findFontOption("mono", value.mono);
	const sans = findFontOption("sans", value.sans);
	return mono && sans ? { mono, sans } : undefined;
}

export function getActiveFonts(): FontPreferences {
	return activeFonts;
}

export function setActiveFonts(fonts: FontPreferences): void {
	activeFonts = { mono: fonts.mono, sans: fonts.sans };
}

export function activeFontStacks() {
	return {
		mono: fontStack("mono", activeFonts.mono),
		sans: fontStack("sans", activeFonts.sans),
	};
}

export function fontStack(kind: FontKind, name: string): string {
	const fallback =
		kind === "mono"
			? 'ui-monospace, "SF Mono", "Cascadia Mono", monospace'
			: "ui-sans-serif, system-ui, sans-serif";
	return name === SYSTEM_FONT ? fallback : `${quoteFontName(name)}, ${fallback}`;
}

function quoteFontName(name: string): string {
	return `"${name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
