import {
	authDialogAction,
	cycleModelAction,
	cycleThinkingAction,
	toggleDialogAction,
} from "../commands/actions.ts";
import { activeKeybind, keybindAction, keybindActions } from "../keybinds.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type { AppThinkingLevel } from "../state/app-store.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { workspaceDisplayName } from "../utils/workspace.ts";
import { Icon } from "./icon.tsx";
import icons from "./icons.json";
import { ShortcutKbd, ShortcutTooltip } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

export function renderWorkspacePicker(state: AppStateSnapshot): string {
	const label = workspaceDisplayName(state.projectRoot);
	return syncHtml(
		<button
			id="workspace-picker"
			class="btn prompt-context-button workspace-picker"
			data-variant="ghost"
			data-size="sm"
			type="button"
			aria-haspopup="dialog"
			aria-controls="workspace-dialog"
			aria-label={state.projectRoot}
			data-attr:disabled="$_sessionTransitionStatus === 'loading'"
			commandfor="workspace-dialog"
			command="show-modal"
			data-on:click="$_workspaceAction = 'open'"
			data-on:keydown__window={keybindAction(
				"change-workspace",
				`$_workspaceAction = 'open'; ${toggleDialogAction()}`,
			)}
			data-tooltip="Workspace"
			data-tooltip-delay
		>
			<Icon name="folder" />
			<span class="prompt-context-label" safe>
				{label}
			</span>
			<ShortcutTooltip
				label="Workspace"
				shortcut={activeKeybind("change-workspace")}
			/>
		</button>,
	);
}

export function renderWorktreePicker(state: AppStateSnapshot): string {
	if (!state.workspaceReview.isGitRepository) return "";
	const branch = state.workspaceReview.branch;
	const label = branch && !branch.startsWith("detached@") ? branch : "detached";
	return syncHtml(
		<button
			id="worktree-picker"
			class="btn prompt-context-button worktree-picker"
			data-variant="ghost"
			data-size="sm"
			type="button"
			aria-haspopup="dialog"
			aria-controls="worktree-dialog"
			aria-label={`Branch: ${label}`}
			data-attr:disabled="$_sessionTransitionStatus === 'loading'"
			commandfor="worktree-dialog"
			command="show-modal"
			data-on:click={`@get('${endpoints.worktrees}', {
				payload: {},
				requestCancellation: 'cleanup',
			})`}
			data-tooltip="Branch"
			data-tooltip-delay
		>
			<Icon name="git-branch" />
			<span class="prompt-context-label" safe>
				{label}
			</span>
		</button>,
	);
}

export function renderThinkingPicker(state: AppStateSnapshot): string {
	const current = state.thinkingLevel;
	return syncHtml(
		<div id="thinking-picker" class="prompt-context-picker">
			<label class="sr-only" for="thinking-select-trigger">
				Thinking level
			</label>
			<div
				id="thinking-select"
				class="dropdown-menu"
				data-on:keydown__window={keybindActions(
					["cycle-thinking", cycleThinkingAction("forward")],
					["cycle-thinking-backward", cycleThinkingAction("backward")],
				)}
			>
				<button
					type="button"
					class="btn prompt-context-button thinking-picker-button"
					data-variant="ghost"
					data-size="sm"
					id="thinking-select-trigger"
					aria-haspopup="menu"
					aria-controls="thinking-select-popover"
					aria-label={`Thinking: ${thinkingLabel(current)}`}
					popovertarget="thinking-select-popover"
					data-tooltip="Thinking"
					data-tooltip-delay
					disabled={state.thinkingLevels.length <= 1}
				>
					<Icon name="brain" />
					<span class="prompt-context-label">{thinkingLabel(current)}</span>
					<ShortcutTooltip
						label="Thinking"
						shortcut={activeKeybind("cycle-thinking")}
					/>
				</button>
				<div
					id="thinking-select-popover"
					popover="auto"
					data-popover
					data-side="top"
					data-align="end"
					class="thinking-popover"
					role="menu"
					aria-labelledby="thinking-select-trigger"
				>
					<div role="group" aria-labelledby="thinking-select-heading">
						<div
							role="heading"
							id="thinking-select-heading"
							class="picker-heading"
						>
							<span>Thinking</span>
							<ShortcutKbd shortcut={activeKeybind("cycle-thinking")} />
						</div>
						{state.thinkingLevels.map((level) => (
							<button
								type="button"
								role="menuitemradio"
								tabindex="-1"
								autofocus={level === current}
								aria-checked={level === current ? "true" : "false"}
								commandfor="thinking-select-popover"
								command="hide-popover"
								data-on:click={`@post('${endpoints.thinking}', {
								payload: { thinkingLevel: ${JSON.stringify(level)} },
								});`}
							>
								<span class="picker-option-text">
									<span class="picker-option-title">
										{thinkingLabel(level)}
									</span>
									<span class="picker-option-description">
										{thinkingDescription(level)}
									</span>
								</span>
								<span
									class="selection-dot"
									data-ignore
									data-indicator
									aria-hidden="true"
								/>
							</button>
						))}
					</div>
				</div>
			</div>
		</div>,
	);
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
			return "Extra-high reasoning";
		case "max":
			return "Maximum reasoning";
	}
}

