import icons from "#src/ui/icons.json";

export type IconName = keyof typeof icons;

type IconProps = {
	name?: IconName;
	children?: JSX.Element;
	class?: string;
	label?: string;
	role?: "img";
};

const iconSpriteHtml = `<svg id="pi-icon-sprite" width="0" height="0" style="position:absolute" aria-hidden="true" data-ignore-morph><defs>${Object.entries(
	icons,
)
	.map(
		([name, body]) =>
			`<symbol id="pi-icon-${name}" viewBox="0 0 24 24">${body}</symbol>`,
	)
	.join("")}</defs></svg>`;

export function IconSprite(): string {
	return iconSpriteHtml;
}

export function Icon(props: IconProps) {
	if (props.name) {
		return (
			<svg
				class={props.class ? `icon ${props.class}` : "icon"}
				fill="none"
				stroke-width="2"
				aria-hidden={props.label ? undefined : "true"}
				aria-label={props.label}
				role={props.label ? (props.role ?? "img") : undefined}
			>
				<use href={`#pi-icon-${props.name}`} />
			</svg>
		);
	}
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
			{props.children}
		</svg>
	);
}
