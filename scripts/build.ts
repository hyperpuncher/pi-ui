import { mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
const command = [
	process.execPath,
	"build",
	"--compile",
	"--minify",
	"--sourcemap",
	"--asset",
	"./static",
	"src/server-main.ts",
	"--outfile",
	"./dist/pi-ui-server",
];
const child = Bun.spawn(command, {
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});
const exitCode = await child.exited;
if (exitCode !== 0) process.exit(exitCode);
