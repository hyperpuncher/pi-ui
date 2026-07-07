import type { AppState, AppThinkingLevel, AppUsage } from "../state/app-state.ts";
import { formatHomePath } from "../utils/workspace.ts";
import { ShortcutKbd } from "./keyboard.tsx";
import { renderSlashPicker } from "./pickers.tsx";

export function renderPromptBox(state: AppState): string {
	return (
		<div
			id="prompt-box"
			class="input-group bg-card text-card-foreground ring-foreground/10 focus-within:ring-foreground/10 fixed bottom-6 left-1/2 z-10 w-[min(54rem,calc(100vw-2rem))] -translate-x-1/2 overflow-visible rounded-xl border-transparent p-3 text-sm shadow-lg ring-1 transition-none focus-within:border-transparent focus-within:ring-1"
			data-orientation="vertical"
		>
			<div
				id="prompt-slash-popover"
				class="bg-popover text-popover-foreground absolute right-0 bottom-full left-0 mb-2 rounded-md border p-1 shadow-md"
				style="display: none;"
			>
				{renderSlashPicker(state)}
			</div>
			<div
				id="prompt-file-popover"
				class="bg-popover text-popover-foreground absolute right-0 bottom-full left-0 mb-2 rounded-md border p-1 shadow-md"
				style="display: none;"
			>
				<ul
					id="file-picker-list"
					class="max-h-72 list-none overflow-y-auto p-1"
				/>
			</div>
			<textarea
				id="prompt-input"
				class="field-sizing-content max-h-44 min-h-7 resize-none overflow-y-auto p-1"
				placeholder="Ask pi anything..."
				aria-label="Message"
				rows="1"
				data-bind:prompt
				data-on:keydown={`if (
					evt.key === 'Escape' &&
					!evt.ctrlKey &&
					!evt.metaKey &&
					!evt.altKey &&
					!evt.shiftKey &&
					!$isBusy
				) {
					evt.preventDefault();
					el.blur();
				}`}
			></textarea>
			<footer
				class="flex flex-wrap items-center justify-between gap-2 p-0"
				data-align="end"
			>
				<div
					class="flex shrink-0 items-center gap-0.5"
					aria-label="Message tools"
				>
					<PromptToolbarButton label="Commands" action="commands">
						⌘
					</PromptToolbarButton>
					<PromptToolbarButton label="New chat" action="new-chat">
						+
					</PromptToolbarButton>
					<PromptToolbarButton label="Files" action="files">
						@
					</PromptToolbarButton>
					<PromptToolbarButton label="Resume session" action="sessions">
						↩
					</PromptToolbarButton>
				</div>
				<div class="flex min-w-0 flex-1 items-center justify-end gap-1.5">
					{renderPromptStatus(state)}
					{renderWorkspacePicker(state)}
					<span
						class="bg-border hidden h-4 w-px shrink-0 sm:block"
						aria-hidden="true"
					/>
					{renderModelPicker(state)}
					<span
						class="bg-border hidden h-4 w-px shrink-0 sm:block"
						aria-hidden="true"
					/>
					{renderThinkingPicker(state)}
					{renderPromptAction(state)}
				</div>
			</footer>
		</div>
	) as string;
}

type PromptToolbarAction = "commands" | "new-chat" | "files" | "sessions";

function PromptToolbarButton(props: {
	label: string;
	action: PromptToolbarAction;
	children: string;
}) {
	return (
		<button
			class="btn text-muted-foreground hover:text-foreground leading-none"
			data-variant="ghost"
			data-size="icon-sm"
			type="button"
			data-file-trigger={props.action === "files" ? "" : undefined}
			data-on:click={promptToolbarClickAction(props.action)}
			data-on:keydown__window={promptToolbarKeydownAction(props.action)}
			data-tooltip={props.label}
			aria-label={props.label}
		>
			{props.children}
		</button>
	);
}

function promptToolbarClickAction(action: PromptToolbarAction): string | undefined {
	if (action === "commands") return openCommandPaletteAction();
	if (action === "new-chat") return newChatAction();
	if (action === "sessions") return openSessionDialogAction();
	return undefined;
}

