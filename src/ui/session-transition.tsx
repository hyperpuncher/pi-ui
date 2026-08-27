import { sessionTransitionOverlayVisible } from "../agent/session-transition-controller.ts";
import { sessionPerformance } from "../perf/session-performance.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { primaryModifierExpression } from "../utils/keyboard.ts";
import { Icon } from "./icon.tsx";
import { Loader } from "./icons.ts";
import { syncHtml } from "./sync-html.ts";

export function resumeSessionAction(
	path: string,
	options: { closeDialog?: boolean } = {},
): string {
	return `if (!$_sessionLoading && !$_sessionTransitionLoading) {
		${options.closeDialog ? "document.getElementById('session-dialog')?.close();" : ""}
		window.piUi.sessionPerformance.start();
		@post('${endpoints.sessionsResume}', {
			payload: { sessionPath: ${JSON.stringify(path)} },
		});
	}`;
}

export function resumeSessionShortcutAction(path: string, index: number): string {
	return `if (${primaryModifierExpression()} && evt.code === 'Digit${index + 1}') {
		evt.preventDefault();
		${resumeSessionAction(path)}
	}`;
}

export function renderSessionTransition(state: AppStateSnapshot): string {
	const transition = state.sessionTransition;
	const visible = sessionTransitionOverlayVisible(transition);
	const targetPath = transition.status === "idle" ? "" : transition.targetPath;
	return syncHtml(
		<main
			id="session-transition"
			class="col-start-1 row-start-1 grid min-h-0 place-items-center px-6 text-center"
			style={visible ? undefined : "display: none"}
			data-show="$_sessionTransitionVisible"
			role={transition.status === "error" ? "alert" : "status"}
			aria-live="polite"
			aria-busy={transition.status === "loading" ? "true" : "false"}
			data-session-performance-enabled={sessionPerformance.enabled}
			data-effect={
				sessionPerformance.enabled &&
				"window.piUi.sessionPerformance.observe($_sessionTransitionStatus, $_sessionTransitionGeneration)"
			}
		>
			{transition.status === "error" ? (
				<div class="max-w-lg">
					<p class="pi-error-foreground m-0 font-medium">
						Session transition failed
					</p>
					<p class="mt-2 mb-0 text-sm text-muted-foreground" safe>
						{transition.message}
					</p>
				</div>
			) : (
				<div class="flex flex-col items-center text-muted-foreground">
					<Icon icon={Loader} class="size-5 animate-spin" />
					<span class="sr-only" safe>
						{targetPath}
					</span>
				</div>
			)}
		</main>,
	);
}
