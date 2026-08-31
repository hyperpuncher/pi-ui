import { toggleMinimalModeAction, toggleToolOutputAction } from "../commands/actions.ts";
import { activeFontStacks } from "../fonts.ts";
import { getPierreThemes } from "../pierre-theme.ts";
import {
	endpoints,
	workspaceFilesBase,
	workspaceReviewBase,
} from "../server/routes/endpoints.ts";
import { gitPaneRatioDefault } from "../workspace-review-types.ts";
import { renderAuthDialog } from "./auth-dialog.tsx";
import { projectBackendSignals } from "./backend-signals.ts";
import { renderCodeThemeDialog } from "./code-theme-dialog.tsx";
import { renderCommandMenu } from "./command-menu.tsx";
import { renderDebugOverlay } from "./debug.tsx";
import { renderExtensionDialog } from "./extension-dialog.tsx";
import { renderFontDialog } from "./font-dialog.tsx";
import { Icon } from "./icon.tsx";
import { FileUp, FolderOpen, Search } from "./icons.ts";
import { altShortcutAction } from "./keyboard.tsx";
import { renderLlamaDialog } from "./llama-dialog.tsx";
import { renderMessages } from "./messages.tsx";
import { renderSessionPicker, renderWorkspaceDialogMenu } from "./pickers.tsx";
import { renderPromptBox } from "./prompt-box.tsx";
import type { AppRenderSnapshot } from "./render-state.ts";
import {
	renderSessionSidebar,
	sessionSidebarMarginRightExpression,
	sessionSidebarStorageKey,
} from "./session-sidebar.tsx";
import { renderSessionTransition } from "./session-transition.tsx";
import { syncHtml } from "./sync-html.ts";
import { renderTreePicker } from "./tree-picker.tsx";
import { renderWorkspaceReview } from "./workspace-review.tsx";

// Restore the persisted width before CSS can paint. Datastar takes ownership
// after initialization, avoiding a transition from the default on every reload.
const sessionSidebarStartupScript = `try {
	const stored = Number(localStorage.getItem("${sessionSidebarStorageKey}"));
	if (Number.isFinite(stored) && stored > 0) {
		document.documentElement.style.setProperty(
			"--sidebar-width",
			"clamp(var(--pi-session-sidebar-min-width), " + stored + "px, min(var(--pi-session-sidebar-max-width), 50vw))",
		);
	}
} catch {}`;

