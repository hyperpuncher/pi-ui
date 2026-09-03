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
import { renderThemeLab } from "./theme-lab.tsx";
import { renderTreePicker } from "./tree-picker.tsx";
import { renderWorkspaceReview } from "./workspace-review.tsx";

// Restore the persisted width before CSS can paint. Datastar takes ownership
// after initialization, avoiding a transition from the default on every reload.
const sessionSidebarStartupScript = `try {
	const stored = Number(localStorage.getItem("${sessionSidebarStorageKey}"));
	if (Number.isFinite(stored) && stored > 0) {
		document.documentElement.style.setProperty(
			"--session-sidebar-width",
			"clamp(var(--session-sidebar-min-width), " + stored + "px, min(var(--session-sidebar-max-width), 50vw))",
		);
	}
} catch {}`;

export function renderPage(
	state: AppRenderSnapshot,
	appVersion = "development",
	keybindHints = true,
	minimalMode = false,
	toolOutputHidden = false,
	themeLab = false,
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
				style={`--session-sidebar-width: var(--session-sidebar-default-width); --font-sans: ${fonts.sans}; --font-mono: ${fonts.mono};`}
				data-theme-lab={themeLab || undefined}
			>
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<meta name="theme-color" content="oklch(10% 0 none)" />
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
					{themeLab && (
						<link rel="stylesheet" href={`${staticBase}/theme-lab.css`} />
					)}
					<script type="module" src={`${staticBase}/build/main.js`}></script>
					{themeLab && (
						<script
							type="module"
							src={`${staticBase}/build/theme-lab.js`}
						></script>
					)}
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
					{themeLab && renderThemeLab()}
					{renderDebugOverlay(state)}
					<div
						id="file-drop-overlay"
						class="file-drop-overlay"
						style="display: none;"
						data-class:file-drop-active="$_isDraggingFile"
						data-style:display="$_isDraggingFile ? 'flex' : 'none'"
						aria-hidden="true"
					>
						<div
							class="file-drop-card"
							data-class:file-drop-card-active="$_isDraggingFile"
						>
							<Icon icon={FileUp} class="file-drop-icon" />
							<span>Drop files to attach</span>
						</div>
					</div>
					<div
						id="app"
						class="workspace-canvas app-shell"
						data-class:review-open="$_workspaceReviewOpen"
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
							class="workspace-shell"
							{...{
								"data-style:--session-sidebar-margin":
									sessionSidebarMarginRightExpression,
							}}
							data-style={`{
								'--review-pane-ratio': $workspaceReviewPreferences.gitPaneRatio || ${gitPaneRatioDefault},
							}`}
						>
							<section
								id="chat-pane"
								class="raised-surface chat-pane"
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
						data-attr:aria-label="$_workspaceAction === 'fork' ? 'Fork session to workspace' : 'Change workspace'"
						data-preserve-attr="open"
						data-signals:_workspace-action__ifmissing="'open'"
						data-signals:workspace-draft__ifmissing="''"
						onclick="if (event.target === this) this.close()"
					>
						<div class="command command-medium">
							<header class="workspace-command-header">
								<input
									id="workspace-input"
									class="workspace-command-input"
									type="text"
									placeholder="Type a path or search workspaces..."
									data-attr:placeholder="$_workspaceAction === 'fork'
										? 'Choose a destination workspace...'
										: 'Type a path or search workspaces...'"
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
									class="btn workspace-browse-button"
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
							class="workspace-browser-loading"
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
							class="command command-tree"
							style="height: calc(100% - 2rem)"
							data-style:height="$treeSelectedId ? 'auto' : 'calc(100% - 2rem)'"
							data-style:max-width="$treeSelectedId ? '24rem' : '72rem'"
						>
							<header data-class:sr-only="$treeSelectedId">
								<Icon icon={Search} />
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
						<div class="command command-wide" data-filter="manual">
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
						<div class="dialog-medium">
							<header>
								<h2 id="session-delete-title">Delete session?</h2>
								<p id="session-delete-description">
									Are you sure you want to delete{" "}
									<strong
										class="dialog-emphasis"
										data-text="$sessionDeleteTitle"
									>
										the selected session
									</strong>
									? This action can’t be undone.
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
