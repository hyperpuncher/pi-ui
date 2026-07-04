import {
	appCommands,
	command,
	type AppCommand,
	type AppCommandId,
} from "../commands/registry.ts";
import type { AppState } from "../state/app-state.ts";
import {
	renderComposerStatus,
	renderModelPicker,
	renderSessionPicker,
	renderSlashPicker,
	renderTranscript,
	renderWorkspacePicker,
} from "./fragments.tsx";

function sync(html: JSX.Element): string {
	return html as string;
}

const systemThemeScript = `(() => {
	try {
		const stored = localStorage.getItem('themeMode');
		if (stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches) {
			document.documentElement.classList.add('dark');
		}
	} catch (_) {}
})();`;

export function renderPage(state: AppState): string {
	const newChat = command("new-chat");
	const initialSignals = JSON.stringify({
		composer: "",
		commandQuery: "",
		model: state.currentModel ?? "",
		workspacePath: state.workspacePath,
		sessionPath: "",
		sessionQuery: "",
	});

	return (
		"<!doctype html>" +
		sync(
			<html lang="en" class="h-full overflow-hidden">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>pi-ui</title>
					<script>{systemThemeScript}</script>
					<link rel="stylesheet" href="/app.css" />
					<script src="/basecoat.js" defer></script>
					<script type="module" src="/app.js"></script>
					<script type="module" src="/datastar.js"></script>
				</head>
				<body
					class="h-full overflow-hidden"
					data-workspace-path={state.workspacePath}
					data-signals={initialSignals}
				>
					<div
						id="app"
						class="fixed inset-0 grid grid-rows-[minmax(0,1fr)] overflow-hidden"
						data-init="@get('/stream')"
					>
						{renderTranscript(state.messages)}

						<div
							id="composer"
							class="card fixed bottom-6 left-1/2 z-10 w-[min(54rem,calc(100vw-2rem))] -translate-x-1/2 overflow-visible! p-3 shadow-sm"
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
								class="max-h-44 min-h-12 w-full resize-none border-0 bg-transparent p-1 outline-none"
								placeholder="Ask pi anything..."
								aria-label="Message"
								data-bind:composer
								data-indicator:_prompting
							></textarea>
							<div class="mt-2 flex items-center justify-between gap-3">
								<div
									class="flex items-center gap-2"
									aria-label="Message tools"
								>
									<button
										class="btn"
										data-variant="ghost"
										data-size="icon-sm"
										type="button"
										data-dialog-trigger="command-dialog"
										title="Commands"
									>
										⌘
									</button>
									<button
										class="btn"
										data-variant="ghost"
										data-size="icon-sm"
										type="button"
										data-new-chat-trigger
										data-on:click="@post('/sessions/new')"
										title="New chat"
									>
										+
									</button>
									<button
										class="btn"
										data-variant="ghost"
										data-size="icon-sm"
										type="button"
										data-file-trigger
										title="Files"
									>
										@
									</button>
									<button
										class="btn"
										data-variant="ghost"
										data-size="icon-sm"
										type="button"
										data-session-trigger
										title="Resume session"
									>
										↩
									</button>
								</div>
								<div class="flex min-w-0 items-center justify-end gap-1.5">
									{renderComposerStatus(state)}
									{renderWorkspacePicker(state)}
									{renderModelPicker(state)}
									<button
										class="btn"
										data-variant="ghost"
										data-size="icon-sm"
										type="button"
										data-on:click="@post('/abort')"
										title="Abort"
										aria-label="Abort"
									>
										■
									</button>
									<button
										class="btn"
										data-size="icon"
										type="button"
										data-indicator:_prompting
										data-send-trigger
										data-on:click="@post('/prompt', { filterSignals: { include: /^composer$/ } })"
										aria-label="Send"
									>
										↑
									</button>
								</div>
							</div>
						</div>
					</div>

					<button
						id="session-list-action"
						type="button"
						class="hidden"
						data-on:click="@post('/sessions/list')"
					/>

					<dialog
						id="command-dialog"
						class="dialog"
						aria-labelledby="command-dialog-title"
						onclick="if (event.target === this) this.close()"
					>
						<div class="w-[min(42rem,calc(100vw-2rem))] max-w-none">
							<header>
								<h2 id="command-dialog-title">Command palette</h2>
							</header>
							<input
								id="command-input"
								class="input w-full"
								autofocus
								placeholder="Type a command..."
								aria-label="Command search"
								data-bind:command-query
							/>
							<ul class="mt-3 list-none p-0">
								{appCommands.map(renderCommandRow)}
							</ul>
							<p class="text-muted-foreground mt-3 text-xs">
								Tip: {newChat.shortcut.display} starts a fresh chat. Press
								Enter to run the first visible command.
							</p>
							<button
								class="btn"
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
								class="btn"
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
						class="dialog"
						aria-labelledby="session-dialog-title"
						onclick="if (event.target === this) this.close()"
					>
						<div class="w-[min(46rem,calc(100vw-2rem))] max-w-none">
							<header>
								<h2 id="session-dialog-title">Resume session</h2>
							</header>
							<input
								id="session-input"
								class="input w-full"
								placeholder="Search sessions..."
								aria-label="Session search"
								data-bind:session-query
							/>
							{renderSessionPicker(state)}
							<button
								class="btn"
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
				</body>
			</html>,
		)
	);
}

function renderCommandRow(item: AppCommand): string {
	const haystack = `${item.title} ${item.description} ${item.id}`.toLowerCase();
	return sync(
		<li
			data-command-row
			data-show={`
				$commandQuery === '' ||
				${JSON.stringify(haystack)}.includes($commandQuery.toLowerCase())
			`}
		>
			<button
				class="hover:bg-muted focus:bg-muted flex w-full items-center justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2 text-left outline-none"
				type="button"
				data-on:click={commandAction(item.id)}
			>
				<span class="min-w-0">
					<span class="block truncate">{item.title}</span>
					<span class="text-muted-foreground block truncate text-xs">
						{item.description}
					</span>
				</span>
				{item.shortcut.display && (
					<kbd class="kbd shrink-0">{item.shortcut.display}</kbd>
				)}
			</button>
		</li>,
	);
}

function commandAction(id: AppCommandId): string {
	if (id === "new-chat") {
		return "document.getElementById('command-dialog')?.close(); $commandQuery = ''; @post('/sessions/new')";
	}
	if (id === "resume-session") {
		return "document.getElementById('command-dialog')?.close(); $commandQuery = ''; @post('/sessions/list'); setTimeout(() => document.getElementById('session-dialog')?.showModal(), 0)";
	}
	if (id === "command-palette") {
		return "document.getElementById('command-dialog')?.showModal(); $commandQuery = ''; document.getElementById('command-input')?.focus()";
	}
	if (id === "switch-model") {
		return "document.getElementById('command-dialog')?.close(); $commandQuery = ''; document.getElementById('model-select-trigger')?.click()";
	}
	return "document.getElementById('command-dialog')?.close(); $commandQuery = ''; document.getElementById('workspace-dialog')?.showModal(); setTimeout(() => document.getElementById('workspace-input')?.focus(), 0)";
}
