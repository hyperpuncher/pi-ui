import { expect, test } from "bun:test";

import { findViewportHeightUnit } from "#src/agent/html-extension.ts";

test("viewport height units in styles are reported", () => {
	expect(findViewportHeightUnit("<style>.chart { height: 60vh; }</style>")).toBe(
		"60vh",
	);
	expect(findViewportHeightUnit('<div style="min-height: 50dvh"></div>')).toBe("50dvh");
	expect(findViewportHeightUnit("<div style='height:.5vh'></div>")).toBe(".5vh");
	expect(findViewportHeightUnit("<div style=height:40svh></div>")).toBe("40svh");
});

test("sizes that are not viewport heights pass", () => {
	expect(
		findViewportHeightUnit("<style>.x { height: 240px; }</style>"),
	).toBeUndefined();
	expect(
		findViewportHeightUnit("<!-- <style>.x { height: 60vh; }</style> -->"),
	).toBeUndefined();
	expect(
		findViewportHeightUnit('<img src="data:image/png;base64,60vh" alt="">'),
	).toBeUndefined();
	expect(findViewportHeightUnit('<p data-size="60vh">x</p>')).toBeUndefined();
	expect(findViewportHeightUnit("<p>60vh</p>")).toBeUndefined();
});
