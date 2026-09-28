const project = await Bun.file(new URL("../package.json", import.meta.url)).json();
const pi = await Bun.file(
	new URL(
		"../node_modules/@earendil-works/pi-coding-agent/package.json",
		import.meta.url,
	),
).json();

if (project.devDependencies.typebox !== pi.dependencies.typebox) {
	throw new Error(
		`TypeBox must match Pi's ${pi.dependencies.typebox}. Run: bun add --dev typebox@${pi.dependencies.typebox}`,
	);
}
