import { test } from "bun:test";
import os from "node:os";

import { assertFalse, assertStringIncludes } from "#testing/assertions";

import {
	renderFilePickerResults,
	renderSessionPicker,
	renderSlashPicker,
	renderWorkspaceBrowserContent,
	renderWorkspaceDialogMenu,
	slashPickerOpenExpression,
} from "./pickers.tsx";
import {
	renderModelPicker,
	renderThinkingPicker,
	renderWorkspacePicker,
} from "./prompt-pickers.tsx";
import { appRenderSnapshot } from "./test-fixtures.ts";

test("slash picker anchors its selected result nearest the prompt", () => {
	const html = renderSlashPicker(
		appRenderSnapshot({
			slashCommands: [
				{ name: "login", description: "Log in", source: "system" },
				{ name: "logout", description: "Log out", source: "system" },
			],
		}),
	);
	assertStringIncludes(html, 'id="slash-picker-list"');
	assertStringIncludes(html, 'aria-selected="true"');
	assertStringIncludes(html, "$prompt = '';");
	assertStringIncludes(html, "@post('/prompt'");
	assertStringIncludes(html, "payload: { prompt: &#34;/login&#34; }");
});

test("slash picker uses pi fuzzy matching on command names", () => {
	const expression = slashPickerOpenExpression(
		appRenderSnapshot({
			slashCommands: [
				{ name: "login", description: "Log in", source: "system" },
				{ name: "skill:review", description: "Review code", source: "skill" },
			],
		}),
	);

	assertStringIncludes(expression, "$prompt.startsWith('/')");
	assertStringIncludes(expression, "!$prompt.includes(' ')");
	assertStringIncludes(expression, '["login","skill:review"].some');
	assertStringIncludes(
		expression,
		"window.piUi.pickers.fuzzyMatch($prompt.slice(1), name).matches",
	);
	assertFalse(expression.includes("log in system"));
	assertFalse(expression.includes("review code skill"));

	const emptyExpression = slashPickerOpenExpression(
		appRenderSnapshot({
			slashCommands: [],
		}),
	);
	assertStringIncludes(emptyExpression, "[].some");
});

test("session rows expose stable ids for resilient active descendants", () => {
	const path = `/sessions/a session.jsonl`;
	const html = renderSessionPicker(
		appRenderSnapshot({
			sessions: [
				{
					path,
					cwd: "/workspace",
					title: "Session",
					messageCount: 1,
					modified: "Today",
				},
			],
			currentSessionPath: undefined,
			sessionsHasMore: true,
		}),
	);
	assertStringIncludes(html, 'id="session-row-%2Fsessions%2Fa%20session.jsonl"');
	assertStringIncludes(html, 'src="/sessions/favicon?cwd=%2Fworkspace"');
	assertStringIncludes(html, "No matching sessions.");
	assertStringIncludes(html, "@post('/sessions/more'");
	assertStringIncludes(html, `data-show="$sessionSearch === ''"`);
	assertFalse(html.includes("data-session-rename-title"));
});

test("session picker formats numeric message counts", () => {
	for (const [messageCount, label] of [
		[0, "0 messages"],
		[1, "1 message"],
		[2, "2 messages"],
	] as const) {
		const html = renderSessionPicker(
			appRenderSnapshot({
				sessions: [
					{
						path: "/session",
						cwd: "/workspace",
						title: "Session",
						messageCount,
						modified: "Now",
					},
				],
			}),
		);
		assertStringIncludes(html, label);
	}
});

test("current running session is live but does not resume itself", () => {
	const path = "/sessions/current.jsonl";
	const html = renderSessionPicker(
		appRenderSnapshot({
			sessions: [
				{
					path,
					cwd: "/workspace",
					title: "Current session",
					messageCount: 1,
					modified: "Now",
				},
			],
			currentSessionPath: path,
			activityText: "Working...",
		}),
	);

	assertStringIncludes(html, 'aria-current="true"');
	assertStringIncludes(html, 'aria-label="Current session running"');
	assertStringIncludes(html, "@post('/sessions/rename'");
	assertStringIncludes(html, "@post('/abort'");
	assertFalse(html.includes("/sessions/resume"));
});

test("background sessions expose statuses and shortcuts", () => {
	const html = renderSessionPicker(
		appRenderSnapshot({
			sessions: [
				{
					path: "/sessions/running.jsonl",
					cwd: "/workspace",
					title: "Running session",
					messageCount: 1,
					modified: "Now",
					backgroundStatus: "running",
				},
				{
					path: "/sessions/completed.jsonl",
					cwd: "/workspace",
					title: "Completed session",
					messageCount: 2,
					modified: "Today",
					backgroundStatus: "completed",
				},
			],
			currentSessionPath: undefined,
		}),
	);

	assertStringIncludes(html, 'aria-label="Background session running"');
	assertStringIncludes(html, 'aria-label="Background session completed"');
	assertStringIncludes(html, '<kbd class="kbd">1</kbd>');
	assertStringIncludes(html, '<kbd class="kbd">2</kbd>');
});

test("current idle session exposes deletion", () => {
	const path = "/sessions/current.jsonl";
	const html = renderSessionPicker(
		appRenderSnapshot({
			sessions: [
				{
					path,
					cwd: "/workspace",
					title: "Current session",
					messageCount: 1,
					modified: "Now",
				},
			],
			currentSessionPath: path,
		}),
	);

	assertStringIncludes(html, 'aria-label="Delete session Current session"');
	assertStringIncludes(html, "$sessionDeletePath");
});

