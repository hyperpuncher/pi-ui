import { assertEquals } from "@std/assert";

import { formatCodexUsage, parseCodexUsage } from "./codex-usage.ts";

Deno.test("parses available Codex windows independently", () => {
	assertEquals(
		parseCodexUsage({
			rate_limit: {
				primary_window: {
					used_percent: "22",
					limit_window_seconds: 18_000,
					reset_at: null,
				},
				secondary_window: null,
			},
		}),
		{
			primary: {
				usedPercent: 22,
				windowSeconds: 18_000,
				resetsAt: undefined,
			},
			secondary: undefined,
		},
	);
});

Deno.test("keeps valid Codex windows when another window is malformed", () => {
	assertEquals(
		parseCodexUsage({
			rate_limit: {
				primary_window: { used_percent: 10 },
				secondary_window: { used_percent: "invalid" },
			},
		}),
		{
			primary: {
				usedPercent: 10,
				windowSeconds: undefined,
				resetsAt: undefined,
			},
			secondary: undefined,
		},
	);
});

Deno.test("formats Codex windows from their reported duration", () => {
	assertEquals(
		formatCodexUsage({
			primary: { usedPercent: 22, windowSeconds: 604_800 },
		}),
		"Weekly 78% ?",
	);
	assertEquals(
		formatCodexUsage({
			primary: { usedPercent: 25, windowSeconds: 18_000 },
			secondary: { usedPercent: 50, windowSeconds: 604_800 },
		}),
		"5 hours 75% ?  Weekly 50% ?",
	);
});

Deno.test("uses legacy labels when Codex omits window durations", () => {
	assertEquals(
		formatCodexUsage({
			primary: { usedPercent: 10 },
			secondary: { usedPercent: 20 },
		}),
		"5 hours 90% ?  Weekly 80% ?",
	);
});
