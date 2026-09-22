import { expect, test } from "bun:test";
import { join } from "node:path";

import {
	appWorktreeRoot,
	managedWorktreeDirectoryName,
	managedWorktreeParts,
} from "./workspace.ts";

test("managed worktree paths expose their project and branch", () => {
	expect(managedWorktreeDirectoryName("feature/nested")).toMatch(
		/^feature~nested-[0-9a-f]{8}$/,
	);
	const path = join(
		appWorktreeRoot(),
		"pi-ui",
		managedWorktreeDirectoryName("feature/nested"),
	);
	expect(managedWorktreeParts(path)).toEqual({
		project: "pi-ui",
		branch: "feature/nested",
	});
	expect(managedWorktreeParts(`${path}/packages/web`)).toEqual({
		project: "pi-ui",
		branch: "feature/nested",
	});
	expect(
		managedWorktreeParts(
			join(
				appWorktreeRoot(),
				"pi-ui",
				managedWorktreeDirectoryName("fix-ab12cd34"),
			),
		)?.branch,
	).toBe("fix-ab12cd34");
	expect(managedWorktreeParts(appWorktreeRoot())).toBeUndefined();
	expect(managedWorktreeParts(join(appWorktreeRoot(), "pi-ui"))).toBeUndefined();
	expect(managedWorktreeParts("/projects/pi-ui")).toBeUndefined();
});
