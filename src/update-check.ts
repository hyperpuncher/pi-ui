import { existsSync } from "node:fs";

import { asRecord, isString } from "./utils/type-guards.ts";
import { version as currentVersion } from "./version.ts";

export type AvailableUpdate = {
	readonly currentVersion: string;
	readonly latestVersion: string;
	readonly releaseUrl: string;
	readonly upgradeCommand: string;
};

const latestVersionUrl = "https://registry.npmjs.org/@hyperpuncher/pi-ui/latest";
const releaseNotesBaseUrl = "https://github.com/hyperpuncher/pi-ui/releases/tag/v";
const requestTimeoutMs = 3000;

type UpdateFetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Resolve the newest published version, or undefined when offline or already current. */
export async function checkForUpdate(
	fetcher: UpdateFetcher = fetch,
	runningVersion: string = currentVersion,
): Promise<AvailableUpdate | undefined> {
	const latestVersion = await fetchLatestVersion(fetcher);
	if (!latestVersion) return undefined;
	if (compareVersions(latestVersion, runningVersion) <= 0) return undefined;
	return {
		currentVersion: runningVersion,
		latestVersion,
		releaseUrl: `${releaseNotesBaseUrl}${latestVersion}`,
		upgradeCommand: upgradeCommand(),
	};
}

async function fetchLatestVersion(fetcher: UpdateFetcher): Promise<string | undefined> {
	try {
		const response = await fetcher(latestVersionUrl, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(requestTimeoutMs),
		});
		if (!response.ok) return undefined;
		const payload: unknown = await response.json();
		const latest = asRecord(payload)?.version;
		return isString(latest) ? latest : undefined;
	} catch {
		// Update checks are best-effort; offline and transient failures are ignored.
		return undefined;
	}
}

/** Compare two dotted versions, returning -1, 0, or 1. Non-semver values compare equal. */
export function compareVersions(left: string, right: string): number {
	const a = parseVersion(left);
	const b = parseVersion(right);
	if (!a || !b) return 0;
	if (a.major !== b.major) return a.major < b.major ? -1 : 1;
	if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
	if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
	if (a.prerelease === b.prerelease) return 0;
	if (a.prerelease === undefined) return 1;
	if (b.prerelease === undefined) return -1;
	return a.prerelease < b.prerelease ? -1 : 1;
}

type ParsedVersion = {
	major: number;
	minor: number;
	patch: number;
	prerelease: string | undefined;
};

function parseVersion(value: string): ParsedVersion | undefined {
	const match =
		/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
			value.trim(),
		);
	if (!match) return undefined;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4],
	};
}

/** Pick the command that upgrades the current installation channel. */
export function upgradeCommand(
	platform: string = process.platform,
	executable: string = process.execPath,
	entry: string = process.argv[1] ?? "",
	archLinux: boolean = existsSync("/etc/arch-release"),
): string {
	if (platform === "win32") return "irm https://pi-ui.app/install.ps1 | iex";
	if (isHomebrewPath(executable)) return "brew upgrade hyperpuncher/tap/pi-ui";
	if (isPackageManagerPath(executable) || isPackageManagerPath(entry))
		return "bun i -g @hyperpuncher/pi-ui";
	if (platform === "linux" && archLinux) return "paru -S pi-ui-bin";
	return "curl -fsSL https://pi-ui.app/install | sh";
}

function isHomebrewPath(path: string): boolean {
	return /[\\/](?:Cellar|homebrew)[\\/]/i.test(path);
}

function isPackageManagerPath(path: string): boolean {
	return /[\\/]node_modules[\\/]|[\\/]\.bun[\\/]install[\\/]/i.test(path);
}
