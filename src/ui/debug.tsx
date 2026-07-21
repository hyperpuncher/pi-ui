import type { AppRenderSnapshot } from "../state/app-store.ts";

export function renderDebugOverlay(state: AppRenderSnapshot): string {
	if (!state.debugUi) return "";

	return (
		<aside
			id="debug-overlay"
			class="fixed top-3 right-3 z-50 hidden min-w-44 rounded-md border bg-popover/95 p-2 font-mono text-[0.65rem] text-popover-foreground shadow-lg backdrop-blur md:block"
			aria-label="Debug information"
		>
			<div class="mb-1 text-muted-foreground uppercase">debug</div>
			<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<dt class="text-muted-foreground">fps</dt>
				<dd id="debug-fps">—</dd>
				<dt class="text-muted-foreground">messages</dt>
				<dd>{state.messages.length}</dd>
				<dt class="text-muted-foreground">activity</dt>
				<dd safe>{state.activityText ?? "idle"}</dd>
			</dl>
		</aside>
	) as string;
}
