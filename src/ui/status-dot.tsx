export function StatusDot(props: {
	state: "running" | "success" | "error";
	label: string;
	dataStatus?: string;
	class?: string;
	runningClass?: string;
}): string {
	const statusClass =
		props.state === "error" ? "pi-tool-status-error" : "pi-tool-status-success";
	const running = props.state === "running";
	return (
		<span
			class={["inline-grid size-2 shrink-0 *:[grid-area:1/1]", props.class]}
			aria-label={props.label}
			role="status"
			data-background-status={props.dataStatus}
		>
			<span
				class={[
					"pi-tool-status-ball transition-opacity duration-500 ease-out motion-reduce:transition-none",
					props.runningClass ?? "text-muted-foreground",
					running ? "opacity-100" : "opacity-0",
				]}
			/>
			<span
				class={[
					"pi-tool-status-ball transition-opacity duration-500 ease-out motion-reduce:transition-none",
					statusClass,
					running ? "opacity-0" : "opacity-100",
				]}
			/>
			<span
				class={[
					"pi-tool-status-ball transition-opacity duration-500 ease-out motion-reduce:animate-none motion-reduce:transition-none",
					running ? "animate-ping" : "opacity-0",
				]}
			/>
		</span>
	) as string;
}
