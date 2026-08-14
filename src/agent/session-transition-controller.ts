import { errorMessage } from "../utils/errors.ts";

export type SessionTransitionState =
	| { status: "idle"; generation: number }
	| {
			status: "loading";
			generation: number;
			targetPath: string;
			overlay: boolean;
	  }
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

export function sessionTransitionOverlayVisible(
	transition: SessionTransitionState,
): boolean {
	return (
		transition.status === "error" ||
		(transition.status === "loading" && transition.overlay)
	);
}

/** Serializes foreground runtime changes. New requests are ignored while one runs. */
export class SessionTransitionController {
	private generation = 0;
	private loading = false;

	constructor(private readonly update: (state: SessionTransitionState) => void) {
		this.update({ status: "idle", generation: this.generation });
	}

	async run(
		targetPath: string,
		operation: (generation: number) => boolean | Promise<boolean>,
		options: { overlay?: boolean } = {},
	): Promise<SessionTransitionResult> {
		if (this.loading) return { status: "busy" };

		this.loading = true;
		this.generation += 1;
		const generation = this.generation;
		this.update({
			status: "loading",
			generation,
			targetPath,
			overlay: options.overlay ?? true,
		});
		try {
			const completed = await operation(generation);
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

function formatTransitionError(error: ErrorOptions["cause"]): string {
	const message = errorMessage(error);
	return message.trim() || "Session transition failed.";
}
