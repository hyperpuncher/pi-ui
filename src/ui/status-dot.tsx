import { syncHtml } from "./sync-html.ts";

export function StatusDot(props: {
	state: "running" | "success" | "error";
	label: string;
	class?: string;
	runningClass?: string;
}): string {
	const statusClass =
		props.state === "error" ? "tool-status-error" : "tool-status-success";
	const running = props.state === "running";
	return syncHtml(
		<span class={["status-dot", props.class]} aria-label={props.label} role="status">
			<span
				class={[
					"tool-status-ball tool-status-active status-dot-layer",
					props.runningClass ?? "status-dot-running",
					running ? "status-visible" : "status-hidden",
				]}
			/>
			<span
				class={[
					"tool-status-ball tool-status-result status-dot-layer",
					statusClass,
					running ? "status-hidden" : "status-visible",
				]}
			/>
			<span
				class={[
					"tool-status-ball tool-status-pulse status-dot-layer",
					running ? "status-pulse" : "status-hidden",
				]}
			/>
		</span>,
	);
}
