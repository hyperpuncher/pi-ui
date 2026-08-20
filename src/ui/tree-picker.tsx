import { endpoints } from "../server/routes/endpoints.ts";
import type { AppTreeEntry, AppStateSnapshot } from "../state/app-store.ts";
import { DateTime } from "./date-time.tsx";
import { syncHtml } from "./sync-html.ts";

const treeLabelClasses = {
	user: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
	assistant: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
	tool: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
	summary: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
	other: "bg-muted text-muted-foreground",
} satisfies Record<AppTreeEntry["kind"], string>;

export function renderTreePicker(state: AppStateSnapshot): string {
	return syncHtml(
		<div id="tree-picker" class="flex min-h-0 flex-1 flex-col">
			<input id="tree-selected-id" type="hidden" data-bind:tree-selected-id />
			<div
				role="menu"
				id="tree-menu"
				class="max-h-none! min-h-0 flex-1 scroll-py-1 px-1.5 py-1.5"
				aria-orientation="vertical"
				data-empty="No session entries found."
			>
				<div
					role="group"
					aria-labelledby="tree-menu-heading"
					data-show="!$treeSelectedId"
				>
					<span role="heading" id="tree-menu-heading" class="sr-only">
						Session entries
					</span>
					{state.treeEntries.map(renderTreeRow)}
				</div>
				<SummaryChoice />
			</div>
		</div>,
	);
}

function SummaryChoice(): string {
	return syncHtml(
		<div
			role="group"
			aria-labelledby="tree-summary-heading"
			data-show="$treeSelectedId"
		>
			<span
				role="heading"
				id="tree-summary-heading"
				data-show="!$treeCustomSummary"
			>
				Summarize branch?
			</span>
			{SummaryOption({
				id: "tree-summary-no",
				label: "No summary",
				action: navigateAction(false),
			})}
			{SummaryOption({ label: "Summarize", action: navigateAction(true) })}
			{SummaryOption({
				label: "Summarize with custom prompt",
				keepOpen: true,
				action: `
					$treeCustomSummary = true;
					queueMicrotask(() => document.getElementById('tree-summary-input')?.focus());
				`,
			})}
			<span role="heading" data-show="$treeCustomSummary">
				Summary instructions
			</span>
			<div class="input-group m-1" data-show="$treeCustomSummary">
				<input
					id="tree-summary-input"
					placeholder="What should the summary focus on?"
					data-bind:tree-summary-instructions
					data-on:keydown={`if (evt.key === 'Enter') { ${navigateAction(true, true)} }`}
				/>
				<button
					type="button"
					class="btn"
					data-align="end"
					data-size="xs"
					data-variant="secondary"
					data-on:click={navigateAction(true, true)}
				>
					Continue
				</button>
			</div>
		</div>,
	);
}

function SummaryOption(props: {
	id?: string;
	label: string;
	action: string;
	keepOpen?: boolean;
}): string {
	return syncHtml(
		<div
			id={props.id}
			role="menuitem"
			tabindex="-1"
			data-filter={props.label}
			data-keep-command-open={props.keepOpen || undefined}
			data-show="!$treeCustomSummary"
			data-attr:aria-disabled="!$treeSelectedId ? 'true' : 'false'"
			data-on:click={props.action}
		>
			{props.label}
		</div>,
	);
}

function navigateAction(summarize: boolean, custom = false): string {
	return `
		document.getElementById('tree-dialog')?.close();
		@post('${endpoints.treeNavigate}', {
			payload: {
				treeEntryId: $treeSelectedId,
				treeSummarize: ${summarize},
				treeSummaryInstructions: ${custom ? "$treeSummaryInstructions" : "''"},
			},
		});
	`;
}

function renderTreeRow(entry: AppTreeEntry): string {
	const haystack =
		`${entry.role} ${entry.text} ${entry.meta} ${entry.label ?? ""}`.toLowerCase();
	return syncHtml(
		<div
			role="menuitem"
			tabindex="-1"
			class={[
				"grid! min-h-7 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-1! rounded-md! px-2! py-0.5! text-xs leading-5",
				entry.inPath ? "text-foreground" : "text-muted-foreground",
				entry.active && "bg-muted/60",
			]}
			aria-current={entry.active ? "true" : undefined}
			data-filter={haystack}
			data-keywords={haystack}
			data-keep-command-open
			data-active-tree-row={entry.active}
			data-attr:aria-disabled="$treeSelectedId ? 'true' : 'false'"
			data-on:click={selectTreeEntryAction(entry.id)}
		>
			<span class="flex items-center font-mono">
				<span class="whitespace-pre text-neutral-300 dark:text-neutral-700" safe>
					{entry.prefix}
				</span>
				<span class="text-neutral-400 dark:text-neutral-600" safe>
					•
				</span>
			</span>
			<span class="min-w-0">
				<span
					class={`inline-flex max-w-full rounded px-1.5 text-[10px] leading-4 font-semibold ${treeLabelClasses[entry.kind]}`}
					safe
				>
					{entry.role}
				</span>
			</span>
			<span
				class={[
					"min-w-0 truncate",
					entry.kind === "tool" && "font-mono text-[11px]",
				]}
				safe
			>
				{entry.label && `[${entry.label}] `}
				{entry.text}
			</span>
			<span class="ml-3 flex items-center gap-3 tabular-nums">
				<DateTime
					class="text-[11px] text-muted-foreground"
					dateTime={entry.metaTimestamp}
					label={entry.meta}
				/>
				{entry.active && (
					<span class="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
						active
					</span>
				)}
			</span>
		</div>,
	);
}

function selectTreeEntryAction(entryId: string): string {
	return `
		$treeSelectedId = ${JSON.stringify(entryId)};
		$treeCustomSummary = false;
		const search = document.getElementById('tree-input');
		if (search) search.value = '';
		requestAnimationFrame(() => {
			window.piUi.basecoat.refresh(document.getElementById('tree-dialog'));
			document.getElementById('tree-summary-no')?.dispatchEvent(
				new MouseEvent('mousemove', { bubbles: true }),
			);
		});
	`;
}
