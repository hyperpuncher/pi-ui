import type { IconData } from "./icons.ts";

type IconProps = {
	icon?: IconData;
	children?: JSX.Element;
	class?: string;
	label?: string;
	role?: "img" | "status";
};

export function Icon(props: IconProps) {
	return (
		<svg
			class={props.class ?? "size-3.5"}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			aria-hidden={props.label ? undefined : "true"}
			aria-label={props.label}
			role={props.label ? (props.role ?? "img") : undefined}
		>
			{props.icon?.body ?? props.children}
		</svg>
	);
}
