import { existsSync, readFileSync } from "node:fs";

import { comparePackageVersions } from "#pi/utils/version-check.js";
import { asRecord, isString } from "#src/utils/type-guards.ts";
import { version as currentVersion } from "#src/version.ts";

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
	if (comparePackageVersions(latestVersion, runningVersion) !== 1) return undefined;
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

/** Pick the command that upgrades the current installation channel and restarts its service. */
export function upgradeCommand(
	platform: string = process.platform,
	executable: string = process.execPath,
	entry: string = process.argv[1] ?? "",
	archLinux: boolean = existsSync("/etc/arch-release"),
	restart: string | undefined = serviceRestartCommand(),
): string {
	// The quick installers restart the service themselves.
	if (platform === "win32") return "irm https://pi-ui.app/install.ps1 | iex";
	let upgrade = "curl -fsSL https://pi-ui.app/install | sh";
	if (isHomebrewPath(executable)) upgrade = "brew upgrade hyperpuncher/tap/pi-ui";
	else if (isPackageManagerPath(executable) || isPackageManagerPath(entry))
		upgrade = "bun i -g @hyperpuncher/pi-ui";
	else if (platform === "linux" && archLinux) upgrade = "paru -S pi-ui-bin";
	else return upgrade;
	return restart ? `${upgrade} && ${restart}` : upgrade;
}

/** Package managers replace the binary but leave the old server running. */
function serviceRestartCommand(): string | undefined {
	const launchdJob = process.env.XPC_SERVICE_NAME;
	let cgroup = "";
	try {
		cgroup = readFileSync("/proc/self/cgroup", "utf8");
	} catch {
		// Only Linux has cgroups.
	}
	if (
		launchdJob === "homebrew.mxcl.pi-ui" ||
		launchdJob === "sh.brew.pi-ui" ||
		cgroup.includes("/homebrew.pi-ui.service")
	)
		return "brew services restart pi-ui";
	if (launchdJob === "dev.pi.ui" || cgroup.includes("/pi-ui.service"))
		return "pi-ui service install";
	return undefined;
}

function isHomebrewPath(path: string): boolean {
	return /[\\/](?:Cellar|homebrew)[\\/]/i.test(path);
}

function isPackageManagerPath(path: string): boolean {
	return /[\\/]node_modules[\\/]|[\\/]\.bun[\\/]install[\\/]/i.test(path);
}
