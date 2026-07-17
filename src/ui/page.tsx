import { endpoints } from "../server/routes/endpoints.ts";
import type { AppRenderSnapshot } from "../state/app-store.ts";
import { renderAuthDialog } from "./auth-dialog.tsx";
import { projectBackendSignals } from "./backend-signals.ts";
import { renderCommandMenu } from "./command-menu.tsx";
import { renderDebugOverlay } from "./debug.tsx";
import { renderMessages } from "./messages.tsx";
import { renderSessionPicker, renderWorkspaceDialogMenu } from "./pickers.tsx";
import { renderPromptBox } from "./prompt-box.tsx";
import { renderSessionTransition } from "./session-transition.tsx";
import { renderTreePicker } from "./tree-picker.tsx";

export function renderPage(state: AppRenderSnapshot): string {
	const initialSignals = JSON.stringify({
		prompt: "",
		...projectBackendSignals(state),
		modelCycleDirection: "forward",
		thinkingCycleDirection: "forward",
		_sessionLoading: false,
		_sessionTarget: "",
		_filePickerOpen: false,
		_slashPickerOpen: false,
		fileQuery: "",
		isDraggingFile: false,
		sessionDeletePath: "",
		sessionDeleteTitle: "",
		sessionDeleteHover: "",
		treeEntryId: "",
		treeSummarize: false,
		treeSummaryInstructions: "",
		authProvider: "",
		authType: "",
		authInput: "",
	});

	return ("<!doctype html>" +
	(
		<html lang="en" class="h-full overflow-hidden">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>pi-ui</title>
				<link rel="icon" type="image/png" href="/favicon.png" />
				<script src="/theme.js"></script>
				<link rel="stylesheet" href="/app.css" />
				<script src="/basecoat.js" defer></script>
				<script type="module" src="/vendor/datastar.js"></script>
				<script type="module" src="/app/main.js"></script>
				{state.debugUi && (
					<script
						type="module"
						src="/vendor/datastar-inspector.min.js"
					></script>
				)}
			</head>
			<body
				class="h-full overflow-hidden"
				spellcheck="false"
				data-workspace-path={state.workspacePath}
				data-files-pick-endpoint={endpoints.filesPick}
				data-files-import-endpoint={endpoints.filesImport}
				data-display-refresh-endpoint={endpoints.displayRefresh}
				data-signals={initialSignals}
				data-on:dragenter__window={`if (window.piUi.fileTransfer.hasFiles(evt.dataTransfer)) {
					evt.preventDefault();
					$isDraggingFile = window.piUi.fileTransfer.enterDrag();
				}`}
				data-on:dragleave__window={`if (window.piUi.fileTransfer.hasFiles(evt.dataTransfer)) {
					$isDraggingFile = window.piUi.fileTransfer.leaveDrag();
				}`}
				data-on:dragover__window={`if (window.piUi.fileTransfer.hasFiles(evt.dataTransfer)) {
					evt.preventDefault();
					evt.dataTransfer.dropEffect = 'copy';
				}`}
				data-on:drop__window={`if (window.piUi.fileTransfer.hasFiles(evt.dataTransfer)) {
					evt.preventDefault();
					$isDraggingFile = false;
					window.piUi.fileTransfer.resetDrag();
					window.piUi.fileTransfer.insert(evt.dataTransfer);
				}`}
			>
				{state.debugUi && <datastar-inspector />}
				{renderDebugOverlay(state)}
				<div
					id="file-drop-overlay"
					class="bg-background/55 pointer-events-none fixed inset-0 z-50 items-center justify-center opacity-0 backdrop-blur-sm transition-[opacity,display] transition-discrete duration-100 ease-out motion-reduce:duration-100 [&.file-drop-active]:opacity-100 starting:[&.file-drop-active]:opacity-0"
					style="display: none;"
					data-class:file-drop-active="$isDraggingFile"
					data-style:display="$isDraggingFile ? 'flex' : 'none'"
					aria-hidden="true"
				>
					<div
						class="border-border bg-card/95 text-card-foreground flex scale-95 items-center gap-3 rounded-2xl border-2 border-dashed px-5 py-4 text-sm shadow-lg transition-[scale] duration-100 ease-out motion-reduce:scale-100 motion-reduce:transition-none [&.file-drop-card-active]:scale-100 starting:[&.file-drop-card-active]:scale-95"
						data-class:file-drop-card-active="$isDraggingFile"
					>
						<svg
							class="text-muted-foreground size-8"
							xmlns="http://www.w3.org/2000/svg"
							width="32"
							height="32"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<g
								fill="none"
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
							>
								<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
								<path d="M14 2v5a1 1 0 0 0 1 1h5m-8 4v6m3-3l-3-3l-3 3" />
							</g>
						</svg>
						<span>Drop files to attach</span>
					</div>
				</div>
				<div
					id="app"
					class="fixed inset-0 grid grid-rows-[minmax(0,1fr)] overflow-hidden"
					data-init="@get('/stream')"
				>
					{renderMessages(
						state.messages,
						state.emptyChatHint,
						state.hasOlderMessages,
						state.sessions,
						state.sessionTransition.status !== "idle",
						state.models.some((model) => model.configured),
					)}
					{renderSessionTransition(state)}

					{renderPromptBox(state)}
				</div>

				{renderCommandMenu()}
				{renderAuthDialog(state.authDialog)}

				<dialog
					id="workspace-dialog"
					class="command-dialog"
					aria-label="Change workspace"
					onclick="if (event.target === this) this.close()"
				>
					<div class="command sm:max-w-2xl">
						<header>
							<input
								id="workspace-input"
								type="text"
								placeholder="Type a path or search workspaces..."
								autocomplete="off"
								autocorrect="off"
								spellcheck="false"
								aria-autocomplete="list"
								role="combobox"
								aria-expanded="true"
								aria-controls="workspace-menu"
								data-bind:workspace-path
							/>
						</header>
						{renderWorkspaceDialogMenu(state)}
					</div>
				</dialog>

				<dialog
					id="tree-dialog"
					class="command-dialog"
					aria-label="Session tree"
					data-preserve-attr="open"
					onclick="if (event.target === this) this.close()"
				>
					<div class="command sm:max-w-4xl">
						<header>
							<input
								id="tree-input"
								type="text"
								placeholder="Search tree..."
								autocomplete="off"
								autocorrect="off"
								spellcheck="false"
								aria-autocomplete="list"
								role="combobox"
								aria-expanded="true"
								aria-controls="tree-menu"
								autofocus
							/>
						</header>
						{renderTreePicker(state)}
					</div>
				</dialog>

				<dialog
					id="session-dialog"
					class="command-dialog"
					aria-label="Resume session"
					data-init={`@get('${endpoints.sessionsStream}', {
						filterSignals: { include: /^$/ },
						openWhenHidden: true,
						requestCancellation: 'cleanup',
					})`}
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

				<dialog
					id="session-delete-dialog"
					class="dialog"
					aria-labelledby="session-delete-title"
					aria-describedby="session-delete-description"
					onclick="if (event.target === this) this.close()"
				>
					<div class="sm:max-w-md">
						<header>
							<h2 id="session-delete-title">Delete session?</h2>
							<p id="session-delete-description">
								This will permanently delete{" "}
								<span data-text="$sessionDeleteTitle">
									the selected session
								</span>
								.
							</p>
						</header>
						<footer>
							<button
								type="button"
								class="btn"
								data-variant="outline"
								onclick="this.closest('dialog').close()"
							>
								Cancel
							</button>
							<button
								type="button"
								class="btn"
								data-variant="destructive"
								data-attr:disabled="$sessionDeletePath === ''"
								data-on:click="
									evt.target.closest('dialog').close();
									@post('/sessions/delete', {
									filterSignals: { include: /^sessionDeletePath$/ },
								});
								"
							>
								Delete session
							</button>
						</footer>
					</div>
				</dialog>
			</body>
		</html>
	)) as string;
}
