const increment = Deno.args.length === 1 ? Deno.args[0] : undefined;
if (!increment || !["patch", "minor", "major"].includes(increment)) {
	throw new Error("usage: deno task release patch|minor|major");
}

if (await output("git", ["status", "--porcelain"])) {
	throw new Error("working tree must be clean");
}

for (const task of ["css:build", "fmt", "lint", "check"]) {
	await run("deno", ["task", task]);
}

if (await output("git", ["status", "--porcelain"])) {
	throw new Error("validation changed files; commit them first");
}

await run("deno", ["bump-version", increment]);
const tag = `v${await output("deno", ["bump-version"])}`;

await run("git", ["add", "deno.json"]);
await run("git", ["commit", "-m", "chore: bump version"]);
await run("git", ["tag", "-a", tag, "-m", tag]);

console.log(`\ncreated ${tag}; push with:`);
console.log(`  git push origin main ${tag}`);

async function run(command: string, args: string[]): Promise<void> {
	const status = await new Deno.Command(command, {
		args,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	}).spawn().status;
	if (!status.success) throw new Error(`${command} failed`);
}

async function output(command: string, args: string[]): Promise<string> {
	const result = await new Deno.Command(command, { args }).output();
	if (!result.success) throw new Error(`${command} failed`);
	return new TextDecoder().decode(result.stdout).trim();
}
