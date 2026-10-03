import { test } from "bun:test";

import { renderSessionSidebar } from "#src/ui/session-sidebar.tsx";
import { assertEquals, assertFalse, assertStringIncludes } from "#testing/assertions";

import { appRenderSnapshot } from "./test-fixtures.ts";

test("session sidebar keeps loading visible beneath partial results", () => {
	const html = renderSessionSidebar(
		appRenderSnapshot({
			sessions: [
				{
					path: "/sessions/partial.jsonl",
					cwd: "/workspace",
					title: "Partial session",
					messageCount: 1,
					modified: "Now",
				},
			],
			currentSessionPath: undefined,
			activityText: undefined,
			sessionCatalogLoading: true,
		}),
	);

	assertStringIncludes(html, "Partial session");
	assertStringIncludes(html, 'aria-label="Loading"');
});

test("session sidebar puts all older dates in one disclosure while preserving times and shortcuts", () => {
	const now = new Date();
	const today = new Date(now);
	today.setHours(12, 0, 0, 0);
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	yesterday.setHours(12, 0, 0, 0);
	const earlier = new Date(now);
	earlier.setDate(now.getDate() - 8);
	earlier.setHours(12, 0, 0, 0);
	const html = renderSessionSidebar(
		appRenderSnapshot({
			sessions: [
				{
					path: "/sessions/today.jsonl",
					cwd: "/workspace",
					title: "Today session",
					messageCount: 1,
					modified: "12:00",
					modifiedAt: today.toISOString(),
				},
				{
					path: "/sessions/yesterday.jsonl",
					cwd: "/workspace",
					title: "Yesterday session",
					messageCount: 1,
					modified: "yesterday",
					modifiedAt: yesterday.toISOString(),
				},
				{
					path: "/sessions/earlier.jsonl",
					cwd: "/workspace",
					title: "Earlier session",
					messageCount: 1,
					modified: "Aug 1",
					modifiedAt: earlier.toISOString(),
				},
			],
			currentSessionPath: undefined,
			activityText: undefined,
			sessionCatalogLoading: false,
		}),
	);

	assertFalse(html.includes(">Today</span>"));
	assertStringIncludes(html, ">Yesterday</span>");
	assertFalse(html.includes(">Earlier</span>"));
	assertStringIncludes(html, ">12:00</time>");
	assertFalse(html.includes(">yesterday</time>"));
	assertFalse(html.includes(">Aug 1</time>"));
	assertStringIncludes(html, "Earlier session");
	assertEquals(html.match(/<details\b/g)?.length, 1);
	const archive = html.match(/<details[^>]*>(.*?)<\/details>/s)?.[1] ?? "";
	assertStringIncludes(archive, ">Archive</span>");
	assertStringIncludes(archive, "Earlier session");
	assertFalse(archive.includes("Today session"));
	assertFalse(archive.includes("Yesterday session"));
	assertFalse(/<details[^>]*\bopen(?:\s|=|>)/.test(html));
	assertStringIncludes(html, "evt.code === 'Digit3'");
});

test("session sidebar archive respects disabled and day threshold settings", () => {
	const session = {
		path: "/sessions/old.jsonl",
		cwd: "/workspace",
		title: "Old session",
		messageCount: 1,
		modified: "Aug 1",
		modifiedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
	};

	const disabled = renderSessionSidebar(
		appRenderSnapshot({ sessions: [session], sessionSidebarArchive: false }),
	);
	assertFalse(disabled.includes("<details"));
	assertStringIncludes(disabled, "Old session");

	const wide = renderSessionSidebar(
		appRenderSnapshot({ sessions: [session], sessionSidebarArchiveAfterDays: 9 }),
	);
	assertFalse(wide.includes("<details"));
	assertStringIncludes(wide, "Old session");
});

test("session sidebar initially renders 30 sessions and an infinite-scroll trigger", () => {
	const html = renderSessionSidebar(
		appRenderSnapshot({
			sessions: Array.from({ length: 30 }, (_, index) => ({
				path: `/sessions/${index + 1}.jsonl`,
				cwd: "/workspace",
				title: `Session ${index + 1}`,
				messageCount: 1,
				modified: "Today",
			})),
			currentSessionPath: undefined,
			activityText: undefined,
			sessionCatalogLoading: false,
			sessionsHasMore: true,
		}),
	);

	assertStringIncludes(html, "Session 30");
	assertStringIncludes(html, "@post('/sessions/more'");
});

test("session sidebar assigns shortcuts to only the first nine sessions", () => {
	const html = renderSessionSidebar(
		appRenderSnapshot({
			sessions: Array.from({ length: 10 }, (_, index) => ({
				path: `/sessions/${index + 1}.jsonl`,
				cwd: "/workspace",
				title: `Session ${index + 1}`,
				messageCount: 1,
				modified: "Today",
			})),
			currentSessionPath: undefined,
			activityText: undefined,
			sessionCatalogLoading: false,
		}),
	);

	assertStringIncludes(html, "evt.code === 'Digit1'");
	assertStringIncludes(html, "evt.code === 'Digit9'");
	// The sidebar only handles ctrl+number while no session picker is open.
	assertStringIncludes(html, "!(document.getElementById('session-dialog')?.open)");
	assertStringIncludes(html, ">1</kbd>");
	assertStringIncludes(html, ">9</kbd>");
	assertFalse(html.includes("Digit10"));
});
