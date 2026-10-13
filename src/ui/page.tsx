import {
	toggleMinimalModeAction,
	toggleToolOutputAction,
} from "#src/commands/actions.ts";
import { activeFontStacks } from "#src/fonts.ts";
import { activeKeybind, keybindActions } from "#src/keybinds.ts";
import { getPierreThemes } from "#src/pierre-theme.ts";
import {
	endpoints,
	workspaceFilesBase,
	workspaceReviewBase,
} from "#src/server/routes/endpoints.ts";
import { sessionSidebarWidthDefault } from "#src/session-sidebar-types.ts";
import { renderAuthDialog } from "#src/ui/auth-dialog.tsx";
import { projectBackendSignals } from "#src/ui/backend-signals.ts";
import { renderCodeThemeDialog } from "#src/ui/code-theme-dialog.tsx";
import { renderCommandMenu, resetCommandDialogOnOpen } from "#src/ui/command-menu.tsx";
import { renderDebugOverlay } from "#src/ui/debug.tsx";
import { renderExtensionDialog } from "#src/ui/extension-dialog.tsx";
import { renderFontDialog } from "#src/ui/font-dialog.tsx";
import { Icon } from "#src/ui/icon.tsx";
import { ShortcutTooltip } from "#src/ui/keyboard.tsx";
import { renderLlamaDialog } from "#src/ui/llama-dialog.tsx";
import { renderMessages } from "#src/ui/messages.tsx";
import { renderSessionPicker, renderWorkspaceDialogMenu } from "#src/ui/pickers.tsx";
import { renderPromptBox } from "#src/ui/prompt-box.tsx";
import type { AppRenderSnapshot } from "#src/ui/render-state.ts";
import { renderSessionSidebar } from "#src/ui/session-sidebar.tsx";
import {
	previousSessionAction,
	renderSessionTransition,
} from "#src/ui/session-transition.tsx";
import { syncHtml } from "#src/ui/sync-html.ts";
import { renderThemeLab } from "#src/ui/theme-lab.tsx";
import { renderToolbar } from "#src/ui/toolbar.tsx";
import { renderTreePicker } from "#src/ui/tree-picker.tsx";
import { renderWorkspaceReview } from "#src/ui/workspace-review.tsx";
import {
	renderBranchDeleteDialog,
	renderWorktreeDialog,
	renderWorktreeRemoveDialog,
} from "#src/ui/worktree-dialog.tsx";
import { gitPaneRatioDefault } from "#src/workspace-review-types.ts";

export type PageRenderOptions = {
	appVersion?: string;
	sessionSidebarOpen?: boolean;
	sessionSidebarWidth?: number;
	themeLab?: boolean;
};

