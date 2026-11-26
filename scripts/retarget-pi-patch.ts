import { $ } from "bun";

import packageJson from "#package";
import { version } from "#pi/package.json";

const prefix = "@earendil-works/pi-coding-agent@";
const patch = "patches/pi-sdk-version.patch";
const otherPatches = Object.entries(packageJson.patchedDependencies).filter(
	([key, file]) => !key.startsWith(prefix) || file !== patch,
);
const patchedDependencies = Object.fromEntries([
	...otherPatches,
	[`${prefix}${version}`, patch],
]);

await Bun.write(
	"package.json",
	`${JSON.stringify({ ...packageJson, patchedDependencies }, null, "\t")}\n`,
);
await $`bun install`;
await $`bun test tests/src/agent/bundled-catalog.test.ts`;
