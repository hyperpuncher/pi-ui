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
	assertStringIncludes(html, "$prompt = '';");
	assertStringIncludes(html, "@post('/prompt'");
	assertStringIncludes(html, "payload: { prompt: &#34;/login&#34; }");
});

Deno.test("slash picker only opens while a command or skill matches", () => {
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
	assertStringIncludes(
		expression,
		'["login log in system","skill:review review code skill"].some',
	);
	assertStringIncludes(
		expression,
		"candidate.includes($prompt.slice(1).toLowerCase())",
	);

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
	assertStringIncludes(html, "No matching sessions.");
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
	assertStringIncludes(html, 'class="group block! bg-foreground! text-background!"');
	assertFalse(html.includes("data-current-session-indicator"));
	assertStringIncludes(html, 'aria-label="Current session running"');
	assertStringIncludes(html, "pi-tool-status-ball");
	assertStringIncludes(
		html,
		'class="inline-grid size-2 shrink-0 *:[grid-area:1/1] ml-0.75"',
	);
	assertStringIncludes(html, "pi-inverse-fine-print");
	assertFalse(html.includes('<kbd class="kbd">1</kbd>'));
	assertStringIncludes(html, 'class="pi-date pi-date-inverse"');
	assertStringIncludes(html, 'class="size-3 text-destructive!"');
	assertStringIncludes(html, "@post('/abort'");
	assertStringIncludes(html, "document.getElementById('session-dialog')?.close()");
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
	assertStringIncludes(
		withoutSelection,
		'class="command" aria-label="Models" data-filter="manual"',
	);
	assertStringIncludes(withoutSelection, 'placeholder="Search models..."');
	assertStringIncludes(withoutSelection, "autofocus");
	assertStringIncludes(withoutSelection, 'data-filter="claude-sonnet anthropic"');
	assertStringIncludes(withoutSelection, 'data-keywords="Claude Sonnet"');
	assertStringIncludes(withoutSelection, 'data-model-search-order="0"');
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
});

Deno.test("file picker fragments escape dynamic values and expose list semantics", () => {
	const html = renderFilePickerResults([
		{
			value: `src/"<unsafe>.ts`,
			label: `<unsafe>.ts`,
			description: `src/<unsafe>.ts`,
			isDirectory: false,
		},
	]);
	assertStringIncludes(html, 'id="file-picker-results"');
	assertStringIncludes(html, 'role="listbox"');
	assertStringIncludes(html, "flex-col-reverse");
	assertStringIncludes(html, 'role="option"');
	assertStringIncludes(html, "&lt;unsafe>.ts");
	assertStringIncludes(html, "src/&lt;unsafe>.ts");
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