function promptToolbarKeydownAction(action: PromptToolbarAction): string | undefined {
	if (action === "commands") {
		return `if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'k') {
			evt.preventDefault();
			${openCommandPaletteAction()}
		}`;
	}
	if (action === "new-chat") {
		return `if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'o') {
			evt.preventDefault();
			${newChatAction()}
		}`;
	}
	if (action === "sessions") {
		return `if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'r') {
			evt.preventDefault();
			${openSessionDialogAction()}
		}`;
	}
	return undefined;
}

function openCommandPaletteAction(): string {
	return "document.getElementById('command-dialog')?.showModal(); requestAnimationFrame(() => document.getElementById('command-input')?.focus())";
}

function newChatAction(): string {
	return "@post('/sessions/new'); requestAnimationFrame(() => document.getElementById('prompt-input')?.focus())";
}

function openSessionDialogAction(): string {
	return "document.getElementById('session-dialog')?.showModal(); requestAnimationFrame(() => document.getElementById('session-input')?.focus())";
}

export function renderPromptAction(state: AppState): string {
	if (state.activityText) {
		return (
			<button
				id="prompt-action"
				class="btn leading-none"
				data-variant="destructive"
				data-size="icon"
				type="button"
				data-on:click="@post('/abort')"
				data-on:keydown__window="if (
					evt.key === 'Escape' &&
					!evt.ctrlKey &&
					!evt.metaKey &&
					!evt.altKey &&
					!evt.shiftKey
				) {
					evt.preventDefault();
					@post('/abort');
				}"
				data-tooltip="Abort"
				aria-label="Abort"
			>
				■
			</button>
		) as string;
	}

	return (
		<button
			id="prompt-action"
			class="btn leading-none"
			data-size="icon"
			type="button"
			data-send-trigger
			data-attr:disabled="$prompt.trim() === ''"
			data-on:click="@post('/prompt', { filterSignals: { include: /^prompt$/ } })"
			data-tooltip="Send"
			aria-label="Send"
		>
			↑
		</button>
	) as string;
}

export function renderPromptStatus(state: AppState): string {
	return (
		<span id="prompt-status" class="inline-flex min-w-0 shrink-0 items-center gap-2">
			{state.activityText && (
				<span class="text-muted-foreground inline-flex min-w-0 truncate font-mono text-xs">
					<span class="inline-flex items-center gap-1.5">
						{loaderIcon()}
						<span safe>{state.activityText}</span>
					</span>
				</span>
			)}
			<span class="inline-flex shrink-0 items-center gap-1">
				{renderUsageIndicator(state.usage)}
			</span>
		</span>
	) as string;
}

function renderUsageIndicator(usage: AppUsage): string {
	const contextPercent = usage.contextPercent ?? 0;
	const circumference = 2 * Math.PI * 10;
	return (
		<span class="inline-flex shrink-0 items-center gap-1.5 font-mono text-xs">
			<span
				class="inline-flex size-4 shrink-0 items-center justify-center"
				data-tooltip={usage.text}
				data-tooltip-multiline
				aria-label={usage.text}
			>
				{usageCircle({
					percent: contextPercent,
					circumference,
					className: contextUsageColor(contextPercent),
				})}
			</span>
			{usage.codexText && (
				<span
					class="inline-flex size-4 shrink-0 items-center justify-center"
					data-tooltip={`codex limits\n${usage.codexText.replace("  ", "\n")}`}
					data-tooltip-multiline
					aria-label={`codex limits • ${usage.codexText}`}
				>
					<svg class="size-4 -rotate-90" viewBox="0 0 24 24" aria-hidden="true">
						<circle
							cx="12"
							cy="12"
							r="10"
							fill="none"
							stroke="currentColor"
							stroke-width="3"
							class="text-muted-foreground/20"
						/>
						<circle
							cx="12"
							cy="12"
							r="10"
							fill="none"
							stroke="currentColor"
							stroke-width="3"
							stroke-linecap="round"
							class={codexUsageColor(
								usage.codexSecondaryPercent ?? 0,
								"secondary",
							)}
							stroke-dasharray={circumference}
							stroke-dashoffset={usageDashOffset(
								usage.codexSecondaryPercent ?? 0,
								circumference,
							)}
						/>
						<circle
							cx="12"
							cy="12"
							r="10"
							fill="none"
							stroke="currentColor"
							stroke-width="3"
							stroke-linecap="round"
							class={codexUsageColor(
								usage.codexPrimaryPercent ?? 0,
								"primary",
							)}
							stroke-dasharray={circumference}
							stroke-dashoffset={usageDashOffset(
								usage.codexPrimaryPercent ?? 0,
								circumference,
							)}
						/>
					</svg>
				</span>
			)}
		</span>
	) as string;
}

