import { test } from "bun:test";

import { assertStringIncludes } from "#testing/assertions";

import { emptyLiveWorkspaceSnapshot } from "../live-workspace-types.ts";
import { assertStringExcludes } from "../testing/assertions.ts";
import { renderPromptStatus, renderUsageIndicators } from "./prompt-status.tsx";
import { appRenderSnapshot } from "./test-fixtures.ts";

test("usage fallback explains unavailable context and preserves session cost", () => {
	const snapshot = appRenderSnapshot({
		activityText: undefined,
		usage: {
			text: "$14.60 • ?/272k",
			costText: "$14.60",
			contextWindow: 272_000,
		},
	});
	const usageHtml = renderUsageIndicators(snapshot.usage);

	assertStringIncludes(usageHtml, "Available after next response");
	assertStringIncludes(usageHtml, "$14.60 session");
});

test("an extension dialog waiting for input shows its own status instead of Sending... (m6)", () => {
	const waiting = renderPromptStatus(
		appRenderSnapshot({
			liveWorkspace: {
				...emptyLiveWorkspaceSnapshot,
				turn: {
					phase: "waiting-for-extension",
					waitingKind: "select",
					waitingTitle: "Pick an option",
				},
			},
		}),
	);
	assertStringIncludes(waiting, "Waiting for extension input: Pick an option");
	assertStringIncludes(waiting, 'data-show="true"');
	assertStringExcludes(waiting, "Sending...");
});

test("an ordinary running turn keeps the Sending... status gated on the submit signal", () => {
	const running = renderPromptStatus(
		appRenderSnapshot({
			liveWorkspace: { ...emptyLiveWorkspaceSnapshot, turn: { phase: "running" } },
		}),
	);
	assertStringIncludes(running, "Sending...");
	assertStringIncludes(running, 'data-show="$_promptSubmitting"');
	assertStringExcludes(running, "Waiting for extension input");
});
