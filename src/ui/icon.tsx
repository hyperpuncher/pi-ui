export function StopIcon(props: { class?: string } = {}) {
	return (
		<Icon class={props.class}>
			<rect width="18" height="18" x="3" y="3" rx="2" fill="currentColor" />
		</Icon>
	);
}

export function Icon(props: { children: JSX.Element; class?: string }) {
	return (
		<svg
			class={props.class ?? "size-3.5"}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			aria-hidden="true"
		>
			{props.children}
		</svg>
	);
}