export function renderPage(
	state: AppRenderSnapshot,
	{
		appVersion = "development",
		sessionSidebarOpen = true,
		sessionSidebarWidth = sessionSidebarWidthDefault,
		themeLab = false,
	}: PageRenderOptions = {},
): string {
	const staticBase = `/static/${appVersion}`;
	const codeThemes = getPierreThemes();
	const fonts = activeFontStacks();
	const initialSignals = JSON.stringify(projectBackendSignals(state));

	return syncHtml(
		"<!doctype html>" +
		(
			<html
				lang="en"
				style={`--font-sans: ${fonts.sans}; --font-mono: ${fonts.mono};`}
				data-theme-lab={themeLab || undefined}
			>
				<head>
					<meta charset="utf-8" />
					<meta
						name="viewport"
						content="width=device-width, initial-scale=1, interactive-widget=resizes-content"
					/>
					<meta name="text-scale" content="scale" />
					<meta name="color-scheme" content="light dark" />
					<script>{`try{var m=document.querySelector('meta[name="color-scheme"]');var s=null;try{s=localStorage.getItem("color-scheme")}catch(e){}m.content=s==="light"||s==="dark"?s:"light dark"}catch(e){}`}</script>
					<meta name="theme-color" content="" />
					<meta name="apple-mobile-web-app-title" content="pi-ui" />
					<title id="document-title" safe>
						{state.documentTitle}
					</title>
					<link rel="manifest" href={`${staticBase}/manifest.webmanifest`} />
					<link
						rel="icon"
						type="image/svg+xml"
						href={`${staticBase}/favicon.svg`}
					/>
					<link rel="apple-touch-icon" href={`${staticBase}/icon-180.png`} />
					<script src={`${staticBase}/theme.js`}></script>
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
					data-keybind-hints={state.keybindHints}
					data-minimal-mode={state.minimalMode}
					data-thinking-hidden={state.thinkingHidden}
					data-files-import-endpoint={endpoints.filesImport}
					data-files-open-endpoint={endpoints.filesOpen}
					data-workspace-files-endpoint={workspaceFilesBase}
					data-workspace-review-endpoint={workspaceReviewBase}
					data-code-theme-light={codeThemes.light}
					data-code-theme-dark={codeThemes.dark}
					data-attr:data-code-theme-light="$_codeThemeLight"
					data-attr:data-code-theme-dark="$_codeThemeDark"
					data-toolbar-hidden={state.toolbarHidden}
					data-init={`@get('${endpoints.notificationsStream}', {
						payload: {},
						openWhenHidden: true,
						retry: 'always',
						retryMaxCount: Infinity,
						requestCancellation: 'cleanup',
					})`}
					data-signals={initialSignals}
					data-attr:data-keybind-hints="$_keybindHints"
					data-attr:data-minimal-mode="$_minimalMode"
					data-attr:data-thinking-hidden="$_thinkingHidden"
					data-attr:data-toolbar-hidden="$_toolbarHidden"
					data-effect={`
						window.piUi.fonts.apply($_fontMono, $_fontSans);
						window.dispatchEvent(
							new CustomEvent('pi-ui-code-theme-changed', {
								detail: { light: $_codeThemeLight, dark: $_codeThemeDark },
							}),
						);
					`}
					data-on:keydown__window={keybindActions(
						["toggle-minimal-mode", toggleMinimalModeAction()],
						["toggle-tool-output", toggleToolOutputAction()],
						["previous-session", previousSessionAction()],
					)}
					data-on:pi-ui-session-performance={`@post('${endpoints.sessionPerformanceClient}', { payload: evt.detail })`}
					data-on:pi-ui-workspace-review-preferences={`
						$workspaceReviewPreferences = {
							...$workspaceReviewPreferences,
							...evt.detail,
						};
						@post('${endpoints.workspaceReviewPreferences}', {
							payload: { workspaceReviewPreferences: evt.detail },
						});
					`}
					data-on:pi-ui-workspace-review-submit={`
						$workspaceReviewComments = evt.detail;
						@post('${endpoints.workspaceReviewSubmit}', {
							retryMaxCount: 0,
							filterSignals: { include: /^workspaceReviewComments\\./ },
						});
					`}
					data-signals__ifmissing={JSON.stringify({
						_isDraggingFile: false,
						_sessionLoading: false,
						_sessionTransitionPending: false,
						_newSessionPending: false,
						sessionSearch: "",
						modelSearch: "",
						workspaceDraft: "",
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
						<div class="file-drop-card">
							<Icon name="file-up" />
							<span>Drop files to attach</span>
						</div>
					</div>
					<div
						id="app"
						class={[
							"workspace-canvas app-shell",
							state.isTemporarySession && "temporary-chat",
						]}
						data-class:review-open="$_workspaceReviewOpen"
						data-class:temporary-chat="$_temporarySession"
						data-on-signal-patch-filter="{ include: /^slashSearch$/ }"
						data-on-signal-patch={`@post('${endpoints.slashSearch}', {
							payload: { slashSearch: $slashSearch },
						})`}
						data-on:pi-ui-workspace-review-open={`$_workspaceReviewOpen = evt.detail.open`}
						data-effect="window.piUi.workspaceReview.applyOpen($_workspaceReviewOpen)"
						data-signals:_workspace-review-open__ifmissing="false"
						data-init={`@get('${endpoints.stream}?appVersion=${appVersion}', {
							filterSignals: { include: /^(sessionSearch|workspaceDraft|slashSearch)$/ },
							retry: 'always',
							retryMaxCount: Infinity,
							requestCancellation: 'cleanup',
						})`}
					>
						{renderSessionSidebar(state, {
							open: sessionSidebarOpen,
							width: sessionSidebarWidth,
						})}
						<div
							id="workspace-shell"
							class="workspace-shell"
							style={`--session-sidebar-preferred-width: ${sessionSidebarWidth}px;`}
							data-style={`{
								'--session-sidebar-preferred-width': $_sessionSidebarWidth + 'px',
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
									state.minimalMode || state.toolOutputHidden,
								)}
								{renderSessionTransition(state)}
								{renderPromptBox(state)}
							</section>
							<div class="toolbar">
								{renderToolbar(state, true)}
								<button
									id="session-sidebar-toggle"
									type="button"
									class="btn session-sidebar-toggle"
									data-variant="ghost"
									data-attr:data-variant="$_sessionSidebarOpen ? 'secondary' : 'ghost'"
									data-size="icon-sm"
									aria-label="Toggle sessions"
									commandfor="session-sidebar"
									command="--toggle"
									aria-controls="session-sidebar"
									aria-expanded="false"
									data-attr:aria-expanded="$_sessionSidebarOpen ? 'true' : 'false'"
									data-tooltip="Toggle sessions"
									data-tooltip-delay
									data-align="end"
								>
									<Icon name="panel-right" />
									<ShortcutTooltip
										label="Toggle sessions"
										shortcut={activeKeybind("toggle-sessions")}
									/>
								</button>
							</div>
							{renderWorkspaceReview(
								state.workspacePath,
								state.workspaceFilesRevision,
								state.workspaceTreeRevision,
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
					{renderWorktreeDialog()}
					{renderWorktreeRemoveDialog()}
					{renderBranchDeleteDialog()}

					<dialog
						id="workspace-dialog"
						class="command-dialog command-medium"
						aria-label="Change workspace"
						data-on:toggle={resetCommandDialogOnOpen}
						data-attr:aria-label="$_workspaceAction === 'fork' ? 'Fork session to workspace' : 'Change workspace'"
						data-preserve-attr="open"
						data-signals:_workspace-action__ifmissing="'open'"
						closedby="any"
					>
						<div class="command">
							<search
								class="workspace-command-header"
								aria-label="Search workspaces"
							>
								<input
									id="workspace-input"
									class="workspace-command-input"
									type="text"
									placeholder="Type a path or search workspaces..."
									data-attr:placeholder="
										$_workspaceAction === 'fork'
											? 'Choose a destination workspace...'
											: 'Type a path or search workspaces...'
									"
									autocomplete="off"
									autocorrect="off"
									spellcheck="false"
									aria-autocomplete="list"
									role="combobox"
									aria-expanded="true"
									aria-controls="workspace-menu"
									autofocus
									data-bind:workspace-draft
									attrs={{
										"data-on:input__debounce.50ms": `@post('${endpoints.workspaceSearch}', {
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
									commandfor="workspace-browser-dialog"
									command="show-modal"
									data-on:click={`
										$_workspaceBrowserShowHidden = false;
										el.closest('dialog').close();
										@get('${endpoints.workspaceBrowse}', {
										payload: {
											workspacePath: $workspaceDraft || ${JSON.stringify(state.workspacePath)},
											showHidden: false,
										},
										requestCancellation: 'cleanup',
									});
									`}
								>
									<Icon name="folder-open" />
								</button>
							</search>
							{renderWorkspaceDialogMenu(state)}
						</div>
					</dialog>

					<dialog
						id="workspace-browser-dialog"
						class="dialog workspace-browser-dialog"
						aria-labelledby="workspace-browser-title"
						data-signals:_workspace-browser-show-hidden__ifmissing="false"
						data-preserve-attr="open"
						closedby="any"
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
						class="command-dialog command-tree"
						aria-label="Session tree"
						data-on:beforetoggle="if (evt.newState === 'open') $treeSelectedId = '';"
						data-on:toggle={`${resetCommandDialogOnOpen}
						if (evt.newState === 'open') {
						const active = el.querySelector('[data-active-tree-row]');
						if (active) {
						window.piUi.controls.activate(el.querySelector('.command'), active);
						active.scrollIntoView({ block: 'center' });
						}
						}`}
						data-signals__ifmissing={JSON.stringify({
							treeSelectedId: "",
							treeCustomSummary: false,
							treeSummaryInstructions: "",
						})}
						data-preserve-attr="open"
						data-style:max-width="$treeSelectedId ? '24rem' : '72rem'"
						closedby="any"
					>
						<div
							class="command"
							style="height: calc(100dvh - 2rem)"
							data-style:height="$treeSelectedId ? 'auto' : 'calc(100dvh - 2rem)'"
						>
							<search
								aria-label="Search tree"
								data-class:sr-only="$treeSelectedId"
							>
								<Icon name="search" />
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
									data-bind:_tree-query
									data-effect="
										$_treeQuery;
										queueMicrotask(() => window.piUi.controls.refresh(el.closest('.command')));
									"
								/>
							</search>
							{renderTreePicker(state)}
						</div>
					</dialog>

					<dialog
						id="session-dialog"
						class="command-dialog command-wide"
						aria-label="Resume session"
						data-on:toggle={resetCommandDialogOnOpen}
						data-preserve-attr="open"
						closedby="any"
					>
						<div class="command">
							<search aria-label="Search sessions">
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
										"data-on:input__debounce.100ms": `@post('${endpoints.sessionsSearch}', {
										payload: { sessionSearch: $sessionSearch },
										requestCancellation: 'cleanup',
									})`,
									}}
									autofocus
								/>
							</search>
							{renderSessionPicker(state)}
						</div>
					</dialog>

					<dialog
						id="session-delete-dialog"
						class="dialog"
						aria-labelledby="session-delete-title"
						aria-describedby="session-delete-description"
						closedby="any"
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
									?
									<br />
									This action can’t be undone.
								</p>
							</header>
							<footer>
								<button
									type="button"
									class="btn"
									data-variant="outline"
									commandfor="session-delete-dialog"
									command="close"
								>
									Cancel
								</button>
								<button
									type="button"
									class="btn"
									data-variant="destructive"
									commandfor="session-delete-dialog"
									command="close"
									data-attr:disabled="$sessionDeletePath === ''"
									data-on:click={`@post('${endpoints.sessionsDelete}', {
										retryMaxCount: 0,
										payload: { sessionDeletePath: $sessionDeletePath },
									})`}
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
