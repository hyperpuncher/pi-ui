import { test } from "bun:test";

import { assertFalse, assertStringIncludes } from "#testing/assertions";

import { renderSessionSidebar } from "./session-sidebar.tsx";
import { appRenderSnapshot } from "./test-fixtures.ts";

test("session sidebar exposes session state and actions", () => {
	const currentPath = "/sessions/current.jsonl";
	const html = renderSessionSidebar(
		appRenderSnapshot({
			sessions: [
				{
					path: currentPath,
					cwd: "/workspace",
					title: "Current session",
					subtitle: "3 messages",
					modified: "Now",
				},
				{
					path: "/sessions/background.jsonl",
					cwd: "/workspace",
					title: "Background session",
					subtitle: "1 message",
					modified: "Today",
					backgroundStatus: "completed",
				},
			],
			currentSessionPath: currentPath,
			activityText: "Working…",
			sessionCatalogLoading: false,
		}),
	);

	assertFalse(html.includes('data-initial-open="false"'));
	assertStringIncludes(html, 'aria-label="Sessions"');
	assertStringIncludes(html, ">workspace</span>");
	assertFalse(html.includes("3 messages"));
	assertFalse(html.includes("1 message"));
	assertStringIncludes(html, 'aria-current="true"');
	assertStringIncludes(html, 'aria-label="Current session running"');
	assertStringIncludes(html, 'aria-label="Background session completed"');
	assertStringIncludes(html, "@post('/sessions/resume'");
	assertStringIncludes(html, "@post('/sessions/rename'");
	assertStringIncludes(html, "Rename session Current session");
	assertStringIncludes(html, "Delete session Background session");
});

test("session sidebar starts closed without sessions", () => {
	const html = renderSessionSidebar(
		appRenderSnapshot({
			sessions: [],
			currentSessionPath: undefined,
			activityText: undefined,
			sessionCatalogLoading: false,
		}),
	);

	assertStringIncludes(html, 'data-initial-open="false"');
});

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
			sessions: Array.from({ length: 31 }, (_, index) => ({
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

	assertStringIncludes(html, "Session 30");
	assertFalse(html.includes("Session 31"));
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
