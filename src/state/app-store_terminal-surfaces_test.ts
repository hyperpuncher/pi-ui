import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import type { TerminalSurface } from "../agent/terminal-surface/types.ts";
import { AppStore, type AppStorePresentation } from "./app-store.ts";

function overlay(lines: string[]): TerminalSurface {
	return {
		id: "s1",
		kind: "overlay",
		title: undefined,
		overlayOptions: { nonCapturing: true },
		belowEditor: false,
		lines,
		cursor: undefined,
		cols: 80,
		width: 80,
		rows: 24,
		revision: 1,
	};
}

test("an overlay's dialog closes while it renders nothing and reopens when it draws again", () => {
	const store = new AppStore();
	const effects: unknown[] = [];
	const presentation = new Proxy(
		{},
		{
			get: (_target, name) =>
				name === "requestCommit"
					? (effect: unknown) => {
							if (effect) effects.push(effect);
						}
					: () => {},
		},
	);
	store.attachPresentation(presentation as AppStorePresentation);

	store.setTerminalSurfaces([overlay(["panel"])]);
	store.setTerminalSurfaces([overlay([])]);
	store.setTerminalSurfaces([overlay(["panel again"])]);

	assertEquals(effects, [
		{ type: "dialog", id: "terminal-surface-s1", open: true, modal: false },
		{ type: "dialog", id: "terminal-surface-s1", open: false },
		{ type: "dialog", id: "terminal-surface-s1", open: true, modal: false },
	]);
});
