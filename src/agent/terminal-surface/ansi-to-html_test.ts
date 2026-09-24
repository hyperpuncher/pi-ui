import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { assertStringExcludes } from "../../testing/assertions.ts";
import { ansiLineToHtml, cursorMarker } from "./ansi-to-html.ts";

test("plain text is HTML-escaped with no styling", () => {
	const { html, cursorColumn } = ansiLineToHtml("<b>hi & bye</b>");
	assertEquals(html, "&lt;b&gt;hi &amp; bye&lt;/b&gt;");
	assertEquals(cursorColumn, undefined);
});

test("basic SGR colors map onto pi-ui tokens, not raw xterm hues", () => {
	const { html } = ansiLineToHtml("\x1b[31mred\x1b[0m plain");
	assertStringExcludes(html, "\x1b");
	assertEquals(html, '<span style="color:var(--status-error)">red</span> plain');
});

test("bold/italic/underline/inverse/strikethrough attributes compose", () => {
	const { html } = ansiLineToHtml("\x1b[1;3;4;9mstyled\x1b[0m");
	assertEquals(
		html,
		'<span style="font-weight:600;font-style:italic;text-decoration:underline line-through">styled</span>',
	);
});

test("inverse swaps foreground and background", () => {
	const { html } = ansiLineToHtml("\x1b[31;7minverted\x1b[0m");
	assertEquals(
		html,
		'<span style="color:var(--surface-base);background-color:var(--status-error)">inverted</span>',
	);
});

test("256-color and truecolor SGR render literal rgb()", () => {
	const palette = ansiLineToHtml("\x1b[38;5;196mpalette\x1b[0m");
	assertEquals(palette.html, '<span style="color:rgb(255 0 0)">palette</span>');
	const truecolor = ansiLineToHtml("\x1b[38;2;10;20;30mtrue\x1b[0m");
	assertEquals(truecolor.html, '<span style="color:rgb(10 20 30)">true</span>');
});

test("the CURSOR_MARKER is stripped and its column reported", () => {
	const { html, cursorColumn } = ansiLineToHtml(`ab${cursorMarker}cd`);
	assertEquals(html, "abcd");
	assertEquals(cursorColumn, 2);
});

test("the cursor column accounts for preceding SGR codes and styled text", () => {
	const { cursorColumn } = ansiLineToHtml(`\x1b[31mred\x1b[0m ${cursorMarker}x`);
	// "red " is 4 visible characters before the marker.
	assertEquals(cursorColumn, 4);
});

test("an https OSC 8 hyperlink renders as a safe anchor", () => {
	const { html } = ansiLineToHtml(
		"\x1b]8;;https://example.com\x07link text\x1b]8;;\x07",
	);
	assertEquals(
		html,
		'<a href="https://example.com" target="_blank" rel="noreferrer">link text</a>',
	);
});

test("an unsafe OSC 8 scheme is dropped, leaving the text unlinked", () => {
	const { html } = ansiLineToHtml("\x1b]8;;javascript:alert(1)\x07click\x1b]8;;\x07");
	assertEquals(html, "click");
	assertStringExcludes(html, "javascript:");
});

test("unrecognized CSI sequences (cursor movement, erase) are dropped, not leaked", () => {
	const { html } = ansiLineToHtml("\x1b[2J\x1b[10;5Hvisible\x1b[K");
	assertEquals(html, "visible");
});

test("a bare ESC with no CSI/OSC introducer is dropped", () => {
	const { html } = ansiLineToHtml("a\x1bZb");
	assertEquals(html, "ab");
});
