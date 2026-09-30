import { resolvePath } from "../../node_modules/@earendil-works/pi-coding-agent/dist/utils/paths.js";

export type SessionResumeRuntimeState = {
	active: boolean;
	persisted: boolean;
};

export type SessionResumeOperations<TManager, TBackground> = {
	state: () => SessionResumeRuntimeState;
	findBackground: (canonicalPath: string) => TBackground | undefined;
	activateBackground: (canonicalPath: string, session: TBackground) => Promise<void>;
	openSession: (sessionPath: string) => TManager;
	replaceRuntime: (
		manager: TManager,
		action: "background" | "discard" | "dispose",
	) => Promise<void>;
	switchSession: (sessionPath: string) => Promise<{ cancelled: boolean }>;
};

/** Executes one resume while keeping session parsing behind one branch-specific open. */
export async function executeSessionResume<TManager, TBackground>(
	sessionPath: string,
	operations: SessionResumeOperations<TManager, TBackground>,
): Promise<boolean> {
	if (!sessionPath.trim()) return false;

	const canonicalPath = resolvePath(sessionPath);
	const backgroundSession = operations.findBackground(canonicalPath);
	if (backgroundSession) {
		// Ownership stays in the background registry until activation commits.
		await operations.activateBackground(canonicalPath, backgroundSession);
		return true;
	}

	const state = operations.state();
	if (!state.active && state.persisted) {
		const result = await operations.switchSession(sessionPath);
		return !result.cancelled;
	}

	// Open before invalidating the current runtime so malformed paths are harmless.
	const manager = operations.openSession(sessionPath);
	const action = state.active
		? state.persisted
			? "background"
			: "discard"
		: "dispose";
	await operations.replaceRuntime(manager, action);
	return true;
}
