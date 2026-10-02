import { test } from "bun:test";
import { runInNewContext } from "node:vm";

import { renderPage } from "#src/ui/page.tsx";
import { assertEquals, assertFalse, assertStringIncludes } from "#testing/assertions";

import { appRenderSnapshot } from "./test-fixtures.ts";

function renderSidebarPage(options: { sessionSidebarOpen?: boolean } = {}): string {
	return renderPage({ ...appRenderSnapshot({}), messages: [] }, options);
}

function sidebarScriptFrom(page: string): string {
	return (
		[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].find((match) =>
			match[1]?.includes("getElementById('session-sidebar')"),
		)?.[1] ?? ""
	);
}

const html = renderSidebarPage();
const sidebarScript = sidebarScriptFrom(html);

test("one native sidebar dialog initializes before the workspace is parsed", () => {
	assertStringIncludes(html, '<dialog id="session-sidebar"');
	assertStringIncludes(html, 'closedby="any"');
	assertFalse(html.includes('aria-label="Close sessions"'));
	assertStringIncludes(html, 'commandfor="session-sidebar" command="--toggle"');
	assertEquals(html.match(/id="session-sidebar-content"/g)?.length, 1);
	assertEquals(sidebarScript.length > 0, true);
	assertEquals(
		html.indexOf(sidebarScript) < html.indexOf('id="workspace-shell"'),
		true,
	);
});

test("sidebar restores responsive preferences before datastar", () => {
	for (const [desktopOpen, mobile, expected] of [
		[true, false, "nonmodal"],
		[true, true, "closed"],
		[false, false, "closed"],
		[false, true, "closed"],
	] as const) {
		let shownAs = "closed";
		const dialog = {
			closedBy: "any",
			removeAttribute() {},
			close() {
				shownAs = "closed";
			},
			show() {
				shownAs = "nonmodal";
			},
			showModal() {
				shownAs = "modal";
			},
			querySelector() {
				return { scrollLeft: 0 };
			},
		};
		runInNewContext(
			sidebarScriptFrom(renderSidebarPage({ sessionSidebarOpen: desktopOpen })),
			{
				document: { getElementById: () => dialog },
				matchMedia: () => ({ matches: mobile }),
			},
		);
		assertEquals(shownAs, expected);
		assertEquals(dialog.closedBy, mobile ? "any" : "none");
	}
});

test("only the notification stream stays connected in a hidden tab", () => {
	assertStringIncludes(html, "@get('/notifications/stream'");
	assertEquals(html.match(/openWhenHidden: true/g)?.length, 1);
	assertEquals(
		html.match(/window\.piUi\.notifications\.requestPermission\(\)/g)?.length,
		2,
	);
});

test("workspace files expose native preview and source controls", () => {
	assertStringIncludes(html, 'id="workspace-file-mode"');
	assertStringIncludes(html, 'id="workspace-file-preview-mode"');
	assertStringIncludes(html, 'id="workspace-file-source-mode"');
	assertStringIncludes(html, 'id="workspace-file-preview"');
	assertStringIncludes(html, 'aria-label="File preview"');
});

test("configured sidebar width belongs to the layout containers, not the document", () => {
	assertEquals(
		html.match(/style="--session-sidebar-preferred-width: 288px;"/g)?.length,
		2,
	);
	const custom = renderPage(
		{ ...appRenderSnapshot({}), messages: [] },
		{ sessionSidebarWidth: 354 },
	);
	assertEquals(
		custom.match(/style="--session-sidebar-preferred-width: 354px;"/g)?.length,
		2,
	);
	assertFalse(custom.match(/<html[^>]*>/)?.[0]?.includes("session-sidebar") ?? true);
	assertFalse(custom.includes("document.documentElement.style.setProperty"));
});