function usageCircle(props: {
	percent: number;
	circumference: number;
	className: string;
}): string {
	return (
		<svg class="size-4 -rotate-90" viewBox="0 0 24 24" aria-hidden="true">
			<circle
				cx="12"
				cy="12"
				r="10"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				class="text-muted-foreground/30"
			/>
			<circle
				cx="12"
				cy="12"
				r="10"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				stroke-linecap="round"
				class={props.className}
				stroke-dasharray={props.circumference}
				stroke-dashoffset={usageDashOffset(props.percent, props.circumference)}
			/>
		</svg>
	) as string;
}

function usageDashOffset(percent: number, circumference: number): number {
	return circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;
}

function contextUsageColor(percent: number): string {
	return percent > 90 ? "text-destructive" : "text-foreground";
}

function codexUsageColor(percent: number, layer: "primary" | "secondary"): string {
	if (percent > 90) {
		return layer === "primary" ? "text-destructive" : "text-destructive/45";
	}
	return layer === "primary" ? "text-foreground" : "text-muted-foreground/45";
}

function loaderIcon() {
	return (
		<svg
			aria-label="Loading"
			role="status"
			class="lucide lucide-loader size-3 animate-spin"
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M12 2v4m4.2 1.8l2.9-2.9M18 12h4m-5.8 4.2l2.9 2.9M12 18v4m-7.1-2.9l2.9-2.9M2 12h4M4.9 4.9l2.9 2.9" />
		</svg>
	);
}

export function renderWorkspacePicker(state: AppState): string {
	const label = workspaceLabel(state.workspacePath);
	return (
		<button
			id="workspace-picker"
			class="btn text-muted-foreground hover:text-foreground hidden max-w-[12rem] min-w-0 font-mono sm:inline-flex"
			data-variant="ghost"
			data-size="sm"
			type="button"
			aria-label={state.workspacePath}
			data-on:click="
				$workspacePath = '';
				document.getElementById('workspace-dialog')?.showModal();
				requestAnimationFrame(() => document.getElementById('workspace-input')?.focus());
			"
			data-tooltip="Workspace"
			data-tooltip-delay
		>
			<span class="truncate" safe>
				{label}
			</span>
		</button>
	) as string;
}

