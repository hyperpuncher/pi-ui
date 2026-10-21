import { expect, test } from "bun:test";

test("refreshes running and restored tool titles after the highlighter loads", async () => {
	const child = Bun.spawn(
		[process.execPath, `${import.meta.dir}/bash-highlight-loading-fixture.ts`],
		{
			cwd: `${import.meta.dir}/../../..`,
			stdout: "ignore",
			stderr: "pipe",
		},
	);
	const error = await new Response(child.stderr).text();
	expect({ exitCode: await child.exited, error }).toEqual({ exitCode: 0, error: "" });
});
