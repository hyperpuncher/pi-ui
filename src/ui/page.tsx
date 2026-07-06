import type { AppState } from "../state/app-state.ts";
import { renderCommandMenu } from "./command-menu.tsx";
import { renderDebugOverlay } from "./debug.tsx";
import { renderMessages } from "./messages.tsx";
import { renderSessionPicker, renderWorkspaceDialogMenu } from "./pickers.tsx";
import { renderPromptBox } from "./prompt-box.tsx";
import { renderTreePicker } from "./tree-picker.tsx";

export function renderPage(state: AppState): string {
	const initialSignals = JSON.stringify({
		prompt: "",
		model: state.currentModel ?? "",
		thinkingLevel: state.thinkingLevel,
		workspacePath: state.workspacePath,
		sessionPath: "",
		treeEntryId: "",
		treeSummarize: false,
		treeSummaryInstructions: "",
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
				spellcheck="false"
				data-workspace-path={state.workspacePath}
				data-signals={initialSignals}
			>
				<datastar-inspector />
				{renderDebugOverlay(state)}
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
					)}

					{renderPromptBox(state)}
				</div>

				{renderCommandMenu()}

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
