// Compare shell-title highlighting strategies on real session commands.
// Usage: bun scripts/bench-highlight.ts <session.jsonl> <full|base|raw|scan> [iterations]
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getHighlighterIfLoaded } from "@pierre/diffs";

import { TranscriptProjector } from "#src/agent/transcript-projector.ts";
import { activeCodeThemes } from "#src/pierre-theme.ts";
import { highlightBash, highlightCodemode } from "#src/ui/bash-highlight.ts";
import { loadPierreLanguage } from "#src/ui/diffs.ts";
import { scanShell } from "#src/ui/shell-scanner.ts";

const sessionPath = process.argv[2];
const mode = process.argv[3];
const iterations = Number(process.argv[4] ?? 20);
if (
	!sessionPath ||
	(mode !== "full" && mode !== "base" && mode !== "raw" && mode !== "scan")
)
	throw new Error("usage: bun scripts/bench-highlight.ts <session> <mode>");

const manager = SessionManager.open(sessionPath);
const projector = new TranscriptProjector();
const pending = new Map();
const parts = manager
	.getEntries()
	.flatMap((entry) => projector.entry(entry, pending))
	.flatMap((message) => message.titleParts ?? [])
	.filter((part) => part.highlight);
const bash = parts.filter((part) => part.highlight === "bash");
const code = parts.filter((part) => part.highlight === "javascript");

await loadPierreLanguage("bash");
const highlighter = getHighlighterIfLoaded()!;
const highlightRaw = (text: string, lang: string) =>
	highlighter.codeToTokens(text, { lang, themes: activeCodeThemes });
const bashRuns = {
	full: (text: string) => highlightBash(text, { format: true }),
	base: (text: string) => highlightBash(text),
	raw: (text: string) => highlightRaw(text, "bash"),
	scan: (text: string) => scanShell(text),
};
const codeRuns = {
	full: (text: string) => highlightCodemode(text),
	base: (text: string) => highlightCodemode(text),
	raw: (text: string) => highlightRaw(text, "javascript"),
	scan: () => {},
};
const runBash = bashRuns[mode];
const runCode = codeRuns[mode];
const run = () => {
	for (const part of bash) runBash(part.text);
	for (const part of code) runCode(part.text);
};

run();
const samples: number[] = [];
for (let index = 0; index < iterations; index++) {
	const start = performance.now();
	run();
	samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)]!;
const bytes = parts.reduce((sum, part) => sum + part.text.length, 0);
console.log(
	JSON.stringify({
		mode,
		commands: parts.length,
		bash: bash.length,
		javascript: code.length,
		bytes,
		iterations,
		medianMs: median,
		perCommandUs: (median * 1000) / parts.length,
	}),
);
