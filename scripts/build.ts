import { mkdir } from "node:fs/promises";

const nativeAssets: string[] = [];
const nativeGlob = new Bun.Glob("**/*.node");
for await (const path of nativeGlob.scan({
	absolute: true,
	cwd: "node_modules/@bruits",
	onlyFiles: true,
})) {
	nativeAssets.push(path);
}
if (nativeAssets.length === 0) {
	throw new Error("No Satteri native binding is installed for this platform");
}
nativeAssets.sort();

await mkdir("dist", { recursive: true });
const command = [
	process.execPath,
	"build",
	"--compile",
	"--minify",
	"--sourcemap",
	"--asset",
	"./static",
	...nativeAssets.flatMap((path) => ["--asset", path]),
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
