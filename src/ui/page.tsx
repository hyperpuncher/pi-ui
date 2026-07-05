import { appCommands, type AppCommand, type AppCommandId } from "../commands/registry.ts";
import type { AppState } from "../state/app-state.ts";
import {
	renderComposerAction,
	renderComposerStatus,
	renderModelPicker,
	renderSessionPicker,
	renderSlashPicker,
	renderThinkingPicker,
	renderTranscript,
	renderWorkspacePicker,
} from "./fragments.tsx";
import { ShortcutKbd } from "./keyboard.tsx";

export function renderPage(state: AppState): string {
	const initialSignals = JSON.stringify({
		composer: "",
		model: state.currentModel ?? "",
		thinkingLevel: state.thinkingLevel,
		workspacePath: state.workspacePath,
		sessionPath: "",
	});

	return ("<!doctype html>" +
	(
		<html lang="en" class="h-full overflow-hidden">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>pi-ui</title>
				<script src="/theme.js"></script>
				<link rel="stylesheet" href="/app.css" />
				<script src="/basecoat.js" defer></script>
				<script type="module" src="/vendor/datastar.js"></script>
				<script type="module" src="/app.js"></script>
				<script type="module" src="/vendor/datastar-inspector.min.js"></script>
			</head>
			<body
				class="h-full overflow-hidden"
				data-workspace-path={state.workspacePath}
				data-signals={initialSignals}
			>
				<datastar-inspector />
				<div
					id="app"
					class="fixed inset-0 grid grid-rows-[minmax(0,1fr)] overflow-hidden"
					data-init="@get('/stream')"
				>
					{renderTranscript(state.messages, state.emptyChatHint)}

					<div
						id="composer"
						class="bg-card text-card-foreground ring-foreground/10 fixed bottom-6 left-1/2 z-10 w-[min(54rem,calc(100vw-2rem))] -translate-x-1/2 overflow-visible! rounded-xl p-3 text-sm shadow-lg ring-1"
					>
						<div
							id="composer-slash-popover"
							class="bg-popover text-popover-foreground absolute right-0 bottom-full left-0 mb-2 rounded-md border p-1 shadow-md"
							style="display: none;"
						>
							{renderSlashPicker(state)}
						</div>
						<div
							id="composer-file-popover"
							class="bg-popover text-popover-foreground absolute right-0 bottom-full left-0 mb-2 rounded-md border p-1 shadow-md"
							style="display: none;"
						>
							<ul
								id="file-picker-list"
								class="max-h-72 list-none overflow-y-auto p-1"
							/>
						</div>
						<textarea
							id="composer-input"
							class="block max-h-44 w-full resize-none border-0 bg-transparent p-1 outline-none"
							placeholder="Ask pi anything..."
							aria-label="Message"
							rows="1"
							data-bind:composer
						></textarea>
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div
								class="flex shrink-0 items-center gap-2"
								aria-label="Message tools"
							>
								<button
									class="btn text-muted-foreground hover:text-foreground leading-none"
									data-variant="ghost"
									data-size="icon-sm"
									type="button"
									data-dialog-trigger="command-dialog"
									data-tooltip="Commands"
									aria-label="Commands"
								>
									⌘
								</button>
								<button
									class="btn text-muted-foreground hover:text-foreground leading-none"
									data-variant="ghost"
									data-size="icon-sm"
									type="button"
									data-new-chat-trigger
									data-on:click="@post('/sessions/new')"
									data-tooltip="New chat"
									aria-label="New chat"
								>
									+
								</button>
								<button
									class="btn text-muted-foreground hover:text-foreground leading-none"
									data-variant="ghost"
									data-size="icon-sm"
									type="button"
									data-file-trigger
									data-tooltip="Files"
									aria-label="Files"
								>
									@
								</button>
								<button
									class="btn text-muted-foreground hover:text-foreground leading-none"
									data-variant="ghost"
									data-size="icon-sm"
									type="button"
									data-session-trigger
									data-on:click="
										@post('/sessions/list');
										document.getElementById('session-dialog')?.showModal();
									"
									data-tooltip="Resume session"
									aria-label="Resume session"
								>
									↩
								</button>
							</div>
							<div class="flex min-w-0 flex-1 items-center justify-end gap-1.5">
								{renderComposerStatus(state)}
								{renderWorkspacePicker(state)}
								<span
									class="bg-border hidden h-4 w-px shrink-0 sm:block"
									aria-hidden="true"
								/>
								{renderModelPicker(state)}
								<span
									class="bg-border hidden h-4 w-px shrink-0 sm:block"
									aria-hidden="true"
								/>
								{renderThinkingPicker(state)}
								{renderComposerAction(state)}
							</div>
						</div>
					</div>
				</div>

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

				<dialog
					id="workspace-dialog"
					class="dialog"
					aria-labelledby="workspace-dialog-title"
					onclick="if (event.target === this) this.close()"
				>
					<div class="w-[min(42rem,calc(100vw-2rem))] max-w-none">
						<header>
							<h2 id="workspace-dialog-title">Change workspace</h2>
						</header>
						<section>
							<div class="flex gap-2">
								<input
									id="workspace-input"
									class="input min-w-0 flex-1 font-mono text-sm"
									placeholder="/path/to/project"
									aria-label="Workspace path"
									data-bind:workspace-path
								/>
								<button
									class="btn"
									type="button"
									data-workspace-submit
									data-on:click="@post('/workspace/open', { filterSignals: { include: /^workspacePath$/ } })"
								>
									Open
								</button>
							</div>
							<div class="mt-4">
								<p class="text-muted-foreground mb-2 text-xs">
									Recent workspaces
								</p>
								<ul
									id="workspace-recent-list"
									class="max-h-72 list-none overflow-y-auto p-0"
								/>
							</div>
						</section>
						<button
							class="btn leading-none"
							data-variant="ghost"
							data-size="icon-sm"
							type="button"
							onclick="this.closest('dialog').close()"
							aria-label="Close"
						>
							×
						</button>
					</div>
				</dialog>

				<dialog
					id="session-dialog"
					class="command-dialog"
					aria-label="Resume session"
					onclick="if (event.target === this) this.close()"
				>
					<div class="command sm:max-w-2xl">
						<header>
							<input
								id="session-input"
								type="text"
								placeholder="Search sessions..."
								autocomplete="off"
								autocorrect="off"
								spellcheck="false"
								aria-autocomplete="list"
								role="combobox"
								aria-expanded="true"
								aria-controls="session-menu"
								autofocus
							/>
						</header>
						{renderSessionPicker(state)}
					</div>
				</dialog>
			</body>
		</html>
	)) as string;
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
