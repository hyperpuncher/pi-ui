import { assertStringIncludes } from "@std/assert";

import { endpoints } from "./endpoints.ts";

Deno.test("each browser action references its registered endpoint", async () => {
	const browserActions = await Promise.all(
		[
			"../../commands/registry.ts",
			"../../ui/auth-dialog.tsx",
			"../../ui/messages.tsx",
			"../../ui/page.tsx",
			"../../ui/pickers.tsx",
			"../../ui/prompt-box.tsx",
			"../../ui/session-transition.tsx",
			"../../ui/tree-picker.tsx",
			"../../../static/app.js",
			"../../../static/display-refresh.js",
		].map((path) => Deno.readTextFile(new URL(path, import.meta.url))),
	);
	const source = browserActions.join("\n");
	const browserEndpoints = [
		endpoints.stream,
		endpoints.displayRefresh,
		endpoints.prompt,
		endpoints.promptFollowUp,
		endpoints.promptDequeue,
		endpoints.abort,
		endpoints.messagesOlder,
		endpoints.messagesEnhance,
		endpoints.sessionsNew,
		endpoints.sessionsNewTemporary,
		endpoints.sessionsList,
		endpoints.sessionsBackgroundAbort,
		endpoints.sessionsDelete,
		endpoints.sessionsResume,
		endpoints.workspaceOpen,
		endpoints.model,
		endpoints.modelCycle,
		endpoints.modelsScopeToggle,
		endpoints.thinking,
		endpoints.thinkingCycle,
		endpoints.authOpenLogin,
		endpoints.authOpenLogout,
		endpoints.authLoginStart,
		endpoints.authInput,
		endpoints.authLogout,
		endpoints.authClose,
		endpoints.treeOpen,
		endpoints.treeNavigate,
		endpoints.filesSearch,
		endpoints.filesImport,
	];
	for (const endpoint of browserEndpoints) assertStringIncludes(source, endpoint);
});
