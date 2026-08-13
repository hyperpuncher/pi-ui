import { endpoints } from "../server/routes/endpoints.ts";
import type { WorkspaceReviewSnapshot } from "../server/workspace-review.ts";
import type { AppRenderSnapshot } from "../state/app-store.ts";
import { systemTimeLocale } from "../utils/locale.ts";
import { renderAuthDialog } from "./auth-dialog.tsx";
import { projectBackendSignals } from "./backend-signals.ts";
import { renderCommandMenu } from "./command-menu.tsx";
import { renderDebugOverlay } from "./debug.tsx";
import { renderMessages } from "./messages.tsx";
import { renderSessionPicker, renderWorkspaceDialogMenu } from "./pickers.tsx";
import { renderPromptBox } from "./prompt-box.tsx";
import { renderSessionSidebar } from "./session-sidebar.tsx";
import { renderSessionTransition } from "./session-transition.tsx";
import { renderTreePicker } from "./tree-picker.tsx";
import { renderWorkspaceReview } from "./workspace-review.tsx";

const desktopStartupReadyScript = `addEventListener("load", () => {
	globalThis.piUiStartupLayoutGate?.arm();
	void bindings.piUiStartupReady();
}, { once: true });`;

// Hyprland can expose CEF's previous child viewport during its animated tile
// configure. A resize must remain unchanged across three compositor paints
// before CEF content is allowed to appear. The nearly opaque cover forces CEF
// to rasterize the application beneath it instead of occlusion-culling it.
const startupLayoutGateScript = `(() => {
	let armed = false;
	let generation = 0;
	let revealed = false;
	const reveal = (candidate) => {
		if (revealed || candidate !== generation) return;
		revealed = true;
		document.getElementById("startup-layout-cover")?.remove();
	};
	const resized = () => {
		if (!armed || revealed) return;
		const candidate = ++generation;
		requestAnimationFrame(() => requestAnimationFrame(() =>
			requestAnimationFrame(() => reveal(candidate))
		));
	};
	addEventListener("resize", resized, { passive: true });
	visualViewport?.addEventListener("resize", resized, { passive: true });
	globalThis.piUiStartupLayoutGate = { arm: () => { armed = true; } };
})();`;

