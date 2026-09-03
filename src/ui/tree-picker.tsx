import { endpoints } from "../server/routes/endpoints.ts";
import type { AppTreeEntry, AppStateSnapshot } from "../state/app-store.ts";
import { DateTime } from "./date-time.tsx";
import { syncHtml } from "./sync-html.ts";

const treeLabelClasses = {
	user: "tree-kind-user",
	assistant: "tree-kind-assistant",
	tool: "tree-kind-tool",
	summary: "tree-kind-summary",
	other: "tree-kind-other",
} satisfies Record<AppTreeEntry["kind"], string>;

export function renderTreePicker(state: AppStateSnapshot): string {
	return syncHtml(
		<div id="tree-picker">
			<input id="tree-selected-id" type="hidden" data-bind:tree-selected-id />
			<div
				role="menu"
				id="tree-menu"
				class="tree-menu"
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
			<div class="input-group tree-summary-input" data-show="$treeCustomSummary">
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
				"tree-row",
				entry.inPath ? "tree-row-path" : "tree-row-muted",
				entry.active && "tree-row-active",
			]}
			aria-current={entry.active ? "true" : undefined}
			data-filter={haystack}
			data-keywords={haystack}
			data-keep-command-open
			data-active-tree-row={entry.active}
			data-attr:aria-disabled="$treeSelectedId ? 'true' : 'false'"
			data-on:click={selectTreeEntryAction(entry.id)}
		>
			<span class="tree-branch">
				<span class="tree-prefix" safe>
					{entry.prefix}
				</span>
				<span class="tree-node" aria-hidden="true" />
			</span>
			<span class="tree-kind-cell">
				<span class={`tree-kind ${treeLabelClasses[entry.kind]}`} safe>
					{entry.role}
				</span>
			</span>
			<span
				class={["tree-entry-text", entry.kind === "tool" && "tree-entry-tool"]}
				safe
			>
				{entry.label && `[${entry.label}] `}
				{entry.text}
			</span>
			<span class="tree-meta">
				<DateTime
					class="tree-date"
					dateTime={entry.metaTimestamp}
					label={entry.meta}
				/>
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
			window.piUi.controls.refresh(document.getElementById('tree-dialog'));
			document.getElementById('tree-summary-no')?.dispatchEvent(
				new MouseEvent('mousemove', { bubbles: true }),
			);
		});
	`;
}
