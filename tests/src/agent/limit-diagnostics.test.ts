import { test } from "bun:test";

import { limitsFromMessages, parseLimitWindows } from "#src/agent/limit-diagnostics.ts";
import type { JsonObject } from "#src/utils/type-guards.ts";
import { assertEquals } from "#testing/assertions";

function resetsInMinutes(minutes: number): number {
	return Math.floor((Date.now() + minutes * 60_000) / 1_000);
}

function details(): JsonObject {
	return {
		status: "allowed",
		isUsingOverage: false,
		unifiedWindows: {
			five_hour: { utilization: 0.42, resetsAt: resetsInMinutes(90) },
			seven_day: { utilization: 0.08, resetsAt: resetsInMinutes(2 * 24 * 60) },
		},
	};
}

test("maps Claude rate-limit windows in order with remaining percent", () => {
	assertEquals(parseLimitWindows(details()), {
		status: undefined,
		windows: [
			{
				label: "5 hours",
				usedPercent: 42,
				remainingPercent: 58,
				resetText: "1.5h",
			},
			{
				label: "Weekly",
				usedPercent: 8,
				remainingPercent: 92,
				resetText: "2d",
			},
		],
	});
});

test("reports extra usage and treats an expired window as reset", () => {
	assertEquals(
		parseLimitWindows({
			isUsingOverage: true,
			unifiedWindows: {
				five_hour: { utilization: 0.7, resetsAt: resetsInMinutes(-5) },
			},
		}),
		{
			status: "using extra usage",
			windows: [
				{
					label: "5 hours",
					usedPercent: 0,
					remainingPercent: 100,
					resetText: "0m",
				},
			],
		},
	);
});

test("reads the newest diagnostic on an assistant message", () => {
	const usage = limitsFromMessages(
		[
			{ role: "user" },
			{
				role: "assistant",
				diagnostics: [
					{ type: "claude-code.turn-relay", details: {} },
					{ type: "claude-code.rate-limit", details: details() },
				],
			},
			{ role: "assistant" },
		],
		"claude-code",
	);
	assertEquals(
		usage?.windows.map((window) => window.label),
		["5 hours", "Weekly"],
	);
});

test("reads a diagnostic from a second provider with the same shape", () => {
	const usage = limitsFromMessages(
		[
			{
				role: "assistant",
				diagnostics: [{ type: "antigravity.rate-limit", details: details() }],
			},
		],
		"antigravity",
	);
	assertEquals(
		usage?.windows.map((window) => window.label),
		["5 hours", "Weekly"],
	);
});

test("ignores diagnostics from other providers", () => {
	assertEquals(
		limitsFromMessages(
			[
				{
					role: "assistant",
					diagnostics: [{ type: "claude-code.rate-limit", details: details() }],
				},
			],
			"antigravity",
		),
		undefined,
	);
});
