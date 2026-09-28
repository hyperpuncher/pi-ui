import icons from "./icons.json";

export type IconName = keyof typeof icons;

type IconProps = {
	name?: IconName;
	children?: JSX.Element;
	class?: string;
	label?: string;
	role?: "img" | "status";
};

export function Icon(props: IconProps) {
	return (
		<svg
			class={props.class ? `icon ${props.class}` : "icon"}
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
			{props.name ? icons[props.name] : props.children}
		</svg>
	);
}
