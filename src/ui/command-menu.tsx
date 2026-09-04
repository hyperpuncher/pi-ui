import { commandActions } from "../commands/actions.ts";
import { appCommandCatalog, type AppCommandMetadata } from "../commands/catalog.ts";
import { ShortcutKbd } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

export function renderCommandMenu(): string {
	return syncHtml(
		<dialog
			id="command-dialog"
			class="command-dialog"
			aria-label="Command menu"
			closedby="any"
		>
			<div class="command">
				<header>
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
					/>
				</header>
				<div
					role="menu"
					id="command-menu"
					aria-orientation="vertical"
					data-empty="No commands found."
				>
					<div role="group" aria-labelledby="command-menu-heading">
						<span role="heading" id="command-menu-heading">
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

function renderCommandRow(item: AppCommandMetadata): string {
	return syncHtml(
		<div
			role="menuitem"
			tabindex="-1"
			data-filter={item.title}
			data-keywords={`${item.description} ${item.id}`}
			data-on:click={commandActions[item.id]}
		>
			<span class="command-item-content">
				<span class="command-item-title">{item.title}</span>
				<span class="command-item-description">{item.description}</span>
			</span>
			{item.shortcut && (
				<span class="command-item-shortcut">
					<ShortcutKbd shortcut={item.shortcut} />
				</span>
			)}
		</div>,
	);
}
