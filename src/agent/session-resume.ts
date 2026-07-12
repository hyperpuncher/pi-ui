import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SessionResumeRuntimeState = {
	streaming: boolean;
	persisted: boolean;
};

export type SessionResumeOperations<TManager, TBackground> = {
	state: () => SessionResumeRuntimeState;
	findBackground: (canonicalPath: string) => TBackground | undefined;
	removeBackground: (canonicalPath: string) => void;
	activateBackground: (session: TBackground) => Promise<void>;
	openSession: (sessionPath: string) => TManager;
	replaceRuntime: (
		manager: TManager,
		action: "background" | "discard" | "dispose",
	) => Promise<void>;
	switchSession: (sessionPath: string) => Promise<{ cancelled: boolean }>;
};

type PathApi = Pick<typeof path, "join" | "resolve">;

type CanonicalPathOptions = {
	homeDir?: string;
	pathApi?: PathApi;
	platform?: typeof Deno.build.os;
};

/** Matches the SDK's lexical resolvePath semantics without reading the session. */
export function canonicalSessionPath(
	input: string,
	options: CanonicalPathOptions = {},
): string {
	const platform = options.platform ?? Deno.build.os;
	const pathApi = options.pathApi ?? path;
	const home = options.homeDir ?? os.homedir();
	let normalized = input;
	if (normalized === "~") {
		normalized = home;
	} else if (
		normalized.startsWith("~/") ||
		(platform === "windows" && normalized.startsWith("~\\"))
	) {
		normalized = pathApi.join(home, normalized.slice(2));
	}
	if (normalized.startsWith("file://")) {
		normalized = fileURLToPath(normalized);
	}
	return pathApi.resolve(normalized);
}

/** Executes one resume while keeping session parsing behind one branch-specific open. */
export async function executeSessionResume<TManager, TBackground>(
	sessionPath: string,
	operations: SessionResumeOperations<TManager, TBackground>,
): Promise<boolean> {
	if (!sessionPath.trim()) return false;

	const canonicalPath = canonicalSessionPath(sessionPath);
	const backgroundSession = operations.findBackground(canonicalPath);
	if (backgroundSession) {
		operations.removeBackground(canonicalPath);
		await operations.activateBackground(backgroundSession);
		return true;
	}

	const state = operations.state();
	if (!state.streaming && state.persisted) {
		const result = await operations.switchSession(sessionPath);
		return !result.cancelled;
	}

	// Open before invalidating the current runtime so malformed paths are harmless.
	const manager = operations.openSession(sessionPath);
	const action = state.streaming
		? state.persisted
			? "background"
			: "discard"
		: "dispose";
	await operations.replaceRuntime(manager, action);
	return true;
}
