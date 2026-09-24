// Native `/hotkeys` handling: `/settings` and `/hotkeys` used to both just open the
// command palette (an action launcher, not a reference list — and one that only lists
// commands with a catalog entry, leaving out the focus-only keybinds in keybinds.ts's
// `focusKeybindIds`). This is a plain, always up to date reference: every shortcut
// pi-ui responds to, searchable, nothing to click.
import { browserReservedKeyIds } from "../agent/extension-shortcuts.ts";
import { appCommandCatalog } from "../commands/catalog.ts";
import { activeKeybind, type FocusKeybindId } from "../keybinds.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type { AppExtensionShortcut, AppStateSnapshot } from "../state/app-store.ts";
import { formatExtensionName } from "../utils/format.ts";
import { formatKeyId, formatShortcut, shortcutParts } from "../utils/keyboard.ts";
import { operatingSystem } from "../utils/platform.ts";
import { shortcutGlyph } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

// A dedicated reference dialog — unlike the ambient `ShortcutKbd` hints elsewhere in the
// UI (`keyboard.tsx`), these must stay visible when the user has turned off keybind hints,
// enabled minimal mode, or is under the 48rem width those hints hide at (misc.css), since
// showing every shortcut is the entire point of opening this dialog.
function ShortcutRef(props: { shortcut: string }) {
	const symbolic = operatingSystem === "darwin";
	const label = symbolic ? formatShortcut(props.shortcut) : undefined;
	return (
		<span class="shortcut hotkeys-row-shortcut" title={label}>
			{shortcutParts(props.shortcut).map((part) => (
				<kbd class="kbd">{symbolic ? shortcutGlyph(part) : part}</kbd>
			))}
		</span>
	);
}

/** Why `KeyIdRef` mutes a `reachable: false` chip — see `AppExtensionShortcut`'s
 * doc comment for the two cases this distinguishes (Round 6 F3 added the
 * second one). */
function unreachableReason(keyId: string): string {
	return browserReservedKeyIds.has(keyId)
		? "Your browser already uses this key — click this row to run it instead."
		: "This key is already used by pi-ui — click this row to run it instead.";
}

/**
 * Same visual shape as `ShortcutRef`, for a raw pi-tui `KeyId` string
 * (`"alt+o"`) instead of one of pi-ui's own `ShortcutSpec`-shaped binds —
 * see `formatKeyId`'s doc comment. `reachable: false` (the key collides with
 * one of pi-ui's own binds, or is one a real browser tab reserves for
 * itself — `AppExtensionShortcut`'s doc comment) mutes the chip and adds a
 * tooltip explaining the row is invoked by clicking it here instead, rather
 * than showing a chord that silently does nothing.
 */
function KeyIdRef(props: { keyId: string; reachable: boolean }) {
	return (
		<span
			class="shortcut hotkeys-row-shortcut"
			data-variant={props.reachable ? undefined : "muted"}
			data-tooltip={props.reachable ? undefined : unreachableReason(props.keyId)}
		>
			{formatKeyId(props.keyId)
				.split(" ")
				.map((part) => (
					<kbd class="kbd">{part}</kbd>
				))}
		</span>
	);
}

/**
 * `pi.registerShortcut()` shortcuts (F1 §1) — a separate section since they come
 * from whatever extensions the current session loaded, not a fixed catalog.
 * Every row is a native `<button>` (Round 6 F4: was a clickable `<li>`, unreachable
 * by keyboard/Tab and invisible to a screen reader as anything but static text)
 * that invokes the shortcut directly (F1 §3's mobile/touch reachability, extended
 * here too — not just the command palette — since it is also the only invocation
 * path for one `KeyIdRef` marks `reachable: false`). The `<li>` wrapper only ever
 * carries the search filter's `hidden` toggle, keeping the button itself a plain,
 * always-visible-when-shown row — same visual shape as before (`.hotkeys-row`).
 */
