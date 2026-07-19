import os from "node:os";

import { dirname, join } from "@std/path";

import { isRecord } from "../utils/type-guards.ts";
import {
	normalizeWorkspaceReviewPreferences,
	type WorkspaceReviewPreferences,
} from "../workspace-review-types.ts";

type AppConfig = Record<string, unknown> & {
	gitView?: WorkspaceReviewPreferences;
};

export async function readWorkspaceReviewPreferences(
	path = configPath(),
): Promise<WorkspaceReviewPreferences> {
	return normalizeWorkspaceReviewPreferences((await readConfig(path)).gitView);
}

export async function writeWorkspaceReviewPreferences(
	preferences: WorkspaceReviewPreferences,
	path = configPath(),
): Promise<void> {
	const config = await readConfig(path);
	config.gitView = normalizeWorkspaceReviewPreferences(preferences);
	await Deno.mkdir(dirname(path), { recursive: true });
	await Deno.writeTextFile(path, `${JSON.stringify(config, null, "\t")}\n`);
}

async function readConfig(path: string): Promise<AppConfig> {
	try {
		const value: unknown = JSON.parse(await Deno.readTextFile(path));
		return isRecord(value) ? value : {};
	} catch (error) {
		if (error instanceof Deno.errors.NotFound || error instanceof SyntaxError)
			return {};
		throw error;
	}
}

function configPath(): string {
	const home = os.homedir();
	if (Deno.build.os === "windows") {
		return join(
			Deno.env.get("APPDATA") ?? join(home, "AppData", "Roaming"),
			"pi-ui",
			"config.json",
		);
	}
	if (Deno.build.os === "darwin") {
		return join(home, "Library", "Application Support", "pi-ui", "config.json");
	}
	return join(
		Deno.env.get("XDG_CONFIG_HOME") ?? join(home, ".config"),
		"pi-ui",
		"config.json",
	);
}