export function renderModelPicker(state: AppStateSnapshot): string {
	const current = state.models.find(
		(model) => `${model.provider}/${model.id}` === state.currentModel,
	);
	const hasModels = state.models.length > 0;
	if (!hasModels) {
		return syncHtml(
			<div id="model-picker" class="prompt-context-picker model-picker">
				<button
					type="button"
					class="btn prompt-context-button model-picker-button"
					data-variant="ghost"
					data-size="sm"
					data-tooltip="Log in to a provider"
					data-tooltip-delay
					data-on:click={authDialogAction("login")}
				>
					<span class="prompt-context-label">no provider</span>
					<ShortcutTooltip label="Log in to a provider" />
				</button>
			</div>,
		);
	}
	const currentLabel = current ? modelTriggerLabel(current) : "choose model";
	return syncHtml(
		<div id="model-picker" class="prompt-context-picker model-picker">
			<label class="sr-only" for="model-select-trigger">
				Model
			</label>
			<div
				id="model-select"
				class="popover model-select"
				data-on:keydown__window={keybindActions(
					[
						"switch-model",
						"document.getElementById('model-select-trigger')?.click();",
					],
					["cycle-model", cycleModelAction("forward")],
					["cycle-model-backward", cycleModelAction("backward")],
				)}
			>
				<button
					type="button"
					class="btn prompt-context-button model-picker-button"
					data-variant="ghost"
					data-size="sm"
					id="model-select-trigger"
					aria-label={`Model: ${currentLabel}`}
					aria-haspopup="dialog"
					aria-controls="model-select-popover"
					popovertarget="model-select-popover"
					data-tooltip="Model"
					data-tooltip-delay
				>
					<span class="prompt-context-label" safe>
						{currentLabel}
					</span>
					<ShortcutTooltip
						label="Model"
						shortcut={activeKeybind("switch-model")}
					/>
				</button>
				<dialog
					id="model-select-popover"
					popover="auto"
					data-popover
					data-side="top"
					data-align="end"
					class="model-popover"
					aria-label="Models"
					data-on:beforetoggle={`if (evt.newState === 'open') {
						@post('${endpoints.modelsRefresh}', { payload: {} });
						@get('${endpoints.modelsList}', {
							payload: { modelSearch: '' },
							requestCancellation: 'cleanup',
						});
					} else {
						$modelSearch = '';
						el.querySelector('#model-select-options').replaceChildren();
						window.piUi.controls.refresh(el);
						@get('${endpoints.modelsList}', {
							payload: { modelSearch: '' },
							requestCancellation: 'cleanup',
						});
					}`}
				>
					<div class="command">
						<search aria-label="Search models">
							<input
								id="model-select-input"
								type="text"
								placeholder="Search models..."
								autocomplete="off"
								data-preserve-attr="aria-activedescendant"
								autocorrect="off"
								spellcheck="false"
								aria-autocomplete="list"
								role="combobox"
								aria-expanded="true"
								aria-controls="model-select-menu"
								autofocus
								data-bind:model-search
								attrs={{
									"data-on:input__debounce.50ms": `@get('${endpoints.modelsList}', {
									payload: { modelSearch: $modelSearch },
									requestCancellation: 'cleanup',
								})`,
								}}
							/>
						</search>
						<div
							role="listbox"
							id="model-select-menu"
							class="model-menu"
							aria-labelledby="model-select-trigger"
							data-empty="No models found."
							data-indicator:_model-select-loading
							data-on-signal-patch-filter="{ include: /^_modelsRevision$/ }"
							data-on-signal-patch={`document.getElementById('model-select-popover')?.matches(':popover-open') &&
								@get('${endpoints.modelsList}', {
									payload: { modelSearch: $modelSearch },
									requestCancellation: 'cleanup',
								});`}
							data-on:click={`
								if (!(evt.target instanceof Element)) return;
								const scope = evt.target.closest('.model-scope-button');
								if (scope) {
									const row = scope.closest('[data-model-value]');
									if (row)
										@post('${endpoints.modelsScopeToggle}', {
											retryMaxCount: 0,
											payload: { model: row.dataset.modelValue },
										});
									return;
								}
								const row = evt.target.closest('[data-model-value]');
								if (!row) return;
								$modelSearch = '';
								@post('${endpoints.model}', {
									payload: { model: row.dataset.modelValue },
								});
								requestAnimationFrame(() => document.getElementById('prompt-input')?.focus());
							`}
						>
							<div role="group" aria-labelledby="model-select-heading">
								<div id="model-select-heading" class="picker-heading">
									<span>Models</span>
									<ShortcutKbd
										shortcut={activeKeybind("switch-model")}
									/>
								</div>
								<svg
									width="0"
									height="0"
									style="position:absolute"
									aria-hidden="true"
								>
									<defs>
										<symbol id="model-scope-star" viewBox="0 0 24 24">
											{icons.star.replace(
												'fill="none"',
												'fill="inherit"',
											)}
										</symbol>
									</defs>
								</svg>
								<div id="model-select-options" data-ignore-morph></div>
							</div>
						</div>
					</div>
				</dialog>
			</div>
		</div>,
	);
}

