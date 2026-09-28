import { expect, test } from "bun:test";

import { outputCommand } from "#src/utils/command.ts";

test("outputCommand reports successful commands", async () => {
	const result = await outputCommand(process.execPath, {
		args: ["--eval", "console.log('ok')"],
	});

	expect(result.success).toBe(true);
	expect(result.timedOut).toBe(false);
	expect(new TextDecoder().decode(result.stdout).trim()).toBe("ok");
});

test("outputCommand kills and reports a command that exceeds its timeout", async () => {
	const result = await outputCommand(process.execPath, {
		args: ["--eval", "setTimeout(() => {}, 5_000)"],
		timeout: 500,
	});

	expect(result.success).toBe(false);
	expect(result.timedOut).toBe(true);
});
