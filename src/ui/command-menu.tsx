import { commandActions } from "../commands/actions.ts";
import { appCommandCatalog, type AppCommandMetadata } from "../commands/catalog.ts";
import { activeKeybind } from "../keybinds.ts";
import { ShortcutKbd } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

export const resetCommandDialogOnOpen = `if (evt.newState === 'open') {
	const input = el.querySelector('search input');
	input.value = '';
	input.dispatchEvent(new Event('input', { bubbles: true }));
	window.piUi.controls.refresh(el);
}`;

export function renderCommandMenu(): string {
	return syncHtml(
		<dialog
			id="command-dialog"
			class="command-dialog"
			aria-label="Command menu"
			data-on:toggle={resetCommandDialogOnOpen}
			closedby="any"
		>
			<div class="command">
				<search aria-label="Search commands">
					<input
						id="command-input"
						type="text"
						placeholder="Type a command or search..."
						autocomplete="off"
						autocorrect="off"
						spellcheck="false"
						aria-autocomplete="list"
						role="combobox"
						aria-expanded="true"
						aria-controls="command-menu"
						autofocus
						data-bind:_command-query
						data-effect="
							$_commandQuery;
							queueMicrotask(() => window.piUi.controls.refresh(el.closest('.command')));
						"
					/>
				</search>
				<div
					role="listbox"
					id="command-menu"
					aria-orientation="vertical"
					data-empty="No commands found."
				>
					<div role="group" aria-labelledby="command-menu-heading">
						<span id="command-menu-heading" class="command-group-label">
							Commands
						</span>
						{appCommandCatalog
							.filter((command) => command.id !== "command-palette")
							.map(renderCommandRow)}
					</div>
				</div>
			</div>
		</dialog>,
	);
}

function commandRowId(id: string): string {
	return `command-option-${encodeURIComponent(id)}`;
}

function renderCommandRow(item: AppCommandMetadata): string {
	const searchText = `${item.title} ${item.description} ${item.id}`.toLowerCase();
	const shortcut = activeKeybind(item.id);
	return syncHtml(
		<div
			id={commandRowId(item.id)}
			role="option"
			aria-selected="false"
			tabindex="-1"
			data-attr:hidden={`!${JSON.stringify(searchText)}.includes($_commandQuery.trim().toLowerCase())`}
			data-on:click={commandActions[item.id]}
		>
			<span class="command-item-content">
				<span class="command-item-title">{item.title}</span>
				<span class="command-item-description">{item.description}</span>
			</span>
			{shortcut && (
				<span class="command-item-shortcut">
					<ShortcutKbd shortcut={shortcut} />
				</span>
			)}
		</div>,
	);
}
