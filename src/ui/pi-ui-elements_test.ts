import { test } from "bun:test";

import { assertStringIncludes } from "#testing/assertions";

import type { PiUiElement } from "../extension-surface-types.ts";
import { assertStringExcludes } from "../testing/assertions.ts";
import { renderPage } from "./page.tsx";
import {
	renderPiUiElement,
	renderPiUiSheets,
	renderPiUiWidgets,
} from "./pi-ui-elements.tsx";
import { appRenderSnapshot } from "./test-fixtures.ts";

function element(overrides: Partial<PiUiElement>): PiUiElement {
	return {
		id: "panel",
		ns: "ask-user",
		kind: "panel",
		placement: "sheet",
		data: {},
		revision: 1,
		openGeneration: 1,
		updatedAt: 0,
		...overrides,
	};
}

test("the page shell mounts the PIUI widget area and sheet host", () => {
	const page = renderPage({ ...appRenderSnapshot({}), messages: [] });
	assertStringIncludes(page, 'id="piui-widgets"');
	assertStringIncludes(page, 'id="piui-sheets"');
});

test("sheets keep their open state across morphs and reply close on dismiss", () => {
	const html = renderPiUiSheets({ extensionElements: [element({})] });
	assertStringIncludes(html, 'data-preserve-attr="open"');
	assertStringIncludes(html, "actionId: &#34;close&#34;");
});

test("the sheet host reports the browser's real color scheme once and on change (m9)", () => {
	const html = renderPiUiSheets({ extensionElements: [] });
	assertStringIncludes(html, "prefers-color-scheme: dark");
	assertStringIncludes(html, "/extensions/ui/color-scheme");
	assertStringIncludes(html, "mql.addEventListener");
});

test("the widget strip renders both the full list and a one-line summary, and the summary opens Live Workspace Extensions (m12)", () => {
	const widget = element({
		id: "w1",
		kind: "widget",
		placement: "pinned",
		title: "Build status",
		data: { lines: ["compiling"] },
	});
	const html = renderPiUiWidgets({ extensionElements: [widget] });
	assertStringIncludes(html, 'class="piui-widgets-list"');
	assertStringIncludes(html, 'class="btn piui-widgets-summary"');
	// A single element's summary shows its own title rather than a bare count.
	assertStringIncludes(html, "Build status");
	assertStringIncludes(html, "liveWorkspacePreferences.tab = 'extensions'");
});

test("the widget summary falls back to a count for more than one element", () => {
	const html = renderPiUiWidgets({
		extensionElements: [
			element({
				id: "w1",
				kind: "widget",
				placement: "pinned",
				data: { lines: [] },
			}),
			element({
				id: "w2",
				kind: "widget",
				placement: "inline",
				data: { lines: [] },
			}),
		],
	});
	assertStringIncludes(html, "2 extension updates");
});

test("the widget strip renders nothing (not even the summary) when there are no widgets", () => {
	const html = renderPiUiWidgets({ extensionElements: [] });
	assertStringExcludes(html, "piui-widgets-summary");
	assertStringExcludes(html, "piui-widgets-list");
});

test("a sheet with no body content shows an empty/loading state instead of blank space", () => {
	const html = renderPiUiSheets({
		extensionElements: [element({ kind: "panel", placement: "sheet", data: {} })],
	});
	assertStringIncludes(html, "piui-sheet-empty");
	assertStringIncludes(html, "Waiting for content");
});

test("a sheet with body content does not show the empty state", () => {
	const html = renderPiUiSheets({
		extensionElements: [
			element({
				kind: "panel",
				placement: "sheet",
				data: { sections: [{ kind: "status", text: "hello" }] },
			}),
		],
	});
	assertStringExcludes(html, "piui-sheet-empty");
});

test("a sheet focuses its first field or action once it opens", () => {
	const html = renderPiUiSheets({ extensionElements: [element({})] });
	assertStringIncludes(html, "addEventListener('toggle'");
	assertStringIncludes(
		html,
		"input:not([type=checkbox]), textarea, select, .piui-actions .btn",
	);
});