test("workspace picker shows only the workspace folder name", () => {
	const nested = renderWorkspacePicker(
		appRenderSnapshot({
			workspacePath: "/home/user/Documents/Blenderanimation",
		}),
	);
	assertStringIncludes(nested, ">Blenderanimation</span>");
	assertStringIncludes(nested, 'aria-label="/home/user/Documents/Blenderanimation"');

	const home = renderWorkspacePicker(
		appRenderSnapshot({
			workspacePath: os.homedir(),
		}),
	);
	assertStringIncludes(home, ">~</span>");
});

test("workspace rows show each collapsed path once", () => {
	const home = os.homedir();
	const html = renderWorkspaceDialogMenu(
		appRenderSnapshot({
			workspacePath: home,
			recentWorkspaces: [`${home}/projects/pi-ui`],
		}),
	);

	assertStringIncludes(html, ">~<");
	assertStringIncludes(html, ">~/projects/pi-ui<");
	assertStringIncludes(
		html,
		`src="/sessions/favicon?cwd=${encodeURIComponent(`${home}/projects/pi-ui`)}"`,
	);
	assertStringIncludes(html, 'aria-current="true"');
	assertFalse(
		new RegExp(`>\\s*${escapeRegExp(home)}(?:/projects/pi-ui)?\\s*<`).test(html),
	);
});

test("workspace browser navigates folders and opens the selected directory", () => {
	const html = renderWorkspaceBrowserContent({
		path: "/workspace",
		parent: "/",
		directories: ["/workspace/alpha"],
		showHidden: false,
	});

	assertStringIncludes(html, "Select folder");
	assertStringIncludes(html, "Open folder");
	assertStringIncludes(html, "Fork session");
	assertStringIncludes(html, "workspacePath: &#34;/workspace&#34;");
	assertStringIncludes(html, "/workspace/open");
	assertStringIncludes(html, "/sessions/fork-to-workspace");
	assertStringIncludes(html, "/workspace/browse");
	assertStringIncludes(html, ">alpha</span>");
	assertStringIncludes(html, "Show hidden");
});

test("workspace picker only opens existing workspace suggestions", () => {
	const html = renderWorkspaceDialogMenu(
		appRenderSnapshot({
			workspacePath: "/workspace",
			recentWorkspaces: [],
		}),
	);

	assertFalse(html.includes("Open typed path"));
	assertFalse(html.includes("data-empty"));
	assertStringIncludes(html, "Recent workspaces");
});

test("model picker distinguishes missing auth from an unselected model", () => {
	const withoutProvider = renderModelPicker(
		appRenderSnapshot({
			models: [],
			currentModel: undefined,
		}),
	);
	assertStringIncludes(withoutProvider, "no provider");
	assertStringIncludes(withoutProvider, "Log in to a provider");
	assertStringIncludes(withoutProvider, "/auth/open-login");
	assertFalse(withoutProvider.includes("dropdown-menu"));

	const withoutSelection = renderModelPicker(
		appRenderSnapshot({
			models: [
				{
					id: "claude-sonnet",
					provider: "anthropic",
					name: "Claude Sonnet",
					configured: true,
					scoped: false,
				},
			],
			currentModel: undefined,
		}),
	);
	assertStringIncludes(withoutSelection, "choose model");
	assertStringIncludes(withoutSelection, 'aria-label="Models"');
	assertStringIncludes(withoutSelection, "@post('/models/refresh', { payload: {} })");
	assertStringIncludes(withoutSelection, 'placeholder="Search models..."');
	assertStringIncludes(withoutSelection, "Claude Sonnet");
});

test("model picker shows only the final model name in its trigger", () => {
	const html = renderModelPicker(
		appRenderSnapshot({
			models: [
				{
					id: "deepseek-ai/DeepSeek-R1",
					provider: "huggingface",
					name: "DeepSeek R1",
					configured: true,
					scoped: false,
				},
			],
			currentModel: "huggingface/deepseek-ai/DeepSeek-R1",
		}),
	);

	assertStringIncludes(html, ">DeepSeek-R1</span>");
	assertStringIncludes(html, ">deepseek-ai/DeepSeek-R1</span>");
});

test("thinking picker describes every supported maximum level", () => {
	const html = renderThinkingPicker(
		appRenderSnapshot({
			thinkingLevel: "max",
			thinkingLevels: ["xhigh", "max"],
		}),
	);

	assertStringIncludes(html, "Extra-high reasoning");
	assertStringIncludes(html, "Maximum reasoning");
});

test("file picker fragments escape dynamic values and expose list semantics", () => {
	const html = renderFilePickerResults(
		[
			{
				value: `@src/"<unsafe>.ts`,
				label: `<unsafe>.ts`,
				description: `src/<unsafe>.ts`,
			},
		],
		"src",
	);
	assertStringIncludes(html, 'id="file-picker-results"');
	assertStringIncludes(html, 'role="listbox"');
	assertStringIncludes(html, 'role="option"');
	assertStringIncludes(html, "&lt;unsafe&gt;.ts");
	assertStringIncludes(html, "src/&lt;unsafe&gt;.ts");
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
