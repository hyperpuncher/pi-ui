import type { AgentSessionRuntime, PromptOptions } from "@earendil-works/pi-coding-agent";

import { errorMessage } from "../utils/errors.ts";

export type PromptStreamingBehavior = NonNullable<PromptOptions["streamingBehavior"]>;
export type RuntimePromptOptions = Pick<PromptOptions, "images" | "streamingBehavior">;

type PromptState = {
	appendMessage(role: "system", text: string): void;
	setQueuedMessages(steering: readonly string[], followUp: readonly string[]): void;
};

type CompactionQueuedPrompt = {
	text: string;
	images?: RuntimePromptOptions["images"];
	streamingBehavior: PromptStreamingBehavior;
};

/** Owns prompt acceptance and queue state for foreground and background runtimes. */
export class PromptLifecycle {
	private readonly pending = new Map<AgentSessionRuntime, number>();
	private readonly compactionQueues = new Map<
		AgentSessionRuntime,
		CompactionQueuedPrompt[]
	>();

	constructor(
		private readonly stateFor: (
			runtime: AgentSessionRuntime,
		) => PromptState | undefined,
	) {}

	hasPending(runtime: AgentSessionRuntime): boolean {
		return (this.pending.get(runtime) ?? 0) > 0;
	}

	async submit(
		runtime: AgentSessionRuntime,
		text: string,
		options: RuntimePromptOptions = {},
	): Promise<boolean> {
		let resolveAccepted: (accepted: boolean) => void = () => {};
		let settled = false;
		const accepted = new Promise<boolean>((resolve) => {
			resolveAccepted = (value) => {
				if (settled) return;
				settled = true;
				resolve(value);
			};
		});

		this.markPending(runtime);
		runtime.session
			.prompt(text, {
				images: options.images,
				streamingBehavior: runtime.session.isStreaming
					? (options.streamingBehavior ?? "steer")
					: undefined,
				preflightResult: resolveAccepted,
			})
			.catch((error: ErrorOptions["cause"]) => {
				resolveAccepted(false);
				this.reportError(runtime, error);
			})
			.finally(() => this.markSettled(runtime));

		return await accepted;
	}

	queueAfterCompaction(
		runtime: AgentSessionRuntime,
		text: string,
		streamingBehavior: PromptStreamingBehavior,
		images?: RuntimePromptOptions["images"],
	): void {
		const queued = this.compactionQueues.get(runtime) ?? [];
		queued.push({ text, images, streamingBehavior });
		this.compactionQueues.set(runtime, queued);
		this.sync(runtime);
	}

	restore(runtime: AgentSessionRuntime): string {
		const compactionQueued = this.compactionQueues.get(runtime) ?? [];
		this.compactionQueues.delete(runtime);
		const { steering, followUp } = runtime.session.clearQueue();
		this.stateFor(runtime)?.setQueuedMessages([], []);
		return [
			...steering,
			...compactionQueued
				.filter((prompt) => prompt.streamingBehavior === "steer")
				.map((prompt) => prompt.text),
			...followUp,
			...compactionQueued
				.filter((prompt) => prompt.streamingBehavior === "followUp")
				.map((prompt) => prompt.text),
		].join("\n\n");
	}

	async remove(
		runtime: AgentSessionRuntime,
		streamingBehavior: PromptStreamingBehavior,
		index: number,
	): Promise<boolean> {
		const runtimeQueued =
			streamingBehavior === "steer"
				? runtime.session.getSteeringMessages()
				: runtime.session.getFollowUpMessages();
		const compactionQueued = this.compactionQueues.get(runtime) ?? [];
		const matchingCompactionIndexes = compactionQueued.flatMap((prompt, index) =>
			prompt.streamingBehavior === streamingBehavior ? [index] : [],
		);
		if (index >= runtimeQueued.length + matchingCompactionIndexes.length) {
			return false;
		}

		if (index >= runtimeQueued.length) {
			compactionQueued.splice(
				matchingCompactionIndexes[index - runtimeQueued.length],
				1,
			);
			if (compactionQueued.length === 0) this.compactionQueues.delete(runtime);
			this.sync(runtime);
			return true;
		}

		// AgentSession has no single-item removal API, so rebuild its tracked queues.
		const queued = runtime.session.clearQueue();
		queued[streamingBehavior === "steer" ? "steering" : "followUp"].splice(index, 1);
		try {
			for (const text of queued.steering) await runtime.session.steer(text);
			for (const text of queued.followUp) await runtime.session.followUp(text);
		} catch (error) {
			this.reportError(runtime, error);
		}
		this.sync(runtime);
		return true;
	}

	sync(runtime: AgentSessionRuntime): void {
		const compactionQueued = this.compactionQueues.get(runtime) ?? [];
		this.stateFor(runtime)?.setQueuedMessages(
			[
				...runtime.session.getSteeringMessages(),
				...compactionQueued
					.filter((prompt) => prompt.streamingBehavior === "steer")
					.map((prompt) => prompt.text),
			],
			[
				...runtime.session.getFollowUpMessages(),
				...compactionQueued
					.filter((prompt) => prompt.streamingBehavior === "followUp")
					.map((prompt) => prompt.text),
			],
		);
	}

	async flushCompactionQueue(runtime: AgentSessionRuntime): Promise<void> {
		const queued = this.compactionQueues.get(runtime);
		if (!queued?.length) return;
		this.compactionQueues.delete(runtime);
		this.sync(runtime);

		for (let index = 0; index < queued.length; index += 1) {
			const prompt = queued[index];
			if (
				await this.submit(runtime, prompt.text, {
					images: prompt.images,
					streamingBehavior: prompt.streamingBehavior,
				})
			)
				continue;

			this.compactionQueues.set(runtime, queued.slice(index));
			this.sync(runtime);
			return;
		}
	}

	clear(runtime: AgentSessionRuntime): void {
		this.compactionQueues.delete(runtime);
	}

	dispose(): void {
		this.pending.clear();
		this.compactionQueues.clear();
	}

	private markPending(runtime: AgentSessionRuntime): void {
		this.pending.set(runtime, (this.pending.get(runtime) ?? 0) + 1);
	}

	private markSettled(runtime: AgentSessionRuntime): void {
		const pending = (this.pending.get(runtime) ?? 1) - 1;
		if (pending > 0) this.pending.set(runtime, pending);
		else this.pending.delete(runtime);
	}

	private reportError(
		runtime: AgentSessionRuntime,
		error: ErrorOptions["cause"],
	): void {
		this.stateFor(runtime)?.appendMessage("system", errorMessage(error));
	}
}