export function renderThinkingPicker(state: AppState): string {
	const current = state.thinkingLevel;
	return (
		<div id="thinking-picker" class="hidden min-w-0 sm:block">
			<label class="sr-only" for="thinking-select-trigger">
				Thinking level
			</label>
			<div
				id="thinking-select"
				class="dropdown-menu"
				data-on:keydown__window={`if (evt.altKey && evt.key.toLowerCase() === 't') {
					evt.preventDefault();
					@post('/thinking/cycle');
				}`}
			>
				<button
					type="button"
					class="btn text-muted-foreground hover:text-foreground w-fit max-w-[10rem] font-mono"
					data-variant="ghost"
					data-size="sm"
					id="thinking-select-trigger"
					aria-haspopup="menu"
					aria-expanded="false"
					aria-controls="thinking-select-menu"
					data-tooltip="Thinking"
					data-tooltip-delay
					disabled={state.thinkingLevels.length <= 1}
				>
					<span class="truncate">{thinkingLabel(current)}</span>
				</button>
				<div
					id="thinking-select-popover"
					data-popover
					data-side="top"
					aria-hidden="true"
					class="min-w-48"
				>
					<div
						role="menu"
						id="thinking-select-menu"
						aria-labelledby="thinking-select-trigger"
					>
						<div role="group" aria-labelledby="thinking-select-heading">
							<div
								role="heading"
								id="thinking-select-heading"
								class="flex items-center justify-between gap-4"
							>
								<span>Thinking</span>
								<ShortcutKbd shortcut="alt T" />
							</div>
							{state.thinkingLevels.map((level) => (
								<div
									role="menuitemradio"
									aria-checked={level === current ? "true" : "false"}
									data-on:click={`
										$thinkingLevel = ${JSON.stringify(level)};
										@post('/thinking', { filterSignals: { include: /^thinkingLevel$/ } });
									`}
								>
									<span data-ignore data-indicator>
										•
									</span>
									<span class="min-w-0">
										<span class="block truncate">
											{thinkingLabel(level)}
										</span>
										<span class="text-muted-foreground block truncate text-xs">
											{thinkingDescription(level)}
										</span>
									</span>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	) as string;
}

function thinkingLabel(level: AppThinkingLevel): string {
	return level === "off" ? "thinking off" : level;
}

function thinkingDescription(level: AppThinkingLevel): string {
	switch (level) {
		case "off":
			return "No extended reasoning";
		case "minimal":
			return "Very brief reasoning";
		case "low":
			return "Light reasoning";
		case "medium":
			return "Moderate reasoning";
		case "high":
			return "Deep reasoning";
		case "xhigh":
			return "Maximum reasoning";
	}
}

function workspaceLabel(path: string): string {
	const display = formatHomePath(path).replaceAll("\\", "/");
	const parts = display.split("/").filter(Boolean);
	return display === "~" || parts.length <= 2
		? display
		: `${parts.at(-2)}/${parts.at(-1)}`;
}

export function renderModelPicker(state: AppState): string {
	const current = state.models.find(
		(model) => `${model.provider}/${model.id}` === state.currentModel,
	);
	const currentLabel = current ? modelTriggerLabel(current) : "Loading models…";
	return (
		<div id="model-picker" class="shrink-0">
			<label class="sr-only" for="model-select-trigger">
				Model
			</label>
			<div
				id="model-select"
				class="dropdown-menu"
				data-on:keydown__window={`if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'l') {
					evt.preventDefault();
					document.getElementById('model-select-trigger')?.focus();
					el.toggle?.();
				}`}
			>
				<button
					type="button"
					class="btn text-muted-foreground hover:text-foreground w-fit font-mono"
					data-variant="ghost"
					data-size="sm"
					id="model-select-trigger"
					aria-haspopup="menu"
					aria-expanded="false"
					aria-controls="model-select-menu"
					data-tooltip="Model"
					data-tooltip-delay
					disabled={state.models.length === 0}
				>
					<span class="truncate">{currentLabel}</span>
				</button>
				<div
					id="model-select-popover"
					data-popover
					data-side="top"
					aria-hidden="true"
					class="min-w-72"
				>
					<div
						role="menu"
						id="model-select-menu"
						class="max-h-70 overflow-y-auto"
						aria-labelledby="model-select-trigger"
					>
						<div role="group" aria-labelledby="model-select-heading">
							<div
								role="heading"
								id="model-select-heading"
								class="flex items-center justify-between gap-4"
							>
								<span>Models</span>
								<ShortcutKbd shortcut="ctrl L" />
							</div>
							{state.models.map((model) => {
								const value = `${model.provider}/${model.id}`;
								const configured = model.configured ? "" : " • no auth";
								return (
									<div
										role="menuitemradio"
										aria-checked={
											value === state.currentModel
												? "true"
												: "false"
										}
										data-on:click={`
											$model = ${JSON.stringify(value)};
											@post('/model', { filterSignals: { include: /^model$/ } });
											requestAnimationFrame(() => document.getElementById('prompt-input')?.focus());
										`}
									>
										<span data-ignore data-indicator>
											•
										</span>
										<span class="min-w-0">
											<span class="block truncate font-medium">
												{model.id}
											</span>
											<span class="text-muted-foreground block truncate text-xs">
												{model.provider}
												{configured}
											</span>
										</span>
									</div>
								);
							})}
						</div>
					</div>
				</div>
			</div>
		</div>
	) as string;
}

function modelTriggerLabel(model: AppState["models"][number]): string {
	return model.id;
}
