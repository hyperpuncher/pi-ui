import { syncHtml } from "./sync-html.ts";

export function PickerList(props: {
	id: string;
	children: JSX.Element | JSX.Element[] | string[];
	class?: string;
	role?: "listbox" | "menu";
}): string {
	return syncHtml(
		<ul
			id={props.id}
			role={props.role ?? "listbox"}
			class={props.class ?? "picker-list"}
		>
			{props.children}
		</ul>,
	);
}

export function PickerEmpty(props: { children: JSX.Element }): string {
	return syncHtml(
		<li role="status" class="picker-empty">
			{props.children}
		</li>,
	);
}

export function PickerRow(props: {
	kind: "file" | "slash";
	value: string;
	label: string;
	description: string;
	metadata: string;
	selected?: boolean;
}): string {
	return syncHtml(
		<li
			role="option"
			tabindex="-1"
			class="picker-row"
			aria-selected={props.selected ? "true" : "false"}
			data-file-row
		>
			<button
				type="button"
				class="picker-row-button"
				data-picker-kind={props.kind}
				data-picker-value={props.value}
			>
				<span class="picker-row-content">
					<span class="picker-row-title" safe>
						{props.label}
					</span>
					<span class="picker-row-description" safe>
						{props.description}
					</span>
				</span>
				<PickerMetadata text={props.metadata} />
			</button>
		</li>,
	);
}

export function PickerMetadata(props: { text: string }): string {
	return syncHtml(
		<span class="badge" data-variant="secondary" safe>
			{props.text}
		</span>,
	);
}
