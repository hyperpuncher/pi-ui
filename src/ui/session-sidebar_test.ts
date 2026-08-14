import { assertFalse, assertStringIncludes } from "@std/assert";

import { renderSessionSidebar } from "./session-sidebar.tsx";
import { appRenderSnapshot } from "./test-fixtures.ts";

Deno.test("session sidebar uses Basecoat structure and marks the current session", () => {
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

	assertStringIncludes(html, 'class="sidebar"');
	assertStringIncludes(html, 'data-side="right"');
	assertFalse(html.includes('data-initial-open="false"'));
	assertStringIncludes(html, 'aria-label="Sessions"');
	assertStringIncludes(html, "pi-raised-surface");
	assertStringIncludes(html, "pi-resize-handle");
	assertStringIncludes(
		html,
		"right: calc(var(--sidebar-width) + var(--pi-workspace-inset) - var(--pi-workspace-gap))",
	);
	assertStringIncludes(html, "absolute! inset-0 h-full! p-0!");
	assertStringIncludes(html, "flex min-w-0 flex-col gap-1 p-2");
	assertStringIncludes(html, 'class="pi-date"');
	assertStringIncludes(html, ">workspace</span>");
	assertFalse(html.includes("3 messages"));
	assertFalse(html.includes("1 message"));
	assertStringIncludes(html, 'id="session-sidebar-content"');
	assertStringIncludes(html, 'data-active="true"');
	assertStringIncludes(html, 'aria-current="true"');
	assertStringIncludes(html, 'data-background-status="running"');
	assertStringIncludes(html, 'data-background-status="completed"');
	assertStringIncludes(html, "pi-tool-status-ball");
	assertFalse(html.includes('class="badge'));
	assertStringIncludes(html, "@post('/sessions/resume'");
	assertStringIncludes(html, "evt.code === 'Digit2'");
	assertFalse(html.includes('<kbd class="kbd">1</kbd>'));
	assertStringIncludes(html, '<kbd class="kbd">2</kbd>');
	assertFalse(html.includes("pr-7"));
	assertFalse(html.includes("absolute right-2"));
	assertStringIncludes(html, "flex h-6 min-w-0 items-center gap-2");
	assertStringIncludes(html, "*:[grid-area:1/1]");
	assertStringIncludes(html, "group-hover:opacity-0");
	assertStringIncludes(html, "Delete session Background session");
	assertStringIncludes(html, "$sessionDeletePath");
});

Deno.test("session sidebar starts closed without sessions", () => {
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

Deno.test("session sidebar keeps loading visible beneath partial results", () => {
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
	assertStringIncludes(html, "animate-spin");
});

Deno.test("session sidebar groups sessions while preserving times and shortcuts", () => {
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
	assertStringIncludes(html, 'class="flex-1 border-t border-border"');
	assertStringIncludes(html, "items-center gap-2 px-2 py-1");
	assertStringIncludes(html, "text-muted-foreground lowercase");
	assertStringIncludes(html, ">12:00</time>");
	assertFalse(html.includes(">yesterday</time>"));
	assertFalse(html.includes(">Aug 1</time>"));
	assertStringIncludes(html, "Earlier session");
	assertStringIncludes(html, "evt.code === 'Digit3'");
});

Deno.test("session sidebar initially renders 30 sessions and an infinite-scroll trigger", () => {
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
	assertStringIncludes(html, "data-on-intersect__once");
	assertStringIncludes(html, "/sessions/more?limit=60");
	assertStringIncludes(html, "data-indicator:_session-page-loading");
});

Deno.test("session sidebar assigns shortcuts to only the first nine sessions", () => {
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

	for (let index = 1; index <= 9; index++) {
		assertStringIncludes(html, `evt.code === 'Digit${index}'`);
		assertStringIncludes(html, `<kbd class="kbd">${index}</kbd>`);
	}
	assertFalse(html.includes("Digit10"));
});
