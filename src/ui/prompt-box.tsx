import {
	cycleModelAction,
	cycleThinkingAction,
	newSessionAction,
	openSessionDialogAction,
	openWorkspaceDialogAction,
} from "../commands/actions.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type {
	AppRenderSnapshot,
	AppThinkingLevel,
	AppUsage,
} from "../state/app-store.ts";
import { formatHomePath } from "../utils/workspace.ts";
import { ShortcutKbd, ShortcutTooltip } from "./keyboard.tsx";
import { renderSlashPicker } from "./pickers.tsx";

export function renderPromptBox(state: AppRenderSnapshot): string {
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
				data-show="$_slashPickerOpen"
			>
				{renderSlashPicker(state)}
			</div>
			<div
				id="prompt-file-popover"
				class="bg-popover text-popover-foreground absolute right-0 bottom-full left-0 mb-2 rounded-md border p-1 shadow-md"
				style="display: none;"
				data-show="$_filePickerOpen"
			>
				<div id="file-picker-results" aria-live="polite" />
			</div>
			{renderPromptQueue(state)}
			<textarea
				id="prompt-input"
				class="field-sizing-content max-h-44 min-h-7 resize-none overflow-y-auto p-1 text-[15px]"
				placeholder="Ask pi anything..."
				aria-label="Message"
				rows="1"
				data-bind:prompt
				data-on:input="
					$_slashPickerOpen = $prompt.startsWith('/') &&
					!$prompt.includes(' ')
				"
				data-on:pi-ui-picker-close="$_slashPickerOpen = false"
				data-on:pi-ui-file-query={`
					$fileQuery = evt.detail.query;
					$_filePickerOpen = true;
					@get('${endpoints.filesSearch}', {
						filterSignals: { include: /^fileQuery$/ },
						requestCancellation: 'cleanup',
					});
				`}
				data-on:pi-ui-file-close="$_filePickerOpen = false"
				data-effect={`if ($isSessionReady) {
					el.focus({ preventScroll: true });
					el.selectionStart = el.value.length;
					el.selectionEnd = el.value.length;
				}`}
				data-on:paste={`if (window.piUi.fileTransfer.hasFiles(evt.clipboardData)) {
					evt.preventDefault();
					window.piUi.fileTransfer.insert(evt.clipboardData);
				}`}
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
				}
				if (evt.altKey && evt.key === 'ArrowUp') {
					evt.preventDefault();
					@post('/prompt/dequeue', { filterSignals: { include: /^$/ } });
				}
				if (
					evt.key === 'Enter' &&
					!evt.shiftKey &&
					$prompt.trim() !== '' &&
					!window.piUi.pickers.isFileOpen()
				) {
					evt.preventDefault();
					window.piUi.messageScroll.scrollBottom();
					if ($prompt.trim() === '/tree') window.piUi.dialogs.openTree();
					evt.altKey
						? @post('/prompt/follow-up', { filterSignals: { include: /^prompt$/ } })
						: @post('/prompt', { filterSignals: { include: /^prompt$/ } });
				}`}
			></textarea>
			<footer
				class="flex flex-wrap items-center justify-between gap-2 p-0"
				data-align="end"
			>
				{renderPromptToolbar(state)}
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

export function renderPromptQueue(state: AppRenderSnapshot): string {
	return (<div id="prompt-queue">{renderQueuedMessages(state)}</div>) as string;
}

function renderQueuedMessages(state: AppRenderSnapshot): string {
	const items = [
		...state.queuedSteeringMessages.map((text) => ["Steering", text] as const),
		...state.queuedFollowUpMessages.map((text) => ["Follow-up", text] as const),
	];
	if (items.length === 0) return "";
	return (
		<div class="border-border/60 text-muted-foreground mb-2 border-b pb-2 text-xs">
			<div class="flex items-center justify-between gap-2 px-1">
				<span>Queued messages</span>
				<ShortcutKbd shortcut="alt ↑" />
			</div>
			<div class="mt-1 flex max-h-24 flex-col gap-1 overflow-y-auto px-1">
				{items.map(([label, text]) => (
					<div class="truncate">
						<span class="text-foreground">{label}:</span>{" "}
						<span safe>{text}</span>
					</div>
				))}
			</div>
		</div>
	) as string;
}

type PromptToolbarAction =
	| "commands"
	| "new-chat"
	| "new-temporary-chat"
	| "files"
	| "sessions";

export function renderPromptToolbar(state: AppRenderSnapshot): string {
	return (
		<div
			id="prompt-toolbar"
			class="flex shrink-0 items-center gap-0.5"
			aria-label="Message tools"
		>
			<PromptToolbarButton label="Commands" action="commands" shortcut="ctrl K">
				<CommandIcon />
			</PromptToolbarButton>
			<PromptToolbarButton label="Files" action="files" shortcut="@">
				<PaperclipIcon />
			</PromptToolbarButton>
			<PromptToolbarButton
				label="Resume session"
				action="sessions"
				shortcut="ctrl R"
			>
				<HistoryIcon />
			</PromptToolbarButton>
			<PromptToolbarButton label="New chat" action="new-chat" shortcut="ctrl O">
				<NewChatIcon />
			</PromptToolbarButton>
			<PromptToolbarButton
				label="New temporary chat"
				action="new-temporary-chat"
				shortcut="ctrl alt O"
				variant={state.isTemporarySession ? "secondary" : "ghost"}
				pressed={state.isTemporarySession}
			>
				<TemporaryChatIcon />
			</PromptToolbarButton>
		</div>
	) as string;
}

function PromptToolbarButton(props: {
	label: string;
	action: PromptToolbarAction;
	shortcut?: string;
	variant?: "primary" | "secondary" | "ghost";
	pressed?: boolean;
	children: JSX.Element;
}) {
	return (
		<button
			class="btn leading-none"
			data-variant={props.variant ?? "ghost"}
			aria-pressed={props.pressed ? "true" : undefined}
			data-size="icon-sm"
			type="button"
			data-file-trigger={props.action === "files" ? "" : undefined}
			data-indicator:_session-loading={
				isSessionChangingAction(props.action) ? "" : undefined
			}
			data-attr:disabled={
				isSessionChangingAction(props.action)
					? "$sessionTransitionLoading"
					: undefined
			}
			data-on:click={promptToolbarClickAction(props.action)}
			data-on:keydown__window={promptToolbarKeydownAction(props.action)}
			data-tooltip={props.label}
			aria-label={props.label}
		>
			{props.children}
			{props.shortcut && (
				<ShortcutTooltip label={props.label} shortcut={props.shortcut} />
			)}
		</button>
	);
}

function Icon(props: { children: JSX.Element }) {
	return (
		<svg
			class="size-3.5"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			aria-hidden="true"
		>
			{props.children}
		</svg>
	);
}

function CommandIcon() {
	return (
		<Icon>
			<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
		</Icon>
	);
}

function PaperclipIcon() {
	return (
		<Icon>
			<path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />
		</Icon>
	);
}

function HistoryIcon() {
	return (
		<Icon>
			<>
				<path d="M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8" />
				<path d="M3 3v5h5m4-1v5l4 2" />
			</>
		</Icon>
	);
}

function NewChatIcon() {
	return (
		<Icon>
			<>
				<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092a10 10 0 1 0-4.777-4.719" />
				<path d="M8 12h8m-4-4v8" />
			</>
		</Icon>
	);
}

function TemporaryChatIcon() {
	return (
		<Icon>
			<path d="M10.1 2.182a10 10 0 0 1 3.8 0m0 19.636a10 10 0 0 1-3.8 0M17.609 3.72a10 10 0 0 1 2.69 2.7M2.182 13.9a10 10 0 0 1 0-3.8m18.098 7.51a10 10 0 0 1-2.7 2.69m4.238-10.2a10 10 0 0 1 0 3.8M3.721 6.391a10 10 0 0 1 2.7-2.69m-.258 17.416-2.906.85a1 1 0 0 1-1.236-1.169l.965-2.98" />
		</Icon>
	);
}

function StopIcon() {
	return (
		<Icon>
			<rect width="18" height="18" x="3" y="3" rx="2" fill="currentColor" />
		</Icon>
	);
}

function SendIcon() {
	return (
		<Icon>
			<path d="m5 12 7-7 7 7m-7 7V5" />
		</Icon>
	);
}

function isSessionChangingAction(action: PromptToolbarAction): boolean {
	return action === "new-chat" || action === "new-temporary-chat";
}

function promptToolbarClickAction(action: PromptToolbarAction): string | undefined {
	if (action === "commands") return openCommandPaletteAction();
	if (action === "new-chat") return newChatAction();
	if (action === "new-temporary-chat") return newTemporaryChatAction();
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
		return `if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && evt.key.toLowerCase() === 'o') {
			evt.preventDefault();
			${newChatAction()}
		}`;
	}
	if (action === "new-temporary-chat") {
		return `if ((evt.ctrlKey || evt.metaKey) && evt.altKey && evt.key.toLowerCase() === 'o') {
			evt.preventDefault();
			${newTemporaryChatAction()}
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
	return newSessionAction();
}

