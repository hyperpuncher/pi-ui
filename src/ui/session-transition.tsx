import { endpoints } from "../server/routes/endpoints.ts";
import type { AppRenderSnapshot } from "../state/app-store.ts";

export function resumeSessionAction(
	path: string,
	options: { closeDialog?: boolean } = {},
): string {
	return `if (!$_sessionLoading && !$sessionTransitionLoading) {
		${options.closeDialog ? "document.getElementById('session-dialog')?.close();" : ""}
		$_sessionTarget = ${JSON.stringify(path)};
		@post('${endpoints.sessionsResume}', {
			payload: { sessionPath: ${JSON.stringify(path)} },
		});
	}`;
}

export function renderSessionTransition(state: AppRenderSnapshot): string {
	const transition = state.sessionTransition;
	const targetPath = transition.status === "idle" ? "" : transition.targetPath;
	return (
		<main
			id="session-transition"
			class="min-h-0 place-items-center px-6 text-center"
			style={transition.status === "idle" ? "display: none" : "display: grid"}
			data-style:display="$_sessionLoading || $sessionTransitionVisible ? 'grid' : 'none'"
			role={transition.status === "error" ? "alert" : "status"}
			aria-live="polite"
			aria-busy={transition.status === "loading" ? "true" : "false"}
		>
			{transition.status === "error" ? (
				<div class="max-w-lg">
					<p class="text-destructive m-0 font-medium">
						Session transition failed
					</p>
					<p class="text-muted-foreground mt-2 mb-0 text-sm" safe>
						{transition.message}
					</p>
				</div>
			) : (
				<div class="text-muted-foreground flex flex-col items-center">
					<svg
						class="size-5 animate-spin"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M12 2v4m4.2 1.8l2.9-2.9M18 12h4m-5.8 4.2l2.9 2.9M12 18v4m-7.1-2.9l2.9-2.9M2 12h4M4.9 4.9l2.9 2.9" />
					</svg>
					<span class="sr-only" safe>
						{targetPath}
					</span>
				</div>
			)}
		</main>
	) as string;
}
