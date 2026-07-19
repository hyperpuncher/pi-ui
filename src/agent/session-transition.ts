export type SessionLeaveAction = "background" | "discard" | "dispose" | "keep";

export type SessionLeaveState = {
	persisted: boolean;
	running: boolean;
	requiresNewRuntime: boolean;
};

export function classifySessionLeave({
	persisted,
	running,
	requiresNewRuntime,
}: SessionLeaveState): SessionLeaveAction {
	if (running) {
		return persisted ? "background" : "discard";
	}
	return requiresNewRuntime ? "dispose" : "keep";
}

export type RuntimeTransitionLifecycle = {
	action: SessionLeaveAction;
	unsubscribe: () => void;
	abort: () => Promise<void>;
	dispose: () => Promise<void> | void;
	background: () => void;
	bindReplacement: () => void | Promise<void>;
	onAbortError?: (error: unknown) => void;
};

/** Runs the ownership hand-off in a deterministic order without depending on SDK types. */
export async function transitionRuntime({
	action,
	unsubscribe,
	abort,
	dispose,
	background,
	bindReplacement,
	onAbortError,
}: RuntimeTransitionLifecycle): Promise<void> {
	if (action === "background") {
		background();
	} else if (action === "discard") {
		unsubscribe();
		try {
			await abort();
		} catch (error) {
			onAbortError?.(error);
		}
		await dispose();
	} else if (action === "dispose") {
		unsubscribe();
		await dispose();
	}
	await bindReplacement();
}
