export type SessionTransitionState =
	| { status: "idle"; generation: number }
	| { status: "loading"; generation: number; targetPath: string }
	| {
			status: "error";
			generation: number;
			targetPath: string;
			message: string;
	  };

export type SessionTransitionResult =
	| { status: "success" }
	| { status: "cancelled" }
	| { status: "busy" }
	| { status: "error" };

/** Serializes foreground runtime changes. New requests are ignored while one runs. */
export class SessionTransitionController {
	private generation = 0;
	private loading = false;

	constructor(private readonly update: (state: SessionTransitionState) => void) {
		this.update({ status: "idle", generation: this.generation });
	}

	async run(
		targetPath: string,
		operation: () => boolean | Promise<boolean>,
	): Promise<SessionTransitionResult> {
		if (this.loading) return { status: "busy" };

		this.loading = true;
		this.generation += 1;
		const generation = this.generation;
		this.update({ status: "loading", generation, targetPath });
		try {
			const completed = await operation();
			this.update({ status: "idle", generation });
			return { status: completed ? "success" : "cancelled" };
		} catch (error) {
			this.update({
				status: "error",
				generation,
				targetPath,
				message: formatTransitionError(error),
			});
			return { status: "error" };
		} finally {
			this.loading = false;
		}
	}
}

function formatTransitionError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.trim() || "Session transition failed.";
}
