import { test } from "bun:test";

import {
	describeOpenCodeGoUsage,
	parseOpenCodeGoUsage,
} from "#src/agent/opencode-go-usage.ts";
import { assertEquals } from "#testing/assertions";

test("parses OpenCode Go usage windows", () => {
	assertEquals(
		parseOpenCodeGoUsage({
			usage: {
				rolling: { percent: 12, resetsAt: "2030-01-02T03:04:05.000Z" },
				weekly: { percent: "8", resetsAt: 1_900_000_000 },
				monthly: { percent: 35 },
			},
		}),
		{
			rolling: { usedPercent: 12, resetsAt: 1_893_553_445_000 },
			weekly: { usedPercent: 8, resetsAt: 1_900_000_000_000 },
			monthly: { usedPercent: 35, resetsAt: undefined },
		},
	);
});

test("formats OpenCode Go limits as remaining percentages", () => {
	assertEquals(
		describeOpenCodeGoUsage({
			rolling: { usedPercent: 12 },
			weekly: { usedPercent: 8 },
			monthly: { usedPercent: 35 },
		}),
		[
			{ label: "5 hours", usedPercent: 12, remainingPercent: 88, resetText: "?" },
			{ label: "Weekly", usedPercent: 8, remainingPercent: 92, resetText: "?" },
			{ label: "Monthly", usedPercent: 35, remainingPercent: 65, resetText: "?" },
		],
	);
});

test("rejects malformed OpenCode Go usage", () => {
	assertEquals(
		parseOpenCodeGoUsage({ usage: { rolling: { percent: "nope" } } }),
		undefined,
	);
	assertEquals(parseOpenCodeGoUsage({}), undefined);
});
