import { browserReservedKeyIds } from "../agent/extension-shortcuts.ts";
import { commandActions } from "../commands/actions.ts";
import { appCommandCatalog, type AppCommandMetadata } from "../commands/catalog.ts";
import { activeKeybind } from "../keybinds.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type { AppExtensionShortcut, AppStateSnapshot } from "../state/app-store.ts";
import { formatExtensionName } from "../utils/format.ts";
import { formatKeyId } from "../utils/keyboard.ts";
import { ShortcutKbd } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

export const resetCommandDialogOnOpen = `if (evt.newState === 'open') {
	const input = el.querySelector('header input');
	input.value = '';
	input.dispatchEvent(new Event('input', { bubbles: true }));
	window.piUi.controls.refresh(el);
}`;

export function renderCommandMenu(state: AppStateSnapshot): string {
	return syncHtml(
		<dialog
			id="command-dialog"
			class="command-dialog"
			aria-label="Command menu"
			data-on:toggle={resetCommandDialogOnOpen}
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
						data-bind:_command-query
						data-effect="
							$_commandQuery;
							queueMicrotask(() => window.piUi.controls.refresh(el.closest('.command')));
						"
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
					{state.extensionShortcuts.length > 0 && (
						<div
							role="group"
							aria-labelledby="command-menu-extensions-heading"
						>
							<span role="heading" id="command-menu-extensions-heading">
								Extensions
							</span>
							{state.extensionShortcuts.map(renderExtensionShortcutRow)}
						</div>
					)}
				</div>
			</div>
		</dialog>,
	);
}

function renderCommandRow(item: AppCommandMetadata): string {
	const searchText = `${item.title} ${item.description} ${item.id}`.toLowerCase();
	const shortcut = activeKeybind(item.id);
	return syncHtml(
		<div
			role="menuitem"
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

/**
 * Mobile/touch reachability for `pi.registerShortcut()` shortcuts (F1 §1):
 * a coarse-pointer session has no physical keyboard to trigger
 * `static/app/extension-keys.ts`'s matcher, so every shortcut the current
 * session's extensions registered is also a tappable command-palette row,
 * invoking the exact same route (`invokeExtensionShortcut`) that route
 * dispatches to. It is also the ONLY invocation path for a shortcut whose key
 * collides with one of pi-ui's own binds (`item.reachableByKeyboard === false`
 * — see `AppExtensionShortcut`'s doc comment): its kbd hint is muted rather
 * than hidden, so the row still shows what key the extension itself uses.
 */
function renderExtensionShortcutRow(item: AppExtensionShortcut): string {
	const title = item.description ?? formatExtensionName(item.extensionPath);
	const searchText = `${title} ${item.extensionPath}`.toLowerCase();
	return syncHtml(
		<div
			role="menuitem"
			tabindex="-1"
			data-attr:hidden={`!${JSON.stringify(searchText)}.includes($_commandQuery.trim().toLowerCase())`}
			data-on:click={`@post('${endpoints.extensionShortcutInvoke}', { payload: { keyId: ${JSON.stringify(item.key)} } })`}
		>
			<span class="command-item-content">
				<span class="command-item-title" safe>
					{title}
				</span>
				{item.description && (
					<span
						class="command-item-description"
						title={item.extensionPath}
						safe
					>
						{formatExtensionName(item.extensionPath)}
					</span>
				)}
			</span>
			<span class="command-item-shortcut">
				<span
					class="shortcut"
					data-keybind-hint
					data-variant={item.reachableByKeyboard ? undefined : "muted"}
					data-tooltip={
						item.reachableByKeyboard
							? undefined
							: browserReservedKeyIds.has(item.key)
								? "Your browser already uses this key — tap to run it instead."
								: "This key is already used by pi-ui — tap to run it instead."
					}
				>
					{formatKeyId(item.key)
						.split(" ")
						.map((part) => (
							<kbd class="kbd">{part}</kbd>
						))}
				</span>
			</span>
		</div>,
	);
}
