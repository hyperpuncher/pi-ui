import type { AppState } from "../state/app-state.ts";
import { renderModelPicker, renderTopbar, renderTranscript } from "./fragments.tsx";

function sync(html: JSX.Element): string {
	return html as string;
}

export function renderPage(state: AppState): string {
	const initialSignals = JSON.stringify({
		composer: "",
		commandOpen: false,
		connected: false,
		model: state.currentModel ?? "",
	});

	return (
		"<!doctype html>" +
		sync(
			<html lang="en" class="h-full">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>pi-ui</title>
					<link rel="stylesheet" href="/app.css" />
					<script type="module" src="/app.js"></script>
					<script type="module" src="/datastar.js"></script>
				</head>
				<body
					class="h-full"
					data-signals={initialSignals}
					data-on:keydown__window="if ((evt.ctrlKey || evt.metaKey) && evt.key === 'k') {
						evt.preventDefault();
						$commandOpen = !$commandOpen;
					}
					if (evt.key === 'Escape') $commandOpen = false"
				>
					<div
						id="app"
						class="grid h-dvh w-dvw grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
						data-init="@get('/stream')"
					>
						{renderTopbar(state)}
						{renderTranscript(state.messages)}

						<div
							id="composer"
							class="card fixed bottom-8 left-1/2 z-10 w-[min(58rem,calc(100vw-2rem))] -translate-x-1/2 p-4"
						>
							<textarea
								class="min-h-24 w-full resize-none border-0 bg-transparent p-1 outline-none"
								placeholder="Ask pi anything..."
								aria-label="Message"
								data-bind:composer
								data-indicator:_prompting
								data-on:keydown="if ((evt.ctrlKey || evt.metaKey) && evt.key === 'Enter') {
									evt.preventDefault();
									@post('/prompt', { filterSignals: { include: /^composer$/ } });
								}"
							></textarea>
							<div class="mt-3 flex items-center justify-between gap-4">
								<div
									class="flex items-center gap-2"
									aria-label="Message tools"
								>
									<button
										class="btn"
										data-variant="ghost"
										data-size="icon-sm"
										type="button"
										title="Attach file"
									>
										⌘
									</button>
									<button
										class="btn"
										data-variant="ghost"
										data-size="icon-sm"
										type="button"
										title="Files"
									>
										@
									</button>
									<button
										class="btn"
										data-variant="ghost"
										data-size="icon-sm"
										type="button"
										data-on:click="$commandOpen = true"
										title="Commands"
									>
										/
									</button>
								</div>
								<div class="flex min-w-0 items-center justify-end gap-2">
									<span
										class="text-muted-foreground text-sm"
										data-text="$_prompting ? 'sending…' : $connected ? 'connected' : 'connecting…'"
									>
										connecting…
									</span>
									{renderModelPicker(state)}
									<button
										class="btn"
										data-variant="outline"
										type="button"
										data-on:click="@post('/abort')"
									>
										Abort
									</button>
									<button
										class="btn"
										data-size="icon"
										type="button"
										data-indicator:_prompting
										data-on:click="@post('/prompt', { filterSignals: { include: /^composer$/ } })"
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
									data-on:click="$commandOpen = false"
									aria-label="Close"
								>
									×
								</button>
							</header>
							<input
								class="input w-full"
								autofocus
								placeholder="Type a command..."
								aria-label="Command search"
							/>
							<ul class="mt-3 list-none p-0">
								<li>
									<button
										class="hover:bg-muted flex w-full items-center justify-between rounded-md border-0 bg-transparent px-3 py-2 text-left"
										type="button"
										data-on:click="@post('/sessions/new')"
									>
										New chat <kbd class="kbd">Ctrl O</kbd>
									</button>
								</li>
								<li>
									<button
										class="hover:bg-muted flex w-full items-center justify-between rounded-md border-0 bg-transparent px-3 py-2 text-left"
										type="button"
										data-on:click="
											$commandOpen = false;
											document.getElementById('model-select')?.focus();
										"
									>
										Switch model <kbd class="kbd">Ctrl M</kbd>
									</button>
								</li>
								<li>
									<button
										class="hover:bg-muted flex w-full items-center justify-between rounded-md border-0 bg-transparent px-3 py-2 text-left"
										type="button"
									>
										Settings
									</button>
								</li>
								<li>
									<button
										class="hover:bg-muted flex w-full items-center justify-between rounded-md border-0 bg-transparent px-3 py-2 text-left"
										type="button"
									>
										Toggle vim mode
									</button>
								</li>
							</ul>
						</div>
					</div>
				</body>
			</html>,
		)
	);
}
