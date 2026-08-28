import { test } from "bun:test";

import { assertFalse, assertStringIncludes } from "#testing/assertions";

import { renderPromptAction } from "./prompt-action.tsx";
import { renderPromptBox } from "./prompt-box.tsx";
import { renderPromptStatus } from "./prompt-status.tsx";
import { appRenderSnapshot } from "./test-fixtures.ts";

test("context tooltip stays structured while usage is unavailable", () => {
	const html = renderPromptStatus(
		appRenderSnapshot({
			activityText: undefined,
			usage: {
				text: "$14.60 • ?/272k",
				costText: "$14.60",
				contextWindow: 272_000,
			},
		}),
	);

	assertStringIncludes(html, 'data-show="$_promptSubmitting"');
	assertStringIncludes(html, "Sending...");
	assertStringIncludes(html, "animate-spin");
	assertStringIncludes(html, 'data-tooltip="Context usage"');
	assertStringIncludes(html, 'data-slot="tooltip-content"');
	assertStringIncludes(html, "Available after next response");
	assertStringIncludes(html, "$14.60 session");
	assertFalse(html.includes('data-tooltip="$14.60 • ?/272k"'));
});

test("send action has a stable icon and submission-aware disabled state", () => {
	const html = renderPromptAction(appRenderSnapshot({ activityText: undefined }));

	assertFalse(html.includes('data-show="$_promptSubmitting"'));
	assertStringIncludes(html, "$_promptSubmitting ||");
	assertStringIncludes(html, "!window.piUi.fileTransfer.canSubmit($prompt)");
});

test("prompt box owns ephemeral submission state declaratively", () => {
	const html = renderPromptBox(appRenderSnapshot({}));

	assertStringIncludes(html, "&#34;_promptSubmitting&#34;:false");
	assertStringIncludes(html, 'data-attr:inert="$_promptSubmitting"');
	assertStringIncludes(
		html,
		`data-style:filter="$_promptSubmitting ? 'brightness(0.75)' : ''"`,
	);
	assertStringIncludes(html, "$_promptSubmitting = true");
	assertStringIncludes(
		html,
		'data-on:pi-ui-prompt-submit-finished="$_promptSubmitting = false"',
	);
});
