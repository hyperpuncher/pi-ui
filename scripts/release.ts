const increment = process.argv.length === 3 ? process.argv[2] : undefined;
if (!increment || !["patch", "minor", "major"].includes(increment)) {
	throw new Error("usage: bun run release patch|minor|major");
}

if (await output("git", ["status", "--porcelain"])) {
	throw new Error("working tree must be clean");
}

for (const task of ["fmt", "lint", "check", "test", "build"]) {
	await run("bun", ["run", task]);
}

if (await output("git", ["status", "--porcelain"])) {
	throw new Error("validation changed files; commit them first");
}

const tag = await output("bun", [
	"pm",
	"version",
	increment,
	"--message",
	"chore: bump version",
]);
await run("git", ["push", "origin", "main", tag]);
console.log(`\ncreated and pushed ${tag}`);

async function run(command: string, args: string[]): Promise<void> {
	const child = Bun.spawn([command, ...args], {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await child.exited) !== 0) throw new Error(`${command} failed`);
}

async function output(command: string, args: string[]): Promise<string> {
	const child = Bun.spawn([command, ...args], { stderr: "inherit" });
	const [stdout, code] = await Promise.all([
		new Response(child.stdout).text(),
		child.exited,
	]);
	if (code !== 0) throw new Error(`${command} failed`);
	return stdout.trim();
}
