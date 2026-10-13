import { test } from "bun:test";

import { renderSessionPickerContent } from "#src/ui/pickers.tsx";
import { renderSessionSidebarContent } from "#src/ui/session-sidebar.tsx";
import { assertFalse, assertStringIncludes } from "#testing/assertions";
import { appRenderSnapshot } from "#tests/src/ui/test-fixtures.ts";

for (const [name, render] of [
	["sidebar", renderSessionSidebarContent],
	["picker", renderSessionPickerContent],
] as const) {
	test(`${name} keeps an idle status ball for its exit animation but hides it from accessibility`, () => {
		const html = render(
			appRenderSnapshot({
				currentSessionPath: undefined,
				sessions: [
					{
						path: "/sessions/idle.jsonl",
						cwd: "/workspace",
						title: "Idle",
						messageCount: 1,
						modified: "Now",
					},
				],
			}),
		);
		assertStringIncludes(
			html,
			'class="session-status-transition session-status-empty" aria-hidden="true"',
		);
		assertStringIncludes(html, 'aria-label="" role="status"');
	});

	for (const status of ["running", "completed"] as const) {
		test(`${name} exposes the ${status} status ball`, () => {
			const html = render(
				appRenderSnapshot({
					currentSessionPath: undefined,
					sessions: [
						{
							path: "/sessions/active.jsonl",
							cwd: "/workspace",
							title: "Active",
							messageCount: 1,
							modified: "Now",
							backgroundStatus: status,
						},
					],
				}),
			);
			assertStringIncludes(html, `aria-label="Background session ${status}"`);
			assertFalse(
				html.includes('class="session-status-transition" aria-hidden="true"'),
			);
			assertFalse(html.includes("session-status-empty"));
		});
	}
}
