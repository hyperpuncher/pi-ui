import type { AppStateSnapshot } from "../state/app-store.ts";
import { syncHtml } from "./sync-html.ts";

export function renderDebugOverlay(state: AppStateSnapshot): string {
	if (!state.debugUi) return "";

	return syncHtml(
		<aside id="debug-overlay" class="debug-panel" aria-label="Debug information">
			<div class="debug-title">debug</div>
			<dl class="debug-values">
				<dt>fps</dt>
				<dd id="debug-fps" data-ignore-morph>
					—
				</dd>
				<dt>messages</dt>
				<dd>{state.messages.length}</dd>
				<dt>activity</dt>
				<dd safe>{state.activityText ?? "idle"}</dd>
			</dl>
		</aside>,
	);
}
