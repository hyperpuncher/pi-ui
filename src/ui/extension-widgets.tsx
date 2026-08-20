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
		<div id={id} class="space-y-1" aria-live="polite">
			{state.extensionWidgets
				.filter((widget) => widget.placement === placement)
				.map((widget) => (
					<div
						class="rounded-md bg-muted/60 px-2 py-1.5 font-mono text-xs text-muted-foreground"
						data-extension-widget={widget.key}
					>
						{widget.lines.map((line) => (
							<div safe>{line}</div>
						))}
					</div>
				))}
		</div>,
	);
}
