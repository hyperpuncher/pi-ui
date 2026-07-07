import type { AppState, AppTreeEntry } from "../state/app-state.ts";

export function renderTreePicker(state: AppState): string {
	return (
		<div id="tree-picker">
			<div class="border-border flex items-center gap-3 border-b px-3 py-2 text-xs">
				<label class="flex items-center gap-2">
					<input type="checkbox" data-bind:tree-summarize />
					<span>Summarize abandoned branch</span>
				</label>
				<input
					class="input h-7 min-w-0 flex-1 text-xs"
					placeholder="Optional summary focus..."
					data-bind:tree-summary-instructions
					data-show="$treeSummarize"
				/>
			</div>
			<div
				role="menu"
				id="tree-menu"
				class="mt-1"
				aria-orientation="vertical"
				data-empty="No session entries found."
			>
				<div role="group" aria-labelledby="tree-menu-heading">
					<span role="heading" id="tree-menu-heading">
						Session tree
					</span>
					{state.treeEntries.map(renderTreeRow)}
				</div>
			</div>
		</div>
	) as string;
}

function renderTreeRow(entry: AppTreeEntry): string {
	const haystack =
		`${entry.role} ${entry.text} ${entry.meta} ${entry.label ?? ""}`.toLowerCase();
	return (
		<div
			role="menuitem"
			tabindex="-1"
			class={[
				"grid grid-cols-[auto_auto_minmax(0,1fr)_auto] gap-x-0 font-mono text-xs",
				entry.active && "bg-primary/10 text-primary",
				entry.inPath && !entry.active && "text-foreground",
				!entry.inPath && "text-muted-foreground",
			]}
			data-tree-row
			data-filter={haystack}
			data-keywords={haystack}
			data-active-tree-row={entry.active ? "true" : undefined}
			data-on:click={`
				$treeEntryId = ${JSON.stringify(entry.id)};
				@post('/tree/navigate', { filterSignals: { include: /^tree(EntryId|Summarize|SummaryInstructions)$/ } });
			`}
		>
			<span
				class="text-muted-foreground col-start-1 row-start-1 whitespace-pre"
				safe
			>
				{entry.prefix}
			</span>
			<span class="col-start-2 row-start-1 whitespace-pre">
				{entry.inPath ? (
					<span class="text-primary">• </span>
				) : (
					<span safe> </span>
				)}
			</span>
			<span class="col-start-3 row-start-1 min-w-0 truncate">
				{entry.label && (
					<span class="text-warning mr-1" safe>
						[{entry.label}]
					</span>
				)}
				<span class="text-primary" safe>
					{entry.role}
				</span>
				<span safe>{entry.text}</span>
			</span>
			<span
				class="text-muted-foreground col-start-1 row-start-2 whitespace-pre"
				safe
			>
				{entry.continuationPrefix}
			</span>
			<span class="col-start-2 row-start-2 whitespace-pre" safe>
				{"  "}
			</span>
			{entry.meta && (
				<span
					class="text-muted-foreground col-start-3 row-start-2 mt-0.5 min-w-0 truncate"
					safe
				>
					{entry.meta}
				</span>
			)}
			{entry.active && (
				<span
					class="badge col-start-4 row-span-2 row-start-1 ml-3 self-center"
					data-variant="secondary"
				>
					active
				</span>
			)}
		</div>
	) as string;
}
