import type { BackgroundSessionStatus } from "../state/app-state.ts";

export type OwnedBackgroundRuntime = {
	generation: number;
	status: BackgroundSessionStatus;
	observedRunning: boolean;
};

export type RuntimeActivation<T> = {
	runtime: T;
	commit(): void;
	rollback(): void;
};

/** Rejects delayed lifecycle callbacks from a runtime that no longer owns foreground. */
export function ownsForegroundRuntime<T>(current: T, callbackOwner: T): boolean {
	return current === callbackOwner;
}

export class RuntimeOwnershipInvariantError extends Error {
	constructor(message = "Runtime ownership invariant failed") {
		super(message);
		this.name = "RuntimeOwnershipInvariantError";
	}
}

/**
 * Keeps a background generation owned until foreground activation commits.
 * Paths are intentionally confined to lookup keys and never exposed by diagnostics.
 */
export class BackgroundRuntimeOwnership<T extends OwnedBackgroundRuntime> {
	private readonly runtimes = new Map<string, T>();
	private nextGeneration = 1;
	private failures = 0;

	allocateGeneration(): number {
		return this.nextGeneration++;
	}

	get invariantFailureCount(): number {
		return this.failures;
	}

	get size(): number {
		return this.runtimes.size;
	}

	get(path: string): T | undefined {
		return this.runtimes.get(path);
	}

	has(path: string): boolean {
		return this.runtimes.has(path);
	}

	values(): IterableIterator<T> {
		return this.runtimes.values();
	}

	entries(): IterableIterator<[string, T]> {
		return this.runtimes.entries();
	}

	register(path: string, runtime: T): void {
		const existing = this.runtimes.get(path);
		if (existing && existing !== runtime) {
			this.failures += 1;
			throw new RuntimeOwnershipInvariantError();
		}
		this.runtimes.set(path, runtime);
	}

	delete(path: string): boolean {
		return this.runtimes.delete(path);
	}

	beginActivation(path: string): RuntimeActivation<T> | undefined {
		const runtime = this.runtimes.get(path);
		if (!runtime) return undefined;
		let settled = false;
		return {
			runtime,
			commit: () => {
				if (settled) return;
				settled = true;
				if (this.runtimes.get(path) !== runtime) {
					this.failures += 1;
					throw new RuntimeOwnershipInvariantError();
				}
				this.runtimes.delete(path);
			},
			rollback: () => {
				settled = true;
			},
		};
	}

	liveCount(foregroundActive: boolean): number {
		let count = foregroundActive ? 1 : 0;
		for (const runtime of this.runtimes.values()) {
			if (runtime.status === "running" || runtime.observedRunning) count += 1;
		}
		return count;
	}

	clear(): void {
		this.runtimes.clear();
	}
}
