import type { AppStateSnapshot } from "../state/app-store.ts";
import { renderWorkspacePicker, renderWorktreePicker } from "./prompt-pickers.tsx";
import { syncHtml } from "./sync-html.ts";
import { renderUpdateBadge, renderUpdatePopover } from "./update-indicator.tsx";

/** Left context cluster: workspace, branch, and update controls. */
export function renderPromptStart(state: AppStateSnapshot): string {
	const update = state.updateAvailable;
	return syncHtml(
		<div id="prompt-start" class="prompt-start">
			{renderWorkspacePicker(state)}
			{renderWorktreePicker(state)}
			{update && (
				<span class="update-anchor">
					{renderUpdateBadge(update)}
					{renderUpdatePopover(update)}
				</span>
			)}
		</div>,
	);
}