function newTemporaryChatAction(): string {
	return newSessionAction(true);
}

export function renderPromptAction(state: AppRenderSnapshot): string {
	if (state.activityText) {
		return (
			<button
				id="prompt-action"
				class="btn leading-none"
				data-variant="destructive"
				data-size="icon"
				type="button"
				data-on:click="@post('/abort', { filterSignals: { include: /^$/ } })"
				data-on:keydown__window="if (
					evt.key === 'Escape' &&
					!evt.ctrlKey &&
					!evt.metaKey &&
					!evt.altKey &&
					!evt.shiftKey &&
					window.piUi.shouldAbortOnEscape(evt)
				) {
					evt.preventDefault();
					@post('/abort', { filterSignals: { include: /^$/ } });
				}"
				data-tooltip="Abort"
				aria-label="Abort"
			>
				<StopIcon />
				<ShortcutTooltip label="Abort" shortcut="Esc" />
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
			data-on:click="
				window.piUi.messageScroll.scrollBottom();
				@post('/prompt', { filterSignals: { include: /^prompt$/ } });
			"
			data-tooltip="Send"
			data-tooltip-delay
			aria-label="Send"
		>
			<SendIcon />
			<ShortcutTooltip label="Send" shortcut="Enter" />
		</button>
	) as string;
}