export function renderPage(
	state: AppRenderSnapshot,
	appVersion = "development",
	keybindHints = true,
	minimalMode = false,
	toolOutputHidden = false,
): string {
	const staticBase = `/static/${appVersion}`;
	const codeThemes = getPierreThemes();
	const fonts = activeFontStacks();
	const displayClientId = crypto.randomUUID();
	const initialSignals = JSON.stringify(projectBackendSignals(state));

	return syncHtml(
		"<!doctype html>" +
		(
			<html
				lang="en"
				class="h-full overflow-hidden"
				style={`--sidebar-width: var(--pi-session-sidebar-default-width); --font-sans: ${fonts.sans}; --font-mono: ${fonts.mono};`}
			>
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<meta name="theme-color" content="#09090b" />
					<meta name="apple-mobile-web-app-title" content="pi-ui" />
					<title safe>{state.documentTitle}</title>
					<link rel="manifest" href={`${staticBase}/manifest.webmanifest`} />
					<link
						rel="icon"
						type="image/svg+xml"
						href={`${staticBase}/favicon.svg`}
					/>
					<link rel="apple-touch-icon" href={`${staticBase}/icon-180.png`} />
					<script src={`${staticBase}/theme.js`}></script>
					<script>{sessionSidebarStartupScript}</script>
					<link rel="stylesheet" href={`${staticBase}/app.css`} />
					<script src="/basecoat.js" defer></script>
					<script type="module" src={`${staticBase}/build/main.js`}></script>
					<script
						type="module"
						src={`${staticBase}/vendor/datastar.js`}
					></script>
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
					data-keybind-hints={keybindHints}
					data-minimal-mode={minimalMode}
					data-files-import-endpoint={endpoints.filesImport}
					data-files-open-endpoint={endpoints.filesOpen}
					data-workspace-files-endpoint={workspaceFilesBase}
					data-workspace-review-endpoint={workspaceReviewBase}
					data-code-theme-light={codeThemes.light}
					data-code-theme-dark={codeThemes.dark}
					data-attr:data-code-theme-light="$_codeThemeLight"
					data-attr:data-code-theme-dark="$_codeThemeDark"
					data-signals={initialSignals}
					data-signals:_minimal-mode__ifmissing={minimalMode ? "true" : "false"}
					data-signals:_tool-output-hidden__ifmissing={
						toolOutputHidden ? "true" : "false"
					}
					data-attr:data-minimal-mode="$_minimalMode"
					data-effect={`
						window.piUi.fonts.apply($_fontMono, $_fontSans);
						window.dispatchEvent(
							new CustomEvent('pi-ui-code-theme-changed', {
								detail: { light: $_codeThemeLight, dark: $_codeThemeDark },
							}),
						);
					`}
					data-on:keydown__window={`${altShortcutAction(
						"KeyM",
						toggleMinimalModeAction(),
					)} ${altShortcutAction("KeyO", toggleToolOutputAction())}`}
					data-on:pi-ui-display-refresh={`@post('${endpoints.displayRefresh}', {
						payload: { clientId: '${displayClientId}', hz: evt.detail.hz },
					})`}
					data-on:pi-ui-session-performance={`@post('${endpoints.sessionPerformanceClient}', { payload: evt.detail })`}
					data-on:pi-ui-workspace-review-preferences={`
						$workspaceReviewPreferences = {
							...$workspaceReviewPreferences,
							...evt.detail,
						};
						@post('${endpoints.workspaceReviewPreferences}', {
							filterSignals: { include: /^workspaceReviewPreferences\\./ },
						});
					`}
					data-on:pi-ui-workspace-review-submit={`
						$workspaceReviewComments = evt.detail;
						@post('${endpoints.workspaceReviewSubmit}', {
							filterSignals: { include: /^workspaceReviewComments\\./ },
						});
					`}
					data-signals__ifmissing={JSON.stringify({
						_isDraggingFile: false,
						_sessionLoading: false,
						_newSessionPending: false,
						workspaceReviewComments: { comments: [] },
						workspaceReviewPreferences: state.workspaceReviewPreferences,
						sessionDeletePath: "",
						sessionDeleteTitle: "",
						sessionRenamePath: "",
						sessionRenameTitle: "",
					})}
					data-on:dragenter__window={`if (window.piUi.fileTransfer.hasFiles(evt.dataTransfer)) {
						evt.preventDefault();
						$_isDraggingFile = window.piUi.fileTransfer.enterDrag();
					}`}
					data-on:dragleave__window={`if (window.piUi.fileTransfer.hasFiles(evt.dataTransfer)) {
						$_isDraggingFile = window.piUi.fileTransfer.leaveDrag();
					}`}
					data-on:dragover__window={`if (window.piUi.fileTransfer.hasFiles(evt.dataTransfer)) {
						evt.preventDefault();
						evt.dataTransfer.dropEffect = 'copy';
					}`}
					data-on:drop__window={`if (window.piUi.fileTransfer.hasFiles(evt.dataTransfer)) {
						evt.preventDefault();
						$_isDraggingFile = false;
						window.piUi.fileTransfer.resetDrag();
						window.piUi.fileTransfer.insert(evt.dataTransfer);
					}`}
				>
					{state.datastarInspector && <datastar-inspector />}
					{renderDebugOverlay(state)}
					<div
						id="file-drop-overlay"
						class="pointer-events-none fixed inset-0 z-50 items-center justify-center bg-background/55 opacity-0 backdrop-blur-sm transition-[opacity,display] transition-discrete duration-100 ease-out motion-reduce:duration-100 [&.file-drop-active]:opacity-100 starting:[&.file-drop-active]:opacity-0"
						style="display: none;"
						data-class:file-drop-active="$_isDraggingFile"
						data-style:display="$_isDraggingFile ? 'flex' : 'none'"
						aria-hidden="true"
					>
						<div
							class="flex scale-95 items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-card/95 px-5 py-4 text-sm text-card-foreground shadow-lg transition-[scale] duration-100 ease-out motion-reduce:scale-100 motion-reduce:transition-none [&.file-drop-card-active]:scale-100 starting:[&.file-drop-card-active]:scale-95"
							data-class:file-drop-card-active="$_isDraggingFile"
						>
							<Icon icon={FileUp} class="size-8 text-muted-foreground" />
							<span>Drop files to attach</span>
						</div>
					</div>
					<div
						id="app"
						class="pi-workspace-canvas fixed inset-0 overflow-hidden"
						data-class:pi-review-open="$_workspaceReviewOpen"
						data-on:pi-ui-workspace-review-open={`$_workspaceReviewOpen = evt.detail.open`}
						data-effect="window.piUi.workspaceReview.applyOpen($_workspaceReviewOpen)"
						data-signals:_workspace-review-open__ifmissing="false"
						data-init={`@get('${endpoints.stream}?clientId=${displayClientId}&appVersion=${appVersion}', {
						payload: {},
						retry: 'always',
						retryMaxCount: Infinity,
						requestCancellation: 'cleanup',
					})`}
					>
						{renderSessionSidebar(state)}
						<div
							id="workspace-shell"
							class="@container/workspace absolute inset-0 grid min-h-0 min-w-0 transition-[margin] duration-150 ease-(--pi-ease-out) peer-aria-[hidden=true]/sidebar:mr-0! motion-reduce:transition-none"
							data-style:margin-right={sessionSidebarMarginRightExpression}
							data-style={`{
								'--pi-review-pane-ratio': $workspaceReviewPreferences.gitPaneRatio || ${gitPaneRatioDefault},
							}`}
						>
							<section
								id="chat-pane"
								class="pi-raised-surface grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden transition-[width,margin-left] duration-150 ease-(--pi-ease-out) motion-reduce:transition-none"
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
								{renderPromptBox(state, true)}
							</section>
							{renderWorkspaceReview(
								state.workspacePath,
								state.workspaceFilesRevision,
								state.workspaceReview,
								state.workspaceReviewPreferences,
							)}
						</div>
					</div>

					{renderCommandMenu()}
					{renderCodeThemeDialog()}
					{renderFontDialog()}
					{renderAuthDialog(state.authDialog)}
					{renderExtensionDialog(state.extensionDialog)}
					{renderLlamaDialog(state.llamaDialog)}

					<dialog
						id="workspace-dialog"
						class="command-dialog"
						aria-label="Change workspace"
						data-preserve-attr="open"
						data-signals:workspace-draft__ifmissing="''"
						onclick="if (event.target === this) this.close()"
					>
						<div class="command sm:max-w-md">
							<header class="relative pr-1">
								<input
									id="workspace-input"
									class="pr-10"
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
										payload: { workspaceDraft: $workspaceDraft },
										requestCancellation: 'cleanup',
									})`,
									}}
								/>
								<button
									type="button"
									class="btn absolute top-1/2 right-2 size-7 -translate-y-1/2"
									data-variant="ghost"
									data-size="icon-xs"
									aria-label="Browse folders"
									data-on:click={`
										$_workspaceBrowserShowHidden = false;
										window.piUi.dialogs.openWorkspaceBrowser();
										@get('${endpoints.workspaceBrowse}', {
										payload: {
											workspacePath: document.getElementById('workspace-input')?.value || ${JSON.stringify(state.workspacePath)},
											showHidden: false,
										},
										requestCancellation: 'cleanup',
									});
									`}
								>
									<Icon icon={FolderOpen} />
								</button>
							</header>
							{renderWorkspaceDialogMenu(state)}
						</div>
					</dialog>

					<dialog
						id="workspace-browser-dialog"
						class="dialog workspace-browser-dialog"
						aria-labelledby="workspace-browser-title"
						data-signals:_workspace-browser-show-hidden__ifmissing="false"
						data-preserve-attr="open"
						onclick="if (event.target === this) this.close()"
					>
						<div
							id="workspace-browser-content"
							class="flex w-[min(30rem,calc(100vw-2rem))] max-w-none items-center justify-center p-8 text-sm text-muted-foreground"
						>
							Loading folders…
						</div>
					</dialog>

					<dialog
						id="tree-dialog"
						class="command-dialog"
						aria-label="Session tree"
						data-signals__ifmissing={JSON.stringify({
							treeSelectedId: "",
							treeCustomSummary: false,
							treeSummaryInstructions: "",
						})}
						data-preserve-attr="open"
						onclick="if (event.target === this) this.close()"
					>
						<div
							class="command sm:max-w-6xl"
							style="height: calc(100% - 2rem)"
							data-style:height="$treeSelectedId ? 'auto' : 'calc(100% - 2rem)'"
							data-style:max-width="$treeSelectedId ? '24rem' : '72rem'"
						>
							<header data-class:sr-only="$treeSelectedId">
								<Icon icon={Search} class="size-4" />
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
						data-preserve-attr="open"
						data-signals:session-search__ifmissing="''"
						onclick="if (event.target === this) this.close()"
					>
						<div class="command sm:max-w-xl" data-filter="manual">
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
									data-preserve-attr="aria-activedescendant"
									data-bind:session-search=""
									attrs={{
										"data-on:input__debounce.100ms": `@get('${endpoints.sessionsSearch}', {
										payload: { sessionSearch: $sessionSearch },
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
									payload: { sessionDeletePath: $sessionDeletePath },
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
		),
	);
}
