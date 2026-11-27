import { syncHtml } from "#src/ui/sync-html.ts";

export type StatusIconState = "running" | "success" | "error" | "warning" | "info";

// Running icons pre-render success/error marks so morphing to a finished state
// animates the arc closing and mark drawing in; settled icons render only their own mark.
export function StatusIcon(props: {
	state: StatusIconState;
	label?: string;
	role?: "img" | "progressbar";
	class?: string;
}): string {
	const { state } = props;
	return syncHtml(
		<span class={["status-icon", props.class]} data-state={state}>
			<svg
				viewBox="0 0 16 16"
				role={props.label ? (props.role ?? "img") : undefined}
				aria-label={props.label}
				aria-hidden={props.label ? undefined : "true"}
			>
				<circle class="status-icon-halo" cx="8" cy="8" r="6.5" />
				<circle class="status-icon-track" cx="8" cy="8" r="6.5" />
				<circle class="status-icon-arc" cx="8" cy="8" r="6.5" pathLength="100" />
				{(state === "running" || state === "success") && (
					<path
						class="status-icon-mark status-icon-success"
						d="M5.2 8.3l1.9 1.9 3.7-4"
						pathLength="100"
					/>
				)}
				{(state === "running" || state === "error") && (
					<path
						class="status-icon-mark status-icon-error"
						d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5"
						pathLength="100"
					/>
				)}
				{state === "warning" && (
					<>
						<path
							class="status-icon-mark status-icon-warning"
							d="M8 4.75v3.5"
							pathLength="100"
						/>
						<circle
							class="status-icon-mark status-icon-dot status-icon-warning"
							cx="8"
							cy="10.9"
							r="1"
						/>
					</>
				)}
				{state === "info" && (
					<>
						<path
							class="status-icon-mark status-icon-info"
							d="M8 7.5v3.75"
							pathLength="100"
						/>
						<circle
							class="status-icon-mark status-icon-dot status-icon-info"
							cx="8"
							cy="5.1"
							r="1"
						/>
					</>
				)}
			</svg>
		</span>,
	);
}

// An indeterminate progressbar, not a live region: loading states are noise.
export function loaderIcon(label = "Loading") {
	return <StatusIcon state="running" label={label} role="progressbar" />;
}
