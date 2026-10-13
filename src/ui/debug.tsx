import type { AppStateSnapshot } from "#src/state/app-store.ts";
import { syncHtml } from "#src/ui/sync-html.ts";

export function renderDebugOverlay(state: AppStateSnapshot): string {
	if (!state.debugUi) return "";

	return syncHtml(
		<aside id="debug-overlay" class="debug-panel" aria-label="Debug information">
			<div class="debug-title">debug</div>
			<dl class="debug-values">
				<dt title="Animation callbacks per second, not displayed frames. Sampled over one second.">
					frame rate
				</dt>
				<dd id="debug-frame-rate" data-ignore-morph>
					—
				</dd>
				<dt title="Median interval between animation callbacks.">frame median</dt>
				<dd id="debug-frame-median" data-ignore-morph>
					—
				</dd>
				<dt title="95% of callback intervals are at or below this value.">
					frame p95
				</dt>
				<dd id="debug-frame-p95" data-ignore-morph>
					—
				</dd>
				<dt title="Longest callback interval in the sample.">frame max</dt>
				<dd id="debug-frame-max" data-ignore-morph>
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
