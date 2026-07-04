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
		commandOpen: false,
		commandQuery: "",
		model: state.currentModel ?? "",
		workspacePath: state.workspacePath,
		sessionOpen: false,
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
					data-on:keydown__window="if ((evt.ctrlKey || evt.metaKey) && evt.key === 'k') {
						evt.preventDefault();
						$commandOpen = !$commandOpen;
						$commandQuery = '';
					}
					if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'o') {
						evt.preventDefault();
						@post('/sessions/new');
					}
					if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'r') {
						evt.preventDefault();
						$commandOpen = false;
						$commandQuery = '';
						@post('/sessions/list');
					}
					if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'l') {
						evt.preventDefault();
						$commandOpen = false;
						$commandQuery = '';
						globalThis.__piUiOpenModelSelector?.();
					}
					if (evt.key === 'Escape') {
						$commandOpen = false;
						$commandQuery = '';
						$sessionOpen = false;
						$sessionQuery = '';
						if ($composer === '/') $composer = '';
					}"
					data-on:pi-new-chat__window="@post('/sessions/new')"
					data-on:pi-command-palette__window="
						$commandOpen = true;
						$commandQuery = '';
					"
					data-on:pi-resume-session__window="
						$commandOpen = false;
						$commandQuery = '';
						@post('/sessions/list');
					"
					data-on:pi-switch-model__window="
						$commandOpen = false;
						$commandQuery = '';
						globalThis.__piUiOpenModelSelector?.();
					"
					data-on:pi-change-workspace__window="
						$commandOpen = false;
						$commandQuery = '';
						globalThis.__piUiPromptWorkspace?.();
					"
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
								data-on:keydown="if (evt.key === 'ArrowDown' && globalThis.__piUiSlashOpen?.()) {
									evt.preventDefault();
									globalThis.__piUiFocusSlashRow?.(1);
								}
								if ((evt.key === 'ArrowDown' || evt.key === 'ArrowUp') && globalThis.__piUiFileOpen?.()) {
									evt.preventDefault();
									evt.stopPropagation();
									globalThis.__piUiFocusFileRow?.(evt.key === 'ArrowDown' ? 1 : -1);
								}
								if (evt.key === 'Enter' && !evt.shiftKey && globalThis.__piUiFileOpen?.()) {
									evt.preventDefault();
									globalThis.__piUiRunFirstFile?.();
								} else if (evt.key === 'Enter' && !evt.shiftKey) {
									evt.preventDefault();
									globalThis.__piUiCloseSlashPicker?.();
									@post('/prompt', { filterSignals: { include: /^composer$/ } });
								}"
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
										data-on:click="
											$commandOpen = true;
											$commandQuery = '';
										"
										title="Commands"
									>
										⌘
									</button>
									<button
										class="btn"
										data-variant="ghost"
										data-size="icon-sm"
										type="button"
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
										data-on:click="globalThis.__piUiInsertFilePrefix?.()"
										title="Files"
									>
										@
									</button>
									<button
										class="btn"
										data-variant="ghost"
										data-size="icon-sm"
										type="button"
										data-on:click="@post('/sessions/list')"
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
										data-on:click="
											globalThis.__piUiCloseSlashPicker?.();
											@post('/prompt', { filterSignals: { include: /^composer$/ } });
										"
										aria-label="Send"
									>
										↑
									</button>
								</div>
							</div>
						</div>
					</div>

					<div
						class="bg-background/70 fixed inset-0 z-20 grid items-start justify-items-center pt-[10vh] backdrop-blur-sm"
						data-show="$commandOpen"
						style="display: none;"
					>
						<div
							class="card w-[min(42rem,calc(100vw-2rem))] p-4"
							role="dialog"
							aria-modal="true"
							aria-label="Command palette"
						>
							<header class="mb-3 flex items-center justify-between">
								<strong>Command palette</strong>
								<button
									class="btn"
									data-variant="ghost"
									data-size="icon-sm"
									type="button"
									data-on:click="
										$commandOpen = false;
										$commandQuery = '';
									"
									aria-label="Close"
								>
									×
								</button>
							</header>
							<input
								id="command-input"
								class="input w-full"
								autofocus
								placeholder="Type a command..."
								aria-label="Command search"
								data-bind:command-query
								data-on:keydown="if (evt.key === 'Enter') {
									evt.preventDefault();
									globalThis.__piUiRunFirstCommand?.();
								}"
							/>
							<ul class="mt-3 list-none p-0">
								{appCommands.map(renderCommandRow)}
							</ul>
							<p class="text-muted-foreground mt-3 text-xs">
								Tip: {newChat.shortcut.display} starts a fresh chat. Press
								Enter to run the first visible command.
							</p>
						</div>
					</div>

					<div
						class="bg-background/70 fixed inset-0 z-20 grid items-start justify-items-center pt-[10vh] backdrop-blur-sm"
						data-show="$sessionOpen"
						style="display: none;"
					>
						<div
							class="card w-[min(46rem,calc(100vw-2rem))] p-4"
							role="dialog"
							aria-modal="true"
							aria-label="Resume session"
						>
							<header class="mb-3 flex items-center justify-between">
								<strong>Resume session</strong>
								<button
									class="btn"
									data-variant="ghost"
									data-size="icon-sm"
									type="button"
									data-on:click="
										$sessionOpen = false;
										$sessionQuery = '';
									"
									aria-label="Close"
								>
									×
								</button>
							</header>
							<input
								id="session-input"
								class="input w-full"
								placeholder="Search sessions..."
								aria-label="Session search"
								data-bind:session-query
								data-on:keydown="if (evt.key === 'Enter') {
									evt.preventDefault();
									globalThis.__piUiRunFirstSession?.();
								}"
							/>
							{renderSessionPicker(state)}
						</div>
					</div>
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
		return "$commandOpen = false; $commandQuery = ''; @post('/sessions/new')";
	}
	if (id === "resume-session") {
		return "$commandOpen = false; $commandQuery = ''; @post('/sessions/list')";
	}
	if (id === "command-palette") {
		return "$commandOpen = true; $commandQuery = ''; document.getElementById('command-input')?.focus()";
	}
	if (id === "switch-model") {
		return "$commandOpen = false; $commandQuery = ''; globalThis.__piUiOpenModelSelector?.()";
	}
	return "$commandOpen = false; $commandQuery = ''; globalThis.__piUiPromptWorkspace?.()";
}
