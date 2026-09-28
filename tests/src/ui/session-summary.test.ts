import { expect, test } from "bun:test";
import os from "node:os";
import { join } from "node:path";

import type { AppSessionSummary } from "#src/state/app-store.ts";
import { SessionSubtitle } from "#src/ui/session-summary.tsx";
import { appWorktreeRoot, managedWorktreeDirectoryName } from "#src/utils/workspace.ts";

function session(cwd: string): AppSessionSummary {
	return {
		path: "/sessions/session",
		cwd,
		title: "Session",
		messageCount: 3,
		modified: "today",
	};
}

const options = {
	class: "subtitle",
	workspaceNameOnly: true,
	showSubtitle: false,
} as const;

test("managed worktree sessions show their project and branch", () => {
	const cwd = join(
		appWorktreeRoot(),
		"pi-ui",
		managedWorktreeDirectoryName("test/worktree-2"),
	);
	expect(SessionSubtitle({ session: session(cwd), ...options })).toContain(
		"pi-ui · test/worktree-2",
	);
});

test("plain workspace sessions keep their display name", () => {
	const html = SessionSubtitle({
		session: session(join(os.homedir(), "projects", "pi-ui")),
		...options,
	});
	expect(html).toContain(">pi-ui<");
});
