import os from "node:os";

import { assertFalse, assertStringIncludes } from "@std/assert";

import {
	renderFilePickerResults,
	renderSessionPicker,
	renderSlashPicker,
	renderWorkspaceDialogMenu,
	slashPickerOpenExpression,
} from "./pickers.tsx";
import {
	renderModelPicker,
	renderThinkingPicker,
	renderWorkspacePicker,
} from "./prompt-pickers.tsx";
import { appRenderSnapshot } from "./test-fixtures.ts";

Deno.test("slash picker anchors its selected result nearest the prompt", () => {
	const html = renderSlashPicker(
		appRenderSnapshot({
			slashCommands: [
				{ name: "login", description: "Log in", source: "system" },
				{ name: "logout", description: "Log out", source: "system" },
			],
		}),
	);
	assertStringIncludes(html, 'id="slash-picker-list"');
	assertStringIncludes(html, "flex-col-reverse");
	assertStringIncludes(html, 'aria-selected="true"');
	assertStringIncludes(html, 'data-slash-order="0"');
	assertStringIncludes(html, 'data-slash-name="login"');
	assertStringIncludes(html, "$prompt = '';");
	assertStringIncludes(html, "@post('/prompt'");
	assertStringIncludes(html, "payload: { prompt: &#34;/login&#34; }");
});

