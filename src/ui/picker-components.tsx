export function PickerList(props: {
	id: string;
	children: JSX.Element | JSX.Element[] | string[];
	class?: string;
	role?: "listbox" | "menu";
}): string {
	return (
		<ul
			id={props.id}
			role={props.role ?? "listbox"}
			class={props.class ?? "max-h-72 list-none overflow-y-auto p-1"}
		>
			{props.children}
		</ul>
	) as string;
}

export function PickerEmpty(props: { children: JSX.Element }): string {
	return (
		<li role="status" class="px-3 py-4 text-center text-sm text-muted-foreground">
			{props.children}
		</li>
	) as string;
}

export function PickerRow(props: {
	kind: "file" | "slash";
	value: string;
	label: string;
	description: string;
	metadata: string;
	selected?: boolean;
}): string {
	return (
		<li
			role="option"
			tabindex="-1"
			class="rounded-md aria-selected:bg-muted"
			aria-selected={props.selected ? "true" : "false"}
			data-file-row
		>
			<button
				type="button"
				class="flex w-full items-center justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2 text-left outline-none hover:bg-muted focus:bg-muted"
				data-picker-kind={props.kind}
				data-picker-value={props.value}
			>
				<span class="min-w-0">
					<span class="block truncate font-medium" safe>
						{props.label}
					</span>
					<span class="block truncate text-xs text-muted-foreground" safe>
						{props.description}
					</span>
				</span>
				<PickerMetadata text={props.metadata} />
			</button>
		</li>
	) as string;
}

export function PickerMetadata(props: { text: string }): string {
	return (
		<span class="badge" data-variant="secondary" safe>
			{props.text}
		</span>
	) as string;
}
