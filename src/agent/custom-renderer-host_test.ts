import { test } from "bun:test";

import type { Component } from "@earendil-works/pi-tui";

import { assertEquals } from "#testing/assertions";

import { CustomRendererHost } from "./custom-renderer-host.ts";

const options = { width: 40, colorScheme: "dark" as const, expanded: true };

function fakeComponent(lines: string[], calls: { count: number }): Component {
	return {
		render: () => {
			calls.count += 1;
			return lines;
		},
		invalidate: () => {},
	};
}

test("renders a Component's lines through the ANSI→HTML pipeline", () => {
	const host = new CustomRendererHost();
	const outcome = host.render("id-1", options, () =>
		fakeComponent(["\x1b[31mred\x1b[0m plain"], { count: 0 }),
	);
	assertEquals(outcome, {
		ok: true,
		lines: ['<span style="color:var(--status-error)">red</span> plain'],
	});
});

test("a missing renderer (produce returns undefined) yields undefined", () => {
	const host = new CustomRendererHost();
	const outcome = host.render("id-1", options, () => undefined);
	assertEquals(outcome, undefined);
});

test("produce() throwing yields an {ok:false} outcome instead of propagating", () => {
	const host = new CustomRendererHost();
	const outcome = host.render("id-1", options, () => {
		throw new Error("factory failed");
	});
	assertEquals(outcome, { ok: false, error: "factory failed" });
});

test("Component.render() throwing yields an {ok:false} outcome instead of propagating", () => {
	const host = new CustomRendererHost();
	const outcome = host.render("id-1", options, () => ({
		render: () => {
			throw new Error("render failed");
		},
		invalidate: () => {},
	}));
	assertEquals(outcome, { ok: false, error: "render failed" });
});

test("repeat calls with the same id and inputs hit the cache (produce runs once)", () => {
	const host = new CustomRendererHost();
	const calls = { count: 0 };
	const produce = () => fakeComponent(["line"], calls);
	host.render("id-1", options, produce);
	host.render("id-1", options, produce);
	host.render("id-1", options, produce);
	assertEquals(calls.count, 1);
});

test("a different width, color scheme, or expanded state is a cache miss", () => {
	const host = new CustomRendererHost();
	const calls = { count: 0 };
	const produce = () => fakeComponent(["line"], calls);
	host.render("id-1", options, produce);
	host.render("id-1", { ...options, width: 80 }, produce);
	host.render("id-1", { ...options, colorScheme: "light" }, produce);
	host.render("id-1", { ...options, expanded: false }, produce);
	assertEquals(calls.count, 4);
});

test("clear() drops every cached entry", () => {
	const host = new CustomRendererHost();
	const calls = { count: 0 };
	const produce = () => fakeComponent(["line"], calls);
	host.render("id-1", options, produce);
	host.clear();
	host.render("id-1", options, produce);
	assertEquals(calls.count, 2);
});

test("dispose() is called on the rendered component, even after render() throws", () => {
	const host = new CustomRendererHost();
	let disposed = false;
	host.render("id-1", options, () => ({
		render: () => {
			throw new Error("boom");
		},
		invalidate: () => {},
		dispose: () => {
			disposed = true;
		},
	}));
	assertEquals(disposed, true);
});

test("a dispose() failure never propagates out of render()", () => {
	const host = new CustomRendererHost();
	const outcome = host.render("id-1", options, () => ({
		render: () => ["line"],
		invalidate: () => {},
		dispose: () => {
			throw new Error("dispose boom");
		},
	}));
	assertEquals(outcome, { ok: true, lines: ["line"] });
});

test("evicts the oldest entry once the cache exceeds its bound", () => {
	const host = new CustomRendererHost();
	const calls = { count: 0 };
	// One past `maxCacheEntries` (400) forces the very first key out.
	for (let index = 0; index <= 400; index += 1) {
		host.render(`id-${index}`, options, () =>
			fakeComponent([`line-${index}`], calls),
		);
	}
	calls.count = 0;
	host.render("id-0", options, () => fakeComponent(["line-0-again"], calls));
	assertEquals(calls.count, 1);
});
