interface Config {
	imports: Record<string, string>;
}

const main = await readConfig("deno.json");
const client = await readConfig("deno.client.json");

for (const dependency of Object.keys(client.imports)) {
	const version = main.imports[dependency];
	if (!version) throw new Error(`${dependency} is missing from deno.json`);
	if (/@[~^]/.test(version)) {
		throw new Error(`${dependency} must use an exact version in deno.json`);
	}
	client.imports[dependency] = version;
}

await Deno.writeTextFile("deno.client.json", `${JSON.stringify(client, null, "\t")}\n`);

async function readConfig(path: string): Promise<Config> {
	// SAFETY: both project configs define a string-to-string imports map.
	return JSON.parse(await Deno.readTextFile(path)) as Config;
}
