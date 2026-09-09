import { test } from "bun:test";

import {
	assertEquals,
	assertStringIncludes as assertIncludes,
} from "#testing/assertions";

import { AppStore, type AppSessionSummary } from "../state/app-store.ts";
import { assertStringExcludes as assertNotIncludes } from "../testing/assertions.ts";
import { renderSessionPicker } from "../ui/pickers.tsx";
import { renderSessionSidebar } from "../ui/session-sidebar.tsx";
import { appRenderSnapshot } from "../ui/test-fixtures.ts";
import { mergeBackgroundSessionStatuses } from "./background-session-status.ts";

const ordinary = summary("/sessions/ordinary.json", "Ordinary");
const running = summary("/sessions/running.json", "Running");
const completed = summary("/sessions/completed.json", "Completed");

test("background statuses merge by canonical session path", () => {
	const merged = mergeBackgroundSessionStatuses(
		[ordinary, running, completed],
		new Map([
			[running.path, "running" as const],
			[completed.path, "completed" as const],
		]),
	);

	assertEquals(merged, [
		ordinary,
		{ ...running, backgroundStatus: "running" },
		{ ...completed, backgroundStatus: "completed" },
	]);
});

test("foreground session takes precedence over background status", () => {
	const merged = mergeBackgroundSessionStatuses(
		[{ ...running, backgroundStatus: "completed" }],
		new Map([[running.path, "running" as const]]),
		running.path,
	);

	assertEquals(merged, [running]);
});

test("sessions prioritize running work, then unopened completions", () => {
	const state = new AppStore();
	const current = summary("/current", "Current");
	const done = { ...completed, backgroundStatus: "completed" as const };
	const active = { ...running, backgroundStatus: "running" as const };
	state.setSessionCatalog([ordinary, done, current, active]);
	state.setCurrentSessionPath(current.path);
	state.setActivityText("Working");
	assertEquals(state.sessions, [current, active, done, ordinary]);

	state.setActivityText(undefined);
	state.setCurrentSessionPath(done.path);
	assertEquals(state.sessions, [active, ordinary, done, current]);
});

test("session priority applies before pagination and search limits", () => {
	const state = new AppStore();
	const recent = Array.from({ length: 35 }, (_, index) =>
		summary(`/recent-${index}`, "Recent"),
	);
	const done = { ...completed, backgroundStatus: "completed" as const };
	const active = { ...running, backgroundStatus: "running" as const };
	state.setSessionCatalog([...recent, done, active]);
	const expected = [active, done, ...recent.slice(0, 28)];
	assertEquals(state.sessions, expected);
	assertEquals(state.snapshot().sessions, expected);
	assertEquals(state.searchSessions("workspace"), expected);
});

test("date grouping cannot move ordinary sessions ahead of priority sessions", () => {
	const state = new AppStore();
	state.setSessionCatalog([
		{ ...ordinary, modifiedAt: "2026-09-09T12:00:00Z" },
		{ ...running, backgroundStatus: "running", modifiedAt: "2026-09-08T12:00:00Z" },
		{
			...completed,
			backgroundStatus: "completed",
			modifiedAt: "2026-09-09T12:00:00Z",
		},
		{ ...summary("/old", "Old"), modifiedAt: "2026-09-08T12:00:00Z" },
	]);
	const html = renderSessionSidebar(state.snapshot());
	const titles = [
		...html.matchAll(/aria-label="(Ordinary|Running|Completed|Old)"/g),
	].map((match) => match[1]);
	assertEquals(titles, ["Running", "Completed", "Ordinary", "Old"]);
});

test("opening a completed session clears its completion indicator in both session lists", () => {
	const state = appRenderSnapshot({
		sessions: [{ ...completed, backgroundStatus: "completed" }],
		currentSessionPath: completed.path,
		activityText: undefined,
	});
	for (const render of [renderSessionPicker, renderSessionSidebar]) {
		const html = render(state);
		assertIncludes(html, 'aria-current="true"');
		assertNotIncludes(html, 'aria-label="Background session completed"');
	}
});

test("session picker escapes titles and renders background controls", () => {
	const escapedTitle = '<script>alert("x")</script>';
	const html = renderSessionPicker(
		appRenderSnapshot({
			sessions: [
				{ ...running, title: escapedTitle, backgroundStatus: "running" },
				{ ...completed, backgroundStatus: "completed" },
			],
			currentSessionPath: ordinary.path,
		}),
	);

	assertIncludes(html, "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
	assertIncludes(html, 'aria-label="Background session running"');
	assertIncludes(html, 'aria-label="Background session completed"');
	assertIncludes(html, "Abort background session");
	assertIncludes(html, "/sessions/background/abort");
	assertNotIncludes(html, escapedTitle);
});

function summary(path: string, title: string): AppSessionSummary {
	return {
		path,
		cwd: "/workspace",
		title,
		messageCount: 1,
		modified: "Today",
	};
}
