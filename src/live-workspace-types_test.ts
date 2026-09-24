import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import {
	formatRetryCountdown,
	liveWorkspaceRatioMax,
	liveWorkspaceRatioMin,
	normalizeLiveWorkspacePreferences,
	truncateForDisplay,
} from "./live-workspace-types.ts";

test("live workspace preferences keep only valid values", () => {
	assertEquals(normalizeLiveWorkspacePreferences(undefined), {});
	assertEquals(normalizeLiveWorkspacePreferences({ open: true }).open, true);
	assertEquals(normalizeLiveWorkspacePreferences({ open: "yes" }).open, undefined);
	assertEquals(normalizeLiveWorkspacePreferences({ tab: "agents" }).tab, "agents");
	assertEquals(normalizeLiveWorkspacePreferences({ tab: "bogus" }).tab, undefined);
	assertEquals(
		normalizeLiveWorkspacePreferences({ notifications: true }).notifications,
		true,
	);
	assertEquals(
		normalizeLiveWorkspacePreferences({ notifications: "yes" }).notifications,
		undefined,
	);
});

test("formatRetryCountdown reports seconds remaining or that a retry is happening now", () => {
	assertEquals(formatRetryCountdown(4200), "in 5s");
	assertEquals(formatRetryCountdown(1000), "in 1s");
	assertEquals(formatRetryCountdown(0), "retrying now");
	assertEquals(formatRetryCountdown(-500), "retrying now");
});

test("live workspace ratio clamps to the supported range", () => {
	assertEquals(
		normalizeLiveWorkspacePreferences({ ratio: 5 }).ratio,
		liveWorkspaceRatioMax,
	);
	assertEquals(
		normalizeLiveWorkspacePreferences({ ratio: -1 }).ratio,
		liveWorkspaceRatioMin,
	);
	assertEquals(normalizeLiveWorkspacePreferences({ ratio: 0.4 }).ratio, 0.4);
	assertEquals(
		normalizeLiveWorkspacePreferences({ ratio: Number.NaN }).ratio,
		undefined,
	);
	assertEquals(normalizeLiveWorkspacePreferences({ ratio: "0.4" }).ratio, undefined);
});

test("live workspace preferences never throw on a non-record payload", () => {
	assertEquals(normalizeLiveWorkspacePreferences(null), {});
	assertEquals(normalizeLiveWorkspacePreferences("bogus"), {});
	assertEquals(normalizeLiveWorkspacePreferences(42), {});
});

test("display truncation keeps short text intact and ellipsizes long text", () => {
	assertEquals(truncateForDisplay("hi", 10), "hi");
	assertEquals(truncateForDisplay("hello world", 5), "hello…");
});
