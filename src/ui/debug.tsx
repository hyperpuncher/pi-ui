import type { AppStateSnapshot } from "#src/state/app-store.ts";
import { syncHtml } from "#src/ui/sync-html.ts";

export function renderDebugOverlay(state: AppStateSnapshot): string {
	if (!state.debugUi) return "";

	return syncHtml(
		<aside id="debug-overlay" class="debug-panel" aria-label="Debug information">
			<dl class="debug-values">
				<dt title="Animation callbacks per second, not displayed frames. Sampled over one second.">
					rate hz
				</dt>
				<dd id="debug-frame-rate" data-ignore-morph>
					—
				</dd>
				<dt title="Median interval between animation callbacks.">p50 ms</dt>
				<dd id="debug-frame-median" data-ignore-morph>
					—
				</dd>
				<dt title="95% of callback intervals are at or below this value.">
					p95 ms
				</dt>
				<dd id="debug-frame-p95" data-ignore-morph>
					—
				</dd>
				<dt title="Longest callback interval in the sample.">max ms</dt>
				<dd id="debug-frame-max" data-ignore-morph>
					—
				</dd>
				<dt>messages</dt>
				<dd>{state.messages.length}</dd>
			</dl>
		</aside>,
	);
}
