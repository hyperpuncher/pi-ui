import { assertEquals, assertStringIncludes as assertIncludes } from "@std/assert";

import type { AppSessionSummary } from "../state/app-store.ts";
import { assertStringExcludes as assertNotIncludes } from "../testing/assertions.ts";
import { renderSessionPicker } from "../ui/pickers.tsx";
import { appRenderSnapshot } from "../ui/test-fixtures.ts";
import { mergeBackgroundSessionStatuses } from "./background-session-status.ts";

const ordinary = summary("/sessions/ordinary.json", "Ordinary");
const running = summary("/sessions/running.json", "Running");
const completed = summary("/sessions/completed.json", "Completed");

Deno.test("background statuses merge by canonical session path", () => {
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

Deno.test("foreground session takes precedence over background status", () => {
	const merged = mergeBackgroundSessionStatuses(
		[{ ...running, backgroundStatus: "completed" }],
		new Map([[running.path, "running" as const]]),
		running.path,
	);

	assertEquals(merged, [running]);
});

Deno.test("session picker escapes titles and renders background controls", () => {
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

	assertIncludes(html, "&lt;script>alert(&#34;x&#34;)&lt;/script>");
	assertIncludes(html, 'data-background-status="running"');
	assertIncludes(html, 'data-background-status="completed"');
	assertIncludes(html, "Abort background session");
	assertIncludes(html, "/sessions/background/abort");
	assertNotIncludes(html, escapedTitle);
});

function summary(path: string, title: string): AppSessionSummary {
	return {
		path,
		cwd: "/workspace",
		title,
		subtitle: "1 message",
		modified: "Today",
	};
}
