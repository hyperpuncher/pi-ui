import { assertEquals } from "@std/assert";

import { formatOpenCodeGoUsage, parseOpenCodeGoUsage } from "./opencode-go-usage.ts";

Deno.test("parses OpenCode Go usage windows", () => {
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

Deno.test("formats OpenCode Go limits as remaining percentages", () => {
	assertEquals(
		formatOpenCodeGoUsage({
			rolling: { usedPercent: 12 },
			weekly: { usedPercent: 8 },
			monthly: { usedPercent: 35 },
		}),
		"5 hours 88% ?  Weekly 92% ?  Monthly 65% ?",
	);
});

Deno.test("rejects malformed OpenCode Go usage", () => {
	assertEquals(
		parseOpenCodeGoUsage({ usage: { rolling: { percent: "nope" } } }),
		undefined,
	);
	assertEquals(parseOpenCodeGoUsage({}), undefined);
});
