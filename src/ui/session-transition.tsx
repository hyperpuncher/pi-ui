import { sessionTransitionOverlayVisible } from "#src/agent/session-transition-controller.ts";
import { sessionPerformance } from "#src/perf/session-performance.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";
import type { AppStateSnapshot } from "#src/state/app-store.ts";
import { Icon } from "#src/ui/icon.tsx";
import { syncHtml } from "#src/ui/sync-html.ts";
import { primaryModifierExpression } from "#src/utils/keyboard.ts";

export function resumeSessionAction(
	path: string,
	options: { closeDialog?: boolean } = {},
): string {
	return `if ($_sessionTransitionStatus !== 'loading') {
		${options.closeDialog ? "document.getElementById('session-dialog')?.close();" : ""}
		window.piUi.sessionPerformance.start();
		@post('${endpoints.sessionsResume}', {
			payload: { sessionPath: ${JSON.stringify(path)} },
			retryMaxCount: 0,
		});
	}`;
}

export function resumeSessionShortcutAction(
	path: string,
	index: number,
	options: { inDialog?: boolean } = {},
): string {
	const dialogOpen = "document.getElementById('session-dialog')?.open";
	const scope = options.inDialog ? dialogOpen : `!(${dialogOpen})`;
	return `if (!evt.defaultPrevented && ${scope} && ${primaryModifierExpression()} && !evt.shiftKey && evt.code === 'Digit${index + 1}') {
		evt.preventDefault();
		${resumeSessionAction(path, { closeDialog: options.inDialog })}
	}`;
}

export function previousSessionAction(): string {
	return `if ($_sessionTransitionStatus !== 'loading') {
		document.getElementById('session-dialog')?.close();
		window.piUi.sessionPerformance.start();
		@post('${endpoints.sessionsPrevious}', { payload: {}, retryMaxCount: 0 });
	}`;
}

export function renderSessionTransition(state: AppStateSnapshot): string {
	const transition = state.sessionTransition;
	const visible = sessionTransitionOverlayVisible(transition);
	const targetPath = transition.status === "idle" ? "" : transition.targetPath;
	return syncHtml(
		<main
			id="session-transition"
			class="session-transition"
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
				<div class="session-transition-error">
					<p class="error-foreground session-transition-title">
						Session transition failed
					</p>
					<p class="session-transition-detail" safe>
						{transition.message}
					</p>
				</div>
			) : (
				<div class="session-transition-loading">
					<Icon name="loader" class="icon-spin" />
					<span class="sr-only" safe>
						{targetPath}
					</span>
				</div>
			)}
		</main>,
	);
}
