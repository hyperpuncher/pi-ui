import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import type { BackgroundSessionStatus } from "../state/app-store.ts";
import type { TranscriptState } from "../state/transcript-state.ts";
import { BackgroundRuntimeOwnership } from "./background-runtime-ownership.ts";

export type BackgroundSession = {
	runtime: AgentSessionRuntime;
	state: TranscriptState;
	status: BackgroundSessionStatus;
	generation: number;
	observedRunning: boolean;
	toolMessageIds: Map<string, string>;
	toolPreviewMessages: Map<number, { id: string; argumentPrefix: string | undefined }>;
	toolCallArgs: Map<string, unknown>;
	toolStartedAt: Map<string, number>;
	unsubscribe: () => void;
};

/** Owns the generation-aware background registry and subscription transfers. */
export class BackgroundSessionController {
	private readonly ownership = new BackgroundRuntimeOwnership<BackgroundSession>();

	get invariantFailureCount(): number {
		return this.ownership.invariantFailureCount;
	}

	allocateGeneration(): number {
		return this.ownership.allocateGeneration();
	}

	get(path: string): BackgroundSession | undefined {
		return this.ownership.get(path);
	}

	has(path: string): boolean {
		return this.ownership.has(path);
	}

	register(path: string, session: BackgroundSession): void {
		this.ownership.register(path, session);
	}

	beginActivation(path: string) {
		return this.ownership.beginActivation(path);
	}

	delete(path: string): boolean {
		return this.ownership.delete(path);
	}

	entries(): IterableIterator<[string, BackgroundSession]> {
		return this.ownership.entries();
	}

	values(): IterableIterator<BackgroundSession> {
		return this.ownership.values();
	}

	liveCount(foregroundLive: boolean): number {
		return this.ownership.liveCount(foregroundLive);
	}

	unsubscribe(session: BackgroundSession): void {
		const unsubscribe = session.unsubscribe;
		session.unsubscribe = () => {};
		unsubscribe();
	}

	clear(): void {
		this.ownership.clear();
	}
}
