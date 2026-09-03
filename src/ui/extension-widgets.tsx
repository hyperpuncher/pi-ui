import type { AppExtensionWidget, AppStateSnapshot } from "../state/app-store.ts";
import { syncHtml } from "./sync-html.ts";

export function renderExtensionWidgets(
	state: Pick<AppStateSnapshot, "extensionWidgets">,
	placement: AppExtensionWidget["placement"],
): string {
	const id =
		placement === "aboveEditor"
			? "extension-widgets-above"
			: "extension-widgets-below";
	return syncHtml(
		<div id={id} class="extension-widgets" aria-live="polite">
			{state.extensionWidgets
				.filter((widget) => widget.placement === placement)
				.map((widget) => (
					<div class="extension-widget" data-extension-widget={widget.key}>
						{widget.lines.map((line) => (
							<div safe>{line}</div>
						))}
					</div>
				))}
		</div>,
	);
}
