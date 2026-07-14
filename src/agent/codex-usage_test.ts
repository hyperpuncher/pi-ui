import { assertEquals } from "@std/assert";

import { formatCodexUsage } from "./codex-usage.ts";

Deno.test("formats Codex windows from their reported duration", () => {
	assertEquals(
		formatCodexUsage({
			primary: { usedPercent: 22, windowSeconds: 604_800 },
		}),
		"1w 78% ?",
	);
	assertEquals(
		formatCodexUsage({
			primary: { usedPercent: 25, windowSeconds: 18_000 },
			secondary: { usedPercent: 50, windowSeconds: 604_800 },
		}),
		"5h 75% ?  1w 50% ?",
	);
});

Deno.test("uses legacy labels when Codex omits window durations", () => {
	assertEquals(
		formatCodexUsage({
			primary: { usedPercent: 10 },
			secondary: { usedPercent: 20 },
		}),
		"5h 90% ?  1w 80% ?",
	);
});
