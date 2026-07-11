import type { AppSessionSummary, AppState } from "../state/app-state.ts";
import { renderSessionPicker } from "../ui/pickers.tsx";
import {
	abortRunningBackgroundSession,
	mergeBackgroundSessionStatuses,
} from "./background-session-status.ts";

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

Deno.test("background abort targets only an exact running path", async () => {
	const sessions = new Map([
		["/sessions/one.json", { name: "one", status: "completed" as const }],
		[
			"/sessions/two.json",
			{ name: "two", status: "running" as "running" | "completed" },
		],
	]);
	const aborted: string[] = [];
	const abort = (session: { name: string }) => {
		aborted.push(session.name);
		return Promise.resolve();
	};

	assertEquals(
		await abortRunningBackgroundSession(sessions, "/sessions/two.json", abort),
		true,
	);
	assertEquals(sessions.get("/sessions/two.json")?.status, "completed");
	assertEquals(
		await abortRunningBackgroundSession(sessions, "/sessions/one.json", abort),
		false,
	);
	assertEquals(
		await abortRunningBackgroundSession(sessions, "/sessions/unknown.json", abort),
		false,
	);
	assertEquals(aborted, ["two"]);
});

Deno.test("session picker escapes titles and renders background controls", () => {
	const escapedTitle = '<script>alert("x")</script>';
	const html = renderSessionPicker({
		sessions: [
			{ ...running, title: escapedTitle, backgroundStatus: "running" },
			{ ...completed, backgroundStatus: "completed" },
		],
		currentSessionPath: ordinary.path,
	} as AppState);

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
		subtitle: "1 message • /workspace",
		modified: "Today",
	};
}

function assertEquals(actual: unknown, expected: unknown): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
		);
	}
}

function assertIncludes(actual: string, expected: string): void {
	if (!actual.includes(expected)) {
		throw new Error(`Expected output to include ${JSON.stringify(expected)}`);
	}
}

function assertNotIncludes(actual: string, expected: string): void {
	if (actual.includes(expected)) {
		throw new Error(`Expected output not to include ${JSON.stringify(expected)}`);
	}
}