function ExtensionShortcutsSection(props: {
	shortcuts: readonly AppExtensionShortcut[];
}) {
	if (props.shortcuts.length === 0) return "";
	return (
		<>
			<li class="hotkeys-row hotkeys-section-heading" aria-hidden="true">
				<span class="command-item-title">Extensions</span>
			</li>
			{props.shortcuts.map((shortcut) => (
				<li
					data-attr:hidden={`!${JSON.stringify(`${shortcut.description ?? ""} ${shortcut.extensionPath}`.toLowerCase())}.includes($_hotkeysQuery.trim().toLowerCase())`}
				>
					<button
						type="button"
						class="hotkeys-row hotkeys-row-clickable"
						data-on:click={`@post('${endpoints.extensionShortcutInvoke}', { payload: { keyId: ${JSON.stringify(shortcut.key)} } })`}
					>
						<span class="hotkeys-row-content command-item-content">
							<span class="command-item-title" safe>
								{shortcut.description ??
									formatExtensionName(shortcut.extensionPath)}
							</span>
							{shortcut.description && (
								<span
									class="command-item-description"
									title={shortcut.extensionPath}
									safe
								>
									{formatExtensionName(shortcut.extensionPath)}
								</span>
							)}
						</span>
						<KeyIdRef
							keyId={shortcut.key}
							reachable={shortcut.reachableByKeyboard}
						/>
					</button>
				</li>
			))}
		</>
	);
}

// Focus-only keybinds (see keybinds.ts's focusKeybindIds) have no command-catalog entry
// of their own to source a description from.
const focusShortcutDescriptions: Record<FocusKeybindId, string> = {
	"cycle-model-backward": "Cycle through scoped models, backward",
	"toggle-sessions": "Show or hide the session sidebar",
	"focus-prompt": "Focus the message composer",
	"focus-conversation": "Focus the conversation transcript",
	"focus-sessions": "Focus the session sidebar",
	"focus-workspace-files": "Focus the workspace file tree",
	"focus-workspace-changes": "Focus the workspace Git changes list",
	"focus-workspace-editor": "Focus the workspace file editor",
};

export function renderHotkeysDialog(state: AppStateSnapshot): string {
	return syncHtml(
		<dialog
			id="hotkeys-dialog"
			class="dialog hotkeys-dialog"
			aria-labelledby="hotkeys-dialog-title"
			data-signals__ifmissing={JSON.stringify({ _hotkeysQuery: "" })}
			data-on:toggle="if (evt.newState === 'open') $_hotkeysQuery = ''"
			closedby="any"
		>
			<div class="hotkeys-dialog-panel">
				<header class="preference-dialog-header">
					<div class="preference-dialog-heading">
						<div>
							<h2 id="hotkeys-dialog-title">Keyboard shortcuts</h2>
							<p class="preference-dialog-description">
								Every shortcut pi-ui responds to.
							</p>
						</div>
					</div>
					<input
						id="hotkeys-search"
						type="search"
						class="input preference-dialog-search"
						placeholder="Search shortcuts…"
						aria-label="Search shortcuts"
						autocomplete="off"
						spellcheck="false"
						autofocus
						data-bind:_hotkeys-query=""
					/>
				</header>
				<ul
					class="preference-dialog-body hotkeys-list"
					aria-label="Keyboard shortcuts"
				>
					{appCommandCatalog
						.filter((command) => command.shortcut)
						.map((command) => (
							<li
								class="hotkeys-row"
								data-attr:hidden={`!${JSON.stringify(`${command.title} ${command.description}`.toLowerCase())}.includes($_hotkeysQuery.trim().toLowerCase())`}
							>
								<span class="hotkeys-row-content command-item-content">
									<span class="command-item-title" safe>
										{command.title}
									</span>
									<span class="command-item-description" safe>
										{command.description}
									</span>
								</span>
								<ShortcutRef shortcut={activeKeybind(command.id)} />
							</li>
						))}
					{Object.entries(focusShortcutDescriptions).map(
						([id, description]) => (
							<li
								class="hotkeys-row"
								data-attr:hidden={`!${JSON.stringify(description.toLowerCase())}.includes($_hotkeysQuery.trim().toLowerCase())`}
							>
								<span class="hotkeys-row-content command-item-content">
									<span class="command-item-title" safe>
										{description}
									</span>
								</span>
								<ShortcutRef
									// SAFETY: `id` is a key of `focusShortcutDescriptions`, declared as
									// `Record<FocusKeybindId, string>` — Object.entries widens keys to
									// `string`, but every runtime value here is a FocusKeybindId variant.
									shortcut={activeKeybind(id as FocusKeybindId)}
								/>
							</li>
						),
					)}
					<ExtensionShortcutsSection shortcuts={state.extensionShortcuts} />
				</ul>
				<footer class="preference-dialog-footer">
					<button
						type="button"
						class="btn"
						data-variant="outline"
						commandfor="hotkeys-dialog"
						command="close"
					>
						Done
					</button>
				</footer>
			</div>
		</dialog>,
	);
}
