import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { ansiLineToHtml } from "./ansi-to-html.ts";
import { resolveTerminalTheme, resolveTranscriptTheme } from "./theme.ts";

test("transcript renders drop the custom-message box tint and keep default body text", () => {
	const theme = resolveTranscriptTheme("dark");
	const boxed = theme.bg("customMessageBg", theme.fg("customMessageText", "body"));
	const html = ansiLineToHtml(boxed).html;
	// No background and no foreground color: the card's own surface and text color show.
	assertEquals(html.includes("background"), false);
	assertEquals(html.includes("color:"), false);
	assertEquals(html.includes("body"), true);
	// The label keeps the accent color.
	const label = ansiLineToHtml(theme.fg("customMessageLabel", "memory")).html;
	assertEquals(label.includes("var(--status-info)"), true);
});

test("transcript themes are cached per scheme and separate from overlay themes", () => {
	assertEquals(resolveTranscriptTheme("light"), resolveTranscriptTheme("light"));
	const overlay = resolveTerminalTheme("dark");
	// Overlays keep the SDK-conventional custom-message background.
	assertEquals(overlay.getBgAnsi("customMessageBg"), "\u001b[48;5;6m");
	assertEquals(
		resolveTranscriptTheme("dark").getBgAnsi("customMessageBg"),
		"\u001b[49m",
	);
});
