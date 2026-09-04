import {
	authDialogAction,
	cycleModelAction,
	cycleThinkingAction,
	openWorkspaceDialogAction,
	toggleWorkspaceDialogAction,
} from "../commands/actions.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type { AppThinkingLevel } from "../state/app-store.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { primaryModifierExpression } from "../utils/keyboard.ts";
import { workspaceDisplayName } from "../utils/workspace.ts";
import { Icon } from "./icon.tsx";
import { Brain, Folder, Star } from "./icons.ts";
import { ShortcutKbd, ShortcutTooltip } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

export function renderWorkspacePicker(state: AppStateSnapshot): string {
	const label = workspaceDisplayName(state.workspacePath);
	return syncHtml(
		<button
			id="workspace-picker"
			class="btn prompt-context-button workspace-picker"
			data-variant="ghost"
			data-size="sm"
			type="button"
			aria-haspopup="dialog"
			aria-controls="workspace-dialog"
			aria-label={state.workspacePath}
			data-attr:disabled="$_sessionTransitionLoading"
			data-on:click={openWorkspaceDialogAction()}
			data-on:keydown__window={`if (${primaryModifierExpression()} && !evt.altKey && !evt.shiftKey && evt.code === 'Slash') {
			evt.preventDefault();
			${toggleWorkspaceDialogAction()}
			}`}
			data-tooltip="Workspace"
			data-tooltip-delay
		>
			<Icon icon={Folder} class="prompt-context-icon" />
			<span class="prompt-context-label" safe>
				{label}
			</span>
			<ShortcutTooltip label="Workspace" shortcut="ctrl /" />
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
				data-on:keydown__window={`if (
				evt.altKey &&
				!evt.ctrlKey &&
				!evt.metaKey &&
				evt.code === 'KeyT'
				) {
				evt.preventDefault();
				${cycleThinkingAction("event-shift")};
				}`}
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
					<Icon icon={Brain} class="prompt-context-icon" />
					<span class="prompt-context-label">{thinkingLabel(current)}</span>
					<ShortcutTooltip label="Thinking" shortcut="alt T" />
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
							<ShortcutKbd shortcut="alt T" />
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
				</button>
			</div>,
		);
	}
	const currentLabel = current ? modelTriggerLabel(current) : "choose model";
	return syncHtml(
		<div
			id="model-picker"
			class="prompt-context-picker model-picker"
			data-signals:_model-query__ifmissing="''"
		>
			<label class="sr-only" for="model-select-trigger">
				Model
			</label>
			<div
				id="model-select"
				class="popover model-select"
				data-on:keydown__window={`if (${primaryModifierExpression()} && evt.code === 'KeyL') {
				evt.preventDefault();
				document.getElementById('model-select-trigger')?.click();
				} else if (${primaryModifierExpression()} && evt.code === 'KeyP') {
				evt.preventDefault();
				${cycleModelAction("event-shift")};
				}`}
			>
				<button
					type="button"
					class="btn prompt-context-button model-picker-button"
					data-variant="ghost"
					data-size="sm"
					id="model-select-trigger"
					aria-haspopup="dialog"
					aria-controls="model-select-popover"
					popovertarget="model-select-popover"
					data-tooltip="Model"
					data-tooltip-delay
					data-on:click__capture={`if (!document.getElementById('model-select-popover')?.matches(':popover-open')) {
						$_modelQuery = '';
						@post('${endpoints.modelsRefresh}', { payload: {} });
					}`}
				>
					<span class="prompt-context-label" safe>
						{currentLabel}
					</span>
					<ShortcutTooltip label="Model" shortcut="ctrl L" />
				</button>
				<dialog
					id="model-select-popover"
					popover="auto"
					data-popover
					data-side="top"
					data-align="end"
					class="model-popover"
					aria-label="Models"
				>
					<div class="command" data-filter="manual">
						<header>
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
								data-bind:_model-query
								data-effect="window.piUi.modelSearch.filter(el, $_modelQuery)"
							/>
						</header>
						<div
							role="menu"
							id="model-select-menu"
							class="model-menu"
							aria-labelledby="model-select-trigger"
							data-empty="No models found."
						>
							<div role="group" aria-labelledby="model-select-heading">
								<div
									role="heading"
									id="model-select-heading"
									class="picker-heading"
								>
									<span>Models</span>
									<ShortcutKbd shortcut="ctrl L" />
								</div>
								{state.models.map((model, index) => {
									const value = `${model.provider}/${model.id}`;
									const configured = model.configured
										? ""
										: " • no auth";
									return (
										<div
											id={`model-option-${encodeURIComponent(value)}`}
											role="menuitem"
											class="model-option"
											data-preserve-attr="class hidden"
											aria-current={
												value === state.currentModel
													? "true"
													: "false"
											}
											data-filter={`${model.id} ${model.provider}`}
											data-keywords={model.name}
											data-model-search-order={index}
											data-on:click={`
												$_modelQuery = '';
												document.getElementById('model-select-trigger')?.click();
												@post('${endpoints.model}', {
												payload: { model: ${JSON.stringify(value)} },
											});
												requestAnimationFrame(() => document.getElementById('prompt-input')?.focus());
											`}
										>
											<span class="picker-option-text">
												<span class="picker-option-title" safe>
													{model.id}
												</span>
												<span
													class="picker-option-description"
													safe
												>
													{model.provider}
													{configured}
												</span>
											</span>
											<span
												class="selection-dot model-current-indicator"
												hidden={value !== state.currentModel}
												aria-hidden="true"
											/>
											<button
												type="button"
												class={[
													"btn model-scope-button",
													model.scoped
														? "model-scope-button-active"
														: "",
												]}
												data-variant={
													model.scoped ? "secondary" : "ghost"
												}
												data-size="icon-sm"
												aria-pressed={
													model.scoped ? "true" : "false"
												}
												aria-label="Toggle scoped model"
												data-on:click={`
													evt.stopPropagation();
													@post('${endpoints.modelsScopeToggle}', {
													payload: { model: ${JSON.stringify(value)} },
												});
												`}
											>
												<Icon
													icon={Star}
													class={
														model.scoped
															? "model-scope-icon-active"
															: undefined
													}
												/>
											</button>
										</div>
									);
								})}
							</div>
						</div>
					</div>
				</dialog>
			</div>
		</div>,
	);
}

function modelTriggerLabel(model: AppStateSnapshot["models"][number]): string {
	return model.id.slice(model.id.lastIndexOf("/") + 1);
}
