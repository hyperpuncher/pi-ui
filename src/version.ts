import packageJson from "../package.json" with { type: "json" };

export function isVersionRequest(args: readonly string[]): boolean {
	return args.length === 1 && args[0] === "--version";
}

export const version = packageJson.version;