test("forms without a submit action get one carrying valid signal references", () => {
	const html = renderPiUiSheets({
		extensionElements: [
			element({
				data: { fields: [{ id: "selection", kind: "text", label: "Pick" }] },
			}),
		],
	});
	assertStringIncludes(html, ">Submit</button>");
	// Signal names must be identifiers (no `-` from the `ask-user` namespace) and be
	// referenced with `$` so Datastar reads the bound value.
	assertStringIncludes(html, "$_piuiField_ask_user_panel_selection");
	assertStringExcludes(html, "_piuiField_ask-user");
});

test("nested form sections render their fields and actions once", () => {
	const html = renderPiUiSheets({
		extensionElements: [
			element({
				ns: "btw",
				placement: "screen",
				actions: [{ id: "close", label: "Close" }],
				data: {
					sections: [
						{
							kind: "form",
							fields: [{ id: "q", kind: "text", label: "Ask btw" }],
							actions: [
								{ id: "submit", label: "Send", variant: "primary" },
							],
						},
					],
				},
			}),
		],
	});
	assertStringIncludes(html, "Ask btw");
	assertStringIncludes(html, ">Send</button>");
	assertStringIncludes(html, "$_piuiField_btw_panel_q");
	// The element declares its own close action, so the built-in Close button is omitted.
	assertStringExcludes(html, 'command="close"');
});

test("actions send the namespaced elementId lib/bridge.ts expects", () => {
	const html = renderPiUiSheets({ extensionElements: [element({})] });
	// `lib/bridge.ts` derives the namespace as `elementId.split(":")[0]`; a
	// bare `element.id` would misroute the namespace-scoped `piui:<ns>` event.
	assertStringIncludes(html, "elementId: &#34;ask-user:panel&#34;");
});

test("a pinned roster renders as a compact summary strip, not a full row list", () => {
	const html = renderPiUiWidgets({
		extensionElements: [
			element({
				id: "fleet",
				kind: "roster",
				placement: "pinned",
				title: "Fleet",
				data: {
					rows: [
						{ id: "s1", label: "scout", status: "running" },
						{ id: "s2", label: "writer", status: "idle" },
					],
				},
			}),
		],
	});
	assertStringIncludes(html, "piui-summary");
	assertStringIncludes(html, "2 items");
	assertStringIncludes(html, "1 running");
	assertStringIncludes(html, ">Open</button>");
	// The full per-row list belongs to the Live Workspace Extensions tab, not this strip.
	assertStringExcludes(html, "piui-roster-row");
});

test("a pinned progress element keeps its one-line bar inside the summary strip", () => {
	const html = renderPiUiWidgets({
		extensionElements: [
			element({
				id: "job",
				kind: "progress",
				placement: "pinned",
				data: { current: 3, total: 10 },
			}),
		],
	});
	assertStringIncludes(html, "piui-summary");
	assertStringIncludes(html, "piui-progress-track");
});

test("an inline widget with many lines starts collapsed", () => {
	const short = renderPiUiElement(
		element({
			id: "short",
			kind: "widget",
			placement: "inline",
			data: { lines: ["a", "b", "c"] },
		}),
	);
	assertStringExcludes(short, "<details");

	const long = renderPiUiElement(
		element({
			id: "long",
			kind: "widget",
			placement: "inline",
			data: { lines: ["a", "b", "c", "d", "e", "f", "g"] },
		}),
	);
	assertStringIncludes(long, "<details");
	assertStringIncludes(long, "7 lines");
});

test("roster rows render detail and per-row actions replying with the row id", () => {
	const html = renderPiUiElement(
		element({
			ns: "subagents",
			id: "roster",
			kind: "roster",
			placement: "pinned",
			data: {
				rows: [
					{
						id: "s1",
						label: "<b>scout</b>",
						state: "running",
						detail: "d1 · 12 tokens",
						actions: [{ id: "kill", label: "Kill", variant: "danger" }],
					},
				],
			},
		}),
	);
	assertStringIncludes(html, "d1 · 12 tokens");
	assertStringIncludes(html, 'data-variant="destructive"');
	assertStringIncludes(html, "{&#34;id&#34;:&#34;s1&#34;}");
	assertStringExcludes(html, "<b>scout</b>");
});
