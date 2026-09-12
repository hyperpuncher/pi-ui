import type { AppStateSnapshot } from "../state/app-store.ts";
import { renderWorkspacePicker } from "./prompt-pickers.tsx";
import { syncHtml } from "./sync-html.ts";
import { renderUpdateBadge, renderUpdatePopover } from "./update-indicator.tsx";

/** Left context cluster: workspace picker plus the update notice. */
export function renderPromptStart(state: AppStateSnapshot): string {
	const update = state.updateAvailable;
	return syncHtml(
		<div id="prompt-start" class="prompt-start">
			{renderWorkspacePicker(state)}
			{update && renderUpdateBadge(update)}
			{update && renderUpdatePopover(update)}
		</div>,
	);
}
