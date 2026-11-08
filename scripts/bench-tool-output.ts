// Usage: bun scripts/bench-tool-output.ts [module path]
// Use the same bundled module format on both sides of a strobe run comparison.
import { resolve } from "node:path";

import { compactToolOutput as compact } from "#src/agent/tool-presentation.ts";

const compactToolOutput: typeof compact = process.argv[2]
	? (await import(resolve(process.argv[2]))).compactToolOutput
	: compact;

const cases = [
	{ lines: 7, repeats: 100_000 },
	{ lines: 2_000, repeats: 1_000 },
	{ lines: 200_000, repeats: 100 },
];
let bytes = 0;
for (const { lines, repeats } of cases) {
	const line = "src/example.ts:42: benchmark tool output";
	const text = `${Array.from({ length: lines }, () => line).join("\n")}\n`;
	const expected =
		lines <= 7
			? text.trimEnd()
			: `... (${lines - 4} earlier lines)\n${Array.from({ length: 4 }, () => line).join("\n")}`;
	for (let index = 0; index < repeats; index++) {
		const result = compactToolOutput(text);
		if (result !== expected) throw new Error(`Incorrect preview for ${lines} lines`);
		bytes += result.length;
	}
}
console.log(`preview bytes: ${bytes}`);