export function renderModelOptions(
	models: AppStateSnapshot["models"],
	currentModel: AppStateSnapshot["currentModel"],
): string {
	return syncHtml(
		<>
			{models.map((model, index) => {
				const value = `${model.provider}/${model.id}`;
				const configured = model.configured ? "" : " • no auth";
				return (
					<div
						id={`model-row-${encodeURIComponent(value)}`}
						class="model-option"
						data-model-value={value}
						data-command-row
					>
						<button
							type="button"
							id={`model-option-${encodeURIComponent(value)}`}
							role="option"
							tabindex="-1"
							class={["model-choice", index === 0 && "active"]}
							commandfor="model-select-popover"
							command="hide-popover"
							data-preserve-attr="class"
							aria-selected={value === currentModel ? "true" : "false"}
						>
							<span class="picker-option-text">
								<span class="picker-option-title" safe>
									{model.id}
								</span>
								<span class="picker-option-description" safe>
									{model.provider}
									{configured}
								</span>
							</span>
							<span
								class="selection-dot model-current-indicator"
								hidden={value !== currentModel}
								aria-hidden="true"
							/>
						</button>
						<button
							type="button"
							class="btn model-scope-button"
							data-variant={model.scoped ? "secondary" : "ghost"}
							data-size="icon-sm"
							aria-pressed={model.scoped ? "true" : "false"}
							aria-label={`Toggle scoped model ${value}`}
						>
							<svg class="icon" fill="none" aria-hidden="true">
								<use href="#model-scope-star" />
							</svg>
						</button>
					</div>
				);
			})}
		</>,
	);
}

function modelTriggerLabel(model: AppStateSnapshot["models"][number]): string {
	return model.id.slice(model.id.lastIndexOf("/") + 1);
}
