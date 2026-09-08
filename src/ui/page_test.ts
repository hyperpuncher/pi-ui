import { test } from "bun:test";
import { runInNewContext } from "node:vm";

import { assertEquals, assertFalse, assertStringIncludes } from "#testing/assertions";

import { renderPage } from "./page.tsx";
import { appRenderSnapshot } from "./test-fixtures.ts";

const html = renderPage({ ...appRenderSnapshot({}), messages: [] });
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
	(match) => match[1] ?? "",
);
const widthScript = scripts[0] ?? "";
const sidebarScript =
	scripts.find((script) => script.includes("getElementById('session-sidebar')")) ?? "";

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

for (const mobile of [false, true]) {
	for (const saved of ["true", "false", "invalid", null, undefined]) {
		test(`sidebar restores ${mobile ? "mobile" : "desktop"} preference ${String(saved)} before datastar`, () => {
			let shownAs = "closed";
			let storageKey = "";
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
			runInNewContext(sidebarScript, {
				document: { getElementById: () => dialog },
				matchMedia: () => ({ matches: mobile }),
				localStorage: {
					getItem(key: string) {
						storageKey = key;
						if (saved === undefined) throw new Error("Storage blocked");
						return saved;
					},
				},
			});
			const open = saved === "true" || (saved !== "false" && !mobile);
			assertEquals(shownAs, open ? (mobile ? "modal" : "nonmodal") : "closed");
			assertEquals(dialog.closedBy, mobile ? "any" : "none");
			assertEquals(
				storageKey,
				`pi-ui-session-sidebar-${mobile ? "mobile" : "desktop"}-open`,
			);
		});
	}
}

test("saved sidebar width is restored before styles, with invalid storage ignored", () => {
	assertEquals(widthScript.length > 0, true);
	assertEquals(html.indexOf(widthScript) < html.indexOf('rel="stylesheet"'), true);
	for (const saved of ["354", "NaN", "-1", "0", "Infinity", null]) {
		const styles = new Map<string, string>();
		runInNewContext(widthScript, {
			document: {
				documentElement: {
					dataset: {},
					style: {
						setProperty: (key: string, value: string) =>
							styles.set(key, value),
					},
				},
			},
			localStorage: {
				getItem() {
					if (saved === null) throw new Error("Storage blocked");
					return saved;
				},
			},
		});
		if (saved === "354")
			assertStringIncludes(styles.get("--session-sidebar-width") ?? "", "354px");
		else assertEquals(styles.size, 0);
	}
});
