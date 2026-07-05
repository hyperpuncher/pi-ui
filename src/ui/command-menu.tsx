import { appCommands, type AppCommand, type AppCommandId } from "../commands/registry.ts";
import { ShortcutKbd } from "./keyboard.tsx";

export function renderCommandMenu(): string {
	return (
		<dialog
			id="command-dialog"
			class="command-dialog"
			aria-label="Command menu"
			onclick="if (event.target === this) this.close()"
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
						{appCommands.map(renderCommandRow)}
					</div>
				</div>
			</div>
		</dialog>
	) as string;
}

function renderCommandRow(item: AppCommand): string {
	return (
		<div
			role="menuitem"
			tabindex="-1"
			data-command-row
			data-filter={item.title}
			data-keywords={`${item.description} ${item.id}`}
			data-on:click={commandAction(item.id)}
		>
			<span class="min-w-0">
				<span class="block truncate">{item.title}</span>
				<span class="text-muted-foreground block truncate text-xs">
					{item.description}
				</span>
			</span>
			{item.shortcut.display && (
				<ShortcutKbd shortcut={item.shortcut.display} shortcutSlot />
			)}
		</div>
	) as string;
}

function commandAction(id: AppCommandId): string {
	if (id === "new-chat") {
		return "document.getElementById('command-dialog')?.close(); @post('/sessions/new')";
	}
	if (id === "resume-session") {
		return "document.getElementById('command-dialog')?.close(); @post('/sessions/list'); document.getElementById('session-dialog')?.showModal()";
	}
	if (id === "command-palette") {
		return "document.getElementById('command-dialog')?.showModal(); document.getElementById('command-input')?.focus()";
	}
	if (id === "switch-model") {
		return "document.getElementById('command-dialog')?.close(); document.getElementById('model-select-trigger')?.click()";
	}
	if (id === "cycle-thinking") {
		return "document.getElementById('command-dialog')?.close(); @post('/thinking/cycle')";
	}
	return "document.getElementById('command-dialog')?.close(); document.getElementById('workspace-dialog')?.showModal(); setTimeout(() => document.getElementById('workspace-input')?.focus(), 0)";
}
