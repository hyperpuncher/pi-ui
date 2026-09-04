import { test } from "bun:test";

import { assertFalse, assertStringIncludes } from "#testing/assertions";

import { renderSessionSidebar } from "./session-sidebar.tsx";
import { appRenderSnapshot } from "./test-fixtures.ts";

test("session sidebar keeps loading visible beneath partial results", () => {
	const html = renderSessionSidebar(
		appRenderSnapshot({
			sessions: [
				{
					path: "/sessions/partial.jsonl",
					cwd: "/workspace",
					title: "Partial session",
					subtitle: "1 message",
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

test("session sidebar groups sessions while preserving times and shortcuts", () => {
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
					subtitle: "1 message",
					modified: "12:00",
					modifiedAt: today.toISOString(),
				},
				{
					path: "/sessions/yesterday.jsonl",
					cwd: "/workspace",
					title: "Yesterday session",
					subtitle: "1 message",
					modified: "yesterday",
					modifiedAt: yesterday.toISOString(),
				},
				{
					path: "/sessions/earlier.jsonl",
					cwd: "/workspace",
					title: "Earlier session",
					subtitle: "1 message",
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
	assertStringIncludes(html, "evt.code === 'Digit3'");
});

test("session sidebar initially renders 30 sessions and an infinite-scroll trigger", () => {
	const html = renderSessionSidebar(
		appRenderSnapshot({
			sessions: Array.from({ length: 30 }, (_, index) => ({
				path: `/sessions/${index + 1}.jsonl`,
				cwd: "/workspace",
				title: `Session ${index + 1}`,
				subtitle: "1 message",
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
				subtitle: "1 message",
				modified: "Today",
			})),
			currentSessionPath: undefined,
			activityText: undefined,
			sessionCatalogLoading: false,
		}),
	);

	assertStringIncludes(html, "evt.code === 'Digit1'");
	assertStringIncludes(html, "evt.code === 'Digit9'");
	assertStringIncludes(html, ">1</kbd>");
	assertStringIncludes(html, ">9</kbd>");
	assertFalse(html.includes("Digit10"));
});