Deno.test("slash picker uses pi fuzzy matching on command names", () => {
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

Deno.test("session rows expose stable ids for resilient active descendants", () => {
	const path = `/sessions/a session.jsonl`;
	const html = renderSessionPicker(
		appRenderSnapshot({
			sessions: [
				{
					path,
					cwd: "/workspace",
					title: "Session",
					subtitle: "1 message",
					modified: "Today",
				},
			],
			currentSessionPath: undefined,
		}),
	);
	assertStringIncludes(html, 'id="session-row-%2Fsessions%2Fa%20session.jsonl"');
	assertStringIncludes(html, 'src="/sessions/favicon?cwd=%2Fworkspace"');
	assertStringIncludes(html, 'aria-hidden="true"');
	assertStringIncludes(html, 'data-preserve-attr="class aria-hidden"');
	assertStringIncludes(html, "aria-current:bg-sidebar-accent!");
	assertStringIncludes(html, "No matching sessions.");
	assertFalse(html.includes("data-session-rename-title"));
	assertStringIncludes(html, "text-[13px] text-muted-foreground");
});

Deno.test("current running session is live but does not resume itself", () => {
	const path = "/sessions/current.jsonl";
	const html = renderSessionPicker(
		appRenderSnapshot({
			sessions: [
				{
					path,
					cwd: "/workspace",
					title: "Current session",
					subtitle: "1 message",
					modified: "Now",
				},
			],
			currentSessionPath: path,
			activityText: "Working...",
		}),
	);

	assertStringIncludes(html, 'aria-current="true"');
	assertStringIncludes(html, "bg-sidebar-accent!");
	assertStringIncludes(html, "text-sidebar-accent-foreground!");
	assertFalse(html.includes("data-current-session-indicator"));
	assertStringIncludes(html, 'aria-label="Current session running"');
	assertStringIncludes(html, "pi-tool-status-ball");
	assertStringIncludes(
		html,
		'class="inline-grid size-2 shrink-0 *:[grid-area:1/1] ml-0.75"',
	);
	assertFalse(html.includes("pi-inverse-fine-print"));
	assertFalse(html.includes('<kbd class="kbd">1</kbd>'));
	assertStringIncludes(html, 'class="pi-date"');
	assertStringIncludes(html, "data-session-rename-title");
	assertStringIncludes(html, "data-on:dblclick");
	assertStringIncludes(html, "@post('/sessions/rename'");
	assertStringIncludes(html, 'class="size-3 text-destructive!"');
	assertStringIncludes(html, "@post('/abort'");
	assertStringIncludes(html, "document.getElementById('session-dialog')?.close()");
	assertStringIncludes(html, "dataset.sessionPickerCloseTimer");
	assertStringIncludes(html, "setTimeout");
	assertFalse(html.includes('disabled=""'));
	assertFalse(html.includes("/sessions/resume"));
});

Deno.test("background session statuses use shared semantic dots", () => {
	const html = renderSessionPicker(
		appRenderSnapshot({
			sessions: [
				{
					path: "/sessions/running.jsonl",
					cwd: "/workspace",
					title: "Running session",
					subtitle: "1 message",
					modified: "Now",
					backgroundStatus: "running",
				},
				{
					path: "/sessions/completed.jsonl",
					cwd: "/workspace",
					title: "Completed session",
					subtitle: "2 messages",
					modified: "Today",
					backgroundStatus: "completed",
				},
			],
			currentSessionPath: undefined,
		}),
	);

	assertStringIncludes(html, 'aria-label="Background session running"');
	assertStringIncludes(html, 'aria-label="Background session completed"');
	assertStringIncludes(html, "animate-ping");
	assertStringIncludes(html, "pi-tool-status-success");
	assertStringIncludes(html, '<kbd class="kbd">1</kbd>');
	assertStringIncludes(html, '<kbd class="kbd">2</kbd>');
	assertFalse(html.includes('class="badge'));
});

Deno.test("current idle session exposes deletion", () => {
	const path = "/sessions/current.jsonl";
	const html = renderSessionPicker(
		appRenderSnapshot({
			sessions: [
				{
					path,
					cwd: "/workspace",
					title: "Current session",
					subtitle: "1 message",
					modified: "Now",
				},
			],
			currentSessionPath: path,
		}),
	);

	assertStringIncludes(html, "$sessionDeletePath");
	assertStringIncludes(html, "opacity-0 transition-opacity");
	assertStringIncludes(html, "group-hover:opacity-100");
	assertStringIncludes(html, 'data-variant="ghost"');
	assertStringIncludes(html, "$sessionDeleteHover");
	assertStringIncludes(html, "? 'destructive' : 'ghost'");
	assertFalse(html.includes("hover:bg-destructive"));
	assertFalse(html.includes('disabled=""'));
});

Deno.test("workspace picker shows only the workspace folder name", () => {
	const nested = renderWorkspacePicker(
		appRenderSnapshot({
			workspacePath: "/home/user/Documents/Blenderanimation",
		}),
	);
	assertStringIncludes(nested, 'class="truncate">Blenderanimation</span>');
	assertStringIncludes(nested, 'aria-label="/home/user/Documents/Blenderanimation"');

	const home = renderWorkspacePicker(
		appRenderSnapshot({
			workspacePath: os.homedir(),
		}),
	);
	assertStringIncludes(home, 'class="truncate">~</span>');
});

Deno.test("workspace rows show each collapsed path once", () => {
	const home = os.homedir();
	const html = renderWorkspaceDialogMenu(
		appRenderSnapshot({
			workspacePath: home,
			recentWorkspaces: [`${home}/projects/pi-ui`],
		}),
	);

	assertStringIncludes(html, ">~<");
	assertStringIncludes(html, ">~/projects/pi-ui<");
	assertStringIncludes(html, "truncate font-mono text-[13px]");
	assertStringIncludes(
		html,
		`src="/sessions/favicon?cwd=${encodeURIComponent(`${home}/projects/pi-ui`)}"`,
	);
	assertStringIncludes(html, 'aria-current="true"');
	assertStringIncludes(html, "font-semibold text-foreground");
	assertFalse(
		new RegExp(`>\\s*${escapeRegExp(home)}(?:/projects/pi-ui)?\\s*<`).test(html),
	);
});

Deno.test("workspace picker only opens existing workspace suggestions", () => {
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

Deno.test("model picker distinguishes missing auth from an unselected model", () => {
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
	assertStringIncludes(withoutSelection, 'class="popover"');
	assertStringIncludes(withoutSelection, 'class="command"');
	assertStringIncludes(withoutSelection, 'aria-label="Models"');
	assertStringIncludes(withoutSelection, 'data-filter="manual"');
	assertStringIncludes(withoutSelection, 'data-preserve-attr="aria-expanded"');
	assertStringIncludes(withoutSelection, 'data-preserve-attr="aria-hidden"');
	assertStringIncludes(withoutSelection, "w-88");
	assertStringIncludes(withoutSelection, 'placeholder="Search models..."');
	assertStringIncludes(withoutSelection, "data-signals:_model-query__ifmissing");
	assertStringIncludes(withoutSelection, "data-bind:_model-query");
	assertStringIncludes(withoutSelection, "window.piUi.modelSearch.filter");
	assertStringIncludes(withoutSelection, 'data-preserve-attr="aria-activedescendant"');
	assertStringIncludes(withoutSelection, 'data-preserve-attr="class aria-hidden"');
	assertStringIncludes(withoutSelection, "autofocus");
	assertStringIncludes(withoutSelection, 'data-filter="claude-sonnet anthropic"');
	assertStringIncludes(withoutSelection, 'data-keywords="Claude Sonnet"');
	assertStringIncludes(withoutSelection, 'data-model-search-order="0"');
	assertStringIncludes(withoutSelection, "[content-visibility:auto]");
	assertStringIncludes(withoutSelection, "[contain-intrinsic-block-size:auto_3rem]");
	assertStringIncludes(
		withoutSelection,
		"w-0 opacity-0 group-hover:w-7 group-hover:opacity-100 focus-visible:w-7 focus-visible:opacity-100",
	);
	assertFalse(withoutSelection.includes("max-w-56"));
});

Deno.test("model picker shows only the final model name in its trigger", () => {
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

	assertStringIncludes(html, "<span>DeepSeek-R1</span>");
	assertStringIncludes(html, ">deepseek-ai/DeepSeek-R1</span>");
});

Deno.test("thinking picker describes every supported maximum level", () => {
	const html = renderThinkingPicker(
		appRenderSnapshot({
			thinkingLevel: "max",
			thinkingLevels: ["xhigh", "max"],
		}),
	);

	assertStringIncludes(html, "Extra-high reasoning");
	assertStringIncludes(html, "Maximum reasoning");
	assertStringIncludes(html, "!evt.ctrlKey");
	assertStringIncludes(html, "!evt.metaKey");
	assertStringIncludes(
		html,
		'data-preserve-attr="aria-expanded aria-activedescendant"',
	);
});

Deno.test("file picker fragments escape dynamic values and expose list semantics", () => {
	const html = renderFilePickerResults(
		[
			{
				value: `src/"<unsafe>.ts`,
				label: `<unsafe>.ts`,
				description: `src/<unsafe>.ts`,
				isDirectory: false,
			},
		],
		"src",
	);
	assertStringIncludes(html, 'id="file-picker-results"');
	assertStringIncludes(html, "window.piUi.pickers.resetFile(&#34;src&#34;)");
	assertStringIncludes(html, 'role="listbox"');
	assertStringIncludes(html, "flex-col-reverse");
	assertStringIncludes(html, 'role="option"');
	assertStringIncludes(html, "&lt;unsafe>.ts");
	assertStringIncludes(html, "src/&lt;unsafe>.ts");
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