export function renderPage(
	state: AppRenderSnapshot,
	workspaceReview: WorkspaceReviewSnapshot = emptyWorkspaceReview(),
): string {
	const desktop = typeof Deno.BrowserWindow === "function";
	const gateStartupLayout =
		desktop && Boolean(Deno.env.get("HYPRLAND_INSTANCE_SIGNATURE"));
	const initialSignals = JSON.stringify({
		prompt: "",
		...projectBackendSignals(state),
		modelCycleDirection: "forward",
		thinkingCycleDirection: "forward",
		_sessionLoading: false,
		_newSessionPending: false,
		workspaceDraft: "",
		_filePickerOpen: false,
		_fileSearchController: "",
		_slashPickerOpen: false,
		_workspaceReviewOpen: false,
		fileQuery: "",
		isDraggingFile: false,
		sessionDeletePath: "",
		sessionDeleteTitle: "",
		sessionDeleteHover: "",
		_workspacePickerError: "",
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
				{gateStartupLayout && <script>{startupLayoutGateScript}</script>}
				{desktop && <script>{desktopStartupReadyScript}</script>}
				<script src="/basecoat.js" defer></script>
				<script type="module" src="/app/main.js"></script>
				<script type="module" src="/vendor/datastar.js"></script>
				<script type="module" src="/build/workspace-review.js"></script>
				{state.datastarInspector && (
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
				data-time-locale={systemTimeLocale}
				data-native-file-picker={desktop ? "true" : "false"}
				data-files-pick-endpoint={endpoints.filesPick}
				data-files-import-endpoint={endpoints.filesImport}
				data-files-open-endpoint={endpoints.filesOpen}
				data-display-refresh-endpoint={endpoints.displayRefresh}
				data-workspace-review-endpoint={endpoints.workspaceReview}
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
				{gateStartupLayout && (
					<div
						id="startup-layout-cover"
						class="fixed inset-0 bg-background"
						style="z-index: 2147483647; opacity: 0.9999;"
						aria-hidden="true"
					/>
				)}
				{state.datastarInspector && <datastar-inspector />}
				{renderDebugOverlay(state)}
				<div
					id="file-drop-overlay"
					class="pointer-events-none fixed inset-0 z-50 items-center justify-center bg-background/55 opacity-0 backdrop-blur-sm transition-[opacity,display] transition-discrete duration-100 ease-out motion-reduce:duration-100 [&.file-drop-active]:opacity-100 starting:[&.file-drop-active]:opacity-0"
					style="display: none;"
					data-class:file-drop-active="$isDraggingFile"
					data-style:display="$isDraggingFile ? 'flex' : 'none'"
					aria-hidden="true"
				>
					<div
						class="flex scale-95 items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-card/95 px-5 py-4 text-sm text-card-foreground shadow-lg transition-[scale] duration-100 ease-out motion-reduce:scale-100 motion-reduce:transition-none [&.file-drop-card-active]:scale-100 starting:[&.file-drop-card-active]:scale-95"
						data-class:file-drop-card-active="$isDraggingFile"
					>
						<svg
							class="size-8 text-muted-foreground"
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
					class="pi-workspace-canvas fixed inset-0 overflow-hidden"
					style="--sidebar-width: 18rem;"
					data-class:pi-review-open="$_workspaceReviewOpen"
					data-on:pi-ui-workspace-review-open={`$_workspaceReviewOpen = evt.detail.open`}
					data-effect="window.piUi.workspaceReview.applyOpen($_workspaceReviewOpen)"
					data-init="@get('/stream')"
				>
					{renderSessionSidebar(state)}
					<div
						id="workspace-shell"
						class="absolute inset-0 min-h-0 min-w-0 transition-[margin] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
					>
						<section
							id="chat-pane"
							class="pi-raised-surface absolute grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden transition-[width,margin-left] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
							aria-label="Chat"
						>
							{renderMessages(
								state.messages,
								state.emptyChatHint,
								state.hasOlderMessages,
								state.sessions,
								state.models.some((model) => model.configured),
								state.sessionCatalogLoading,
							)}
							{renderSessionTransition(state)}
							{renderPromptBox(state, workspaceReview.isGitRepository)}
						</section>
						{renderWorkspaceReview(workspaceReview)}
					</div>
				</div>

				<div
					id="pickers-stream"
					class="hidden"
					data-init={`@get('${endpoints.pickersStream}', {
						filterSignals: { include: /^$/ },
						openWhenHidden: true,
						requestCancellation: 'cleanup',
					})`}
				/>

				{renderCommandMenu()}
				{renderAuthDialog(state.authDialog)}

				<dialog
					id="workspace-dialog"
					class="command-dialog"
					aria-label="Change workspace"
					onclick="if (event.target === this) this.close()"
				>
					<div class="command sm:max-w-2xl">
						<header class="pr-1">
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
								data-bind:workspace-draft
								attrs={{
									"data-on:input__debounce.50ms": `@get('${endpoints.workspaceSearch}', {
										filterSignals: { include: /^workspaceDraft$/ },
										requestCancellation: 'cleanup',
									})`,
								}}
							/>
							<button
								type="button"
								class="btn size-6 shrink-0 p-0"
								data-variant="outline"
								data-indicator:_workspace-picking
								data-attr:disabled="
									$_sessionTransitionLoading ||
									$_workspacePicking
								"
								data-on:click={`
									$_workspacePickerError = '';
									@post('${endpoints.workspacePick}', {
										filterSignals: { include: /^$/ },
									});
								`}
								aria-label="Browse for workspace folder"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="size-3.5"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path
										fill="none"
										stroke="currentColor"
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
									/>
								</svg>
							</button>
						</header>
						<p
							id="workspace-picker-error"
							class="pi-error-foreground px-3 pt-2 text-xs"
							role="alert"
							style="display: none"
							data-show="$_workspacePickerError"
							data-text="$_workspacePickerError"
						></p>
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
					<div class="command sm:max-w-2xl" data-filter="manual">
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
								data-bind:session-search=""
								attrs={{
									"data-on:input__debounce.100ms": `@get('${endpoints.sessionsSearch}', {
										filterSignals: { include: /^sessionSearch$/ },
										requestCancellation: 'cleanup',
									})`,
								}}
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
								data-on:click={`
									evt.target.closest('dialog').close();
									@post('${endpoints.sessionsDelete}', {
									filterSignals: { include: /^sessionDeletePath$/ },
								});
								`}
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

function emptyWorkspaceReview(): WorkspaceReviewSnapshot {
	return {
		branch: null,
		changes: [],
		commits: [],
		isGitRepository: false,
		patch: "",
		revision: "non-git",
	};
}
