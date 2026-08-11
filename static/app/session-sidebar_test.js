import { assertEquals } from "@std/assert";

import {
	clampSessionSidebarWidth,
	isSessionSidebarToggleShortcut,
	sessionSidebarWidthDefault,
} from "./session-sidebar.js";

Deno.test("session sidebar toggle uses the primary modifier", () => {
	const event = (overrides = {}) => ({
		code: "KeyB",
		altKey: false,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		...overrides,
	});
	assertEquals(isSessionSidebarToggleShortcut(event({ ctrlKey: true }), false), true);
	assertEquals(isSessionSidebarToggleShortcut(event({ metaKey: true }), true), true);
	assertEquals(isSessionSidebarToggleShortcut(event({ ctrlKey: true }), true), false);
	assertEquals(
		isSessionSidebarToggleShortcut(event({ ctrlKey: true, shiftKey: true }), false),
		false,
	);
});

Deno.test("session sidebar width clamps to its desktop bounds and viewport", () => {
	assertEquals(sessionSidebarWidthDefault, 288);
	assertEquals(clampSessionSidebarWidth(100, 1200), 224);
	assertEquals(clampSessionSidebarWidth(320, 1200), 320);
	assertEquals(clampSessionSidebarWidth(800, 1200), 480);
	assertEquals(clampSessionSidebarWidth(480, 700), 350);
});
