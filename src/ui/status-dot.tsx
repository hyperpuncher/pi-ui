import { syncHtml } from "./sync-html.ts";

export function StatusDot(props: {
	state: "running" | "success" | "error";
	label: string;
	class?: string;
	runningClass?: string;
}): string {
	const statusClass =
		props.state === "error" ? "pi-tool-status-error" : "pi-tool-status-success";
	const running = props.state === "running";
	return syncHtml(
		<span
			class={["inline-grid size-2 shrink-0 *:[grid-area:1/1]", props.class]}
			aria-label={props.label}
			role="status"
		>
			<span
				class={[
					"pi-tool-status-ball pi-tool-status-active transition-opacity duration-500 ease-out motion-reduce:transition-none",
					props.runningClass ?? "text-muted-foreground",
					running ? "opacity-100" : "opacity-0",
				]}
			/>
			<span
				class={[
					"pi-tool-status-ball pi-tool-status-result transition-opacity duration-500 ease-out motion-reduce:transition-none",
					statusClass,
					running ? "opacity-0" : "opacity-100",
				]}
			/>
			<span
				class={[
					"pi-tool-status-ball pi-tool-status-pulse transition-opacity duration-500 ease-out motion-reduce:animate-none motion-reduce:transition-none",
					running ? "animate-ping" : "opacity-0",
				]}
			/>
		</span>,
	);
}
