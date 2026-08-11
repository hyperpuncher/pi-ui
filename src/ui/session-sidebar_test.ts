import { assertFalse, assertStringIncludes } from "@std/assert";

import type { AppRenderSnapshot } from "../state/app-store.ts";
import { renderSessionSidebar } from "./session-sidebar.tsx";

Deno.test("session sidebar uses Basecoat structure and marks the current session", () => {
	const currentPath = "/sessions/current.jsonl";
	const html = renderSessionSidebar({
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
	} as unknown as AppRenderSnapshot);

	assertStringIncludes(html, 'class="sidebar"');
	assertStringIncludes(html, 'data-side="right"');
	assertStringIncludes(html, 'aria-label="Sessions"');
	assertStringIncludes(html, "pi-raised-surface");
	assertStringIncludes(html, "pi-resize-handle");
	assertStringIncludes(html, "absolute! inset-0 h-full! p-0!");
	assertStringIncludes(html, "flex min-w-0 flex-col gap-1 p-2");
	assertStringIncludes(html, "text-muted-foreground lowercase");
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

Deno.test("session sidebar keeps loading visible beneath partial results", () => {
	const html = renderSessionSidebar({
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
	} as unknown as AppRenderSnapshot);

	assertStringIncludes(html, "Partial session");
	assertStringIncludes(html, 'aria-label="Loading"');
	assertStringIncludes(html, "animate-spin");
});

Deno.test("session sidebar assigns shortcuts to only the first nine sessions", () => {
	const html = renderSessionSidebar({
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
	} as unknown as AppRenderSnapshot);

	for (let index = 1; index <= 9; index++) {
		assertStringIncludes(html, `evt.code === 'Digit${index}'`);
		assertStringIncludes(html, `<kbd class="kbd">${index}</kbd>`);
	}
	assertFalse(html.includes("Digit10"));
});
