import type { AppState } from "../state/app-state.ts";
import { renderCommandMenu } from "./command-menu.tsx";
import { renderMessages } from "./messages.tsx";
import { renderSessionPicker } from "./pickers.tsx";
import { renderPromptBox } from "./prompt-box.tsx";

export function renderPage(state: AppState): string {
	const initialSignals = JSON.stringify({
		prompt: "",
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
					{renderMessages(state.messages, state.emptyChatHint)}

					{renderPromptBox(state)}
				</div>

				{renderCommandMenu()}

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