export function renderPromptStatus(state: AppRenderSnapshot): string {
	return (
		<span
			id="prompt-status"
			class="inline-flex h-8 min-w-0 shrink-0 items-center gap-2"
		>
			{state.activityText && (
				<span class="text-muted-foreground inline-flex h-6 min-w-0 items-center truncate font-mono text-xs leading-none">
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
				class="group inline-flex size-4 shrink-0 items-center justify-center"
				data-tooltip={usage.text}
				data-tooltip-multiline
				aria-label={usage.text}
			>
				{usageRing({
					circumference,
					rings: [
						{
							percent: contextPercent,
							className: contextUsageColor(contextPercent),
						},
					],
				})}
			</span>
			{usage.codexText && (
				<span
					class="group inline-flex size-4 shrink-0 items-center justify-center"
					data-tooltip={`codex limits\n${usage.codexText.replace("  ", "\n")}`}
					data-tooltip-multiline
					aria-label={`codex limits • ${usage.codexText}`}
				>
					{usageRing({
						circumference,
						rings: [
							{
								percent: usage.codexSecondaryPercent ?? 0,
								className: codexUsageColor(
									usage.codexSecondaryPercent ?? 0,
									"secondary",
								),
							},
							{
								percent: usage.codexPrimaryPercent ?? 0,
								className: codexUsageColor(
									usage.codexPrimaryPercent ?? 0,
									"primary",
								),
							},
						],
					})}
				</span>
			)}
		</span>
	) as string;
}

function usageRing(props: {
	circumference: number;
	rings: { percent: number; className: string }[];
}): string {
	return (
		<svg
			class="size-4 -rotate-90 opacity-60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<circle
				cx="12"
				cy="12"
				r="10"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				class="text-muted-foreground/20"
			/>
			{props.rings.map((ring) => (
				<circle
					cx="12"
					cy="12"
					r="10"
					fill="none"
					stroke="currentColor"
					stroke-width="3"
					stroke-linecap="round"
					class={ring.className}
					stroke-dasharray={props.circumference}
					stroke-dashoffset={usageDashOffset(ring.percent, props.circumference)}
				/>
			))}
		</svg>
	) as string;
}

function usageDashOffset(percent: number, circumference: number): number {
	return circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;
}

function contextUsageColor(percent: number): string {
	return usageColor(percent, "primary");
}

function codexUsageColor(percent: number, layer: "primary" | "secondary"): string {
	return usageColor(percent, layer);
}

function usageColor(percent: number, layer: "primary" | "secondary"): string {
	if (percent > 90) return "text-destructive";
	return layer === "primary" ? "text-foreground" : "text-muted-foreground/45";
}

export function loaderIcon() {
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

export function renderWorkspacePicker(state: AppRenderSnapshot): string {
	const label = workspaceLabel(state.workspacePath);
	return (
		<button
			id="workspace-picker"
			class="btn text-muted-foreground hover:text-foreground hidden max-w-[12rem] min-w-0 font-mono sm:inline-flex"
			data-variant="ghost"
			data-size="sm"
			type="button"
			aria-label={state.workspacePath}
			data-attr:disabled="$sessionTransitionLoading"
			data-on:click={openWorkspaceDialogAction()}
			data-on:keydown__window={`if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && !evt.shiftKey && evt.key === '/') {
			evt.preventDefault();
			${openWorkspaceDialogAction()}
			}`}
			data-tooltip="Workspace"
			data-tooltip-delay
		>
			<span class="truncate" safe>
				{label}
			</span>
			<ShortcutTooltip label="Workspace" shortcut="ctrl /" />
		</button>
	) as string;
}

export function renderThinkingPicker(state: AppRenderSnapshot): string {
	const current = state.thinkingLevel;
	return (
		<div id="thinking-picker" class="hidden min-w-0 sm:block">
			<label class="sr-only" for="thinking-select-trigger">
				Thinking level
			</label>
			<div
				id="thinking-select"
				class="dropdown-menu"
				data-on:keydown="if (evt.key === 'Escape') evt.stopPropagation()"
				data-on:keydown__window={`if (evt.altKey && evt.key.toLowerCase() === 't') {
				evt.preventDefault();
				${cycleThinkingAction("event-shift")};
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
					<ShortcutTooltip label="Thinking" shortcut="alt T" />
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

export function renderModelPicker(state: AppRenderSnapshot): string {
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
				data-on:keydown="if (evt.key === 'Escape') evt.stopPropagation()"
				data-on:keydown__window={`if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'l') {
				evt.preventDefault();
				document.getElementById('model-select-trigger')?.focus();
				el.toggle?.();
				} else if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'p') {
				evt.preventDefault();
				${cycleModelAction("event-shift")};
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
					<span class="truncate" safe>
						{currentLabel}
					</span>
					<ShortcutTooltip label="Model" shortcut="ctrl L" />
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
										<span class="min-w-0 flex-1">
											<span class="block truncate font-medium" safe>
												{model.id}
											</span>
											<span
												class="text-muted-foreground block truncate text-xs"
												safe
											>
												{model.provider}
												{configured}
											</span>
										</span>
										<button
											type="button"
											class="btn size-7 shrink-0"
											data-variant={
												model.scoped ? "secondary" : "ghost"
											}
											data-size="icon-sm"
											aria-pressed={model.scoped ? "true" : "false"}
											aria-label="Toggle scoped model"
											data-on:click={`
												evt.stopPropagation();
												$model = ${JSON.stringify(value)};
												@post('/models/scope/toggle', { filterSignals: { include: /^model$/ } });
											`}
										>
											<svg
												class="size-4"
												xmlns="http://www.w3.org/2000/svg"
												width="32"
												height="32"
												viewBox="0 0 24 24"
												aria-hidden="true"
											>
												<path
													fill={
														model.scoped
															? "currentColor"
															: "none"
													}
													stroke="currentColor"
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.12 2.12 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16z"
												/>
											</svg>
										</button>
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

function modelTriggerLabel(model: AppRenderSnapshot["models"][number]): string {
	return model.id;
}
