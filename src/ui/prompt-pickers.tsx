import {
	authDialogAction,
	cycleModelAction,
	cycleThinkingAction,
	openWorkspaceDialogAction,
	togglePopoverAction,
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
			class="btn w-fit max-w-48 min-w-0 px-3 font-mono text-muted-foreground group-data-[context-compact]/prompt-footer:w-8 group-data-[context-compact]/prompt-footer:max-w-8 group-data-[context-compact]/prompt-footer:px-0 hover:text-foreground"
			data-variant="ghost"
			data-size="sm"
			type="button"
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
			<Icon
				icon={Folder}
				class="hidden size-4 group-data-[context-compact]/prompt-footer:block"
			/>
			<span class="truncate group-data-[context-compact]/prompt-footer:hidden" safe>
				{label}
			</span>
			<ShortcutTooltip label="Workspace" shortcut="ctrl /" />
		</button>,
	);
}

export function renderThinkingPicker(state: AppStateSnapshot): string {
	const current = state.thinkingLevel;
	return syncHtml(
		<div id="thinking-picker" class="min-w-0">
			<label class="sr-only" for="thinking-select-trigger">
				Thinking level
			</label>
			<div
				id="thinking-select"
				class="dropdown-menu"
				data-preserve-attr="data-dropdown-menu-initialized data-basecoat-component"
				data-on:keydown="if (evt.code === 'Escape') evt.stopPropagation()"
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
					class="btn w-fit max-w-40 px-3 font-mono text-muted-foreground group-data-[context-compact]/prompt-footer:w-8 group-data-[context-compact]/prompt-footer:max-w-8 group-data-[context-compact]/prompt-footer:px-0 hover:text-foreground"
					data-variant="ghost"
					data-size="sm"
					id="thinking-select-trigger"
					aria-haspopup="menu"
					aria-expanded="false"
					aria-controls="thinking-select-menu"
					aria-label={`Thinking: ${thinkingLabel(current)}`}
					data-preserve-attr="aria-expanded aria-activedescendant"
					data-tooltip="Thinking"
					data-tooltip-delay
					disabled={state.thinkingLevels.length <= 1}
				>
					<Icon
						icon={Brain}
						class="hidden size-4 group-data-[context-compact]/prompt-footer:block"
					/>
					<span class="truncate group-data-[context-compact]/prompt-footer:hidden">
						{thinkingLabel(current)}
					</span>
					<ShortcutTooltip label="Thinking" shortcut="alt T" />
				</button>
				<div
					id="thinking-select-popover"
					data-popover
					data-side="top"
					data-align="end"
					aria-hidden="true"
					data-preserve-attr="aria-hidden"
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
									data-preserve-attr="class"
									data-on:click={`@post('${endpoints.thinking}', {
									payload: { thinkingLevel: ${JSON.stringify(level)} },
									});`}
								>
									<span data-ignore data-indicator>
										•
									</span>
									<span class="min-w-0">
										<span class="block truncate">
											{thinkingLabel(level)}
										</span>
										<span class="block truncate text-xs text-muted-foreground">
											{thinkingDescription(level)}
										</span>
									</span>
								</div>
							))}
						</div>
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
			<div id="model-picker" class="min-w-0 shrink">
				<button
					type="button"
					class="btn w-fit max-w-56 min-w-0 font-mono text-muted-foreground group-data-[context-compact]/prompt-footer:max-w-28 hover:text-foreground"
					data-variant="ghost"
					data-size="sm"
					data-tooltip="Log in to a provider"
					data-tooltip-delay
					data-on:click={authDialogAction("login")}
				>
					no provider
				</button>
			</div>,
		);
	}
	const currentLabel = current ? modelTriggerLabel(current) : "choose model";
	return syncHtml(
		<div
			id="model-picker"
			class="min-w-0 shrink"
			data-signals:_model-query__ifmissing="''"
		>
			<label class="sr-only" for="model-select-trigger">
				Model
			</label>
			<div
				id="model-select"
				class="popover min-w-0"
				data-preserve-attr="data-popover-initialized data-basecoat-component"
				data-on:keydown__window={`if (${primaryModifierExpression()} && evt.code === 'KeyL') {
				evt.preventDefault();
				${togglePopoverAction("model-select-trigger")};
				} else if (${primaryModifierExpression()} && evt.code === 'KeyP') {
				evt.preventDefault();
				${cycleModelAction("event-shift")};
				}`}
			>
				<button
					type="button"
					class="btn w-fit max-w-56 min-w-0 font-mono text-muted-foreground group-data-[context-compact]/prompt-footer:max-w-28 hover:text-foreground"
					data-variant="ghost"
					data-size="sm"
					id="model-select-trigger"
					aria-haspopup="menu"
					aria-expanded="false"
					aria-controls="model-select-menu"
					data-preserve-attr="aria-expanded"
					data-tooltip="Model"
					data-tooltip-delay
				>
					<span class="min-w-0 truncate" safe>
						{currentLabel}
					</span>
					<ShortcutTooltip label="Model" shortcut="ctrl L" />
				</button>
				<div
					id="model-select-popover"
					data-popover
					data-side="top"
					data-align="end"
					aria-hidden="true"
					data-preserve-attr="aria-hidden"
					class="w-88 max-w-[calc(100vw-2rem)] p-0"
				>
					<div
						class="command"
						aria-label="Models"
						data-filter="manual"
						data-preserve-attr="data-command-initialized data-basecoat-component"
					>
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
							class="mt-1 max-h-70"
							aria-labelledby="model-select-trigger"
							data-empty="No models found."
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
								{state.models.map((model, index) => {
									const value = `${model.provider}/${model.id}`;
									const configured = model.configured
										? ""
										: " • no auth";
									return (
										<div
											id={`model-option-${encodeURIComponent(value)}`}
											role="menuitem"
											class="group [contain-intrinsic-block-size:auto_3rem] [content-visibility:auto]"
											data-preserve-attr="class aria-hidden"
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
											<span class="min-w-0 flex-1">
												<span
													class="block truncate font-medium"
													safe
												>
													{model.id}
												</span>
												<span
													class="block truncate text-xs text-muted-foreground"
													safe
												>
													{model.provider}
													{configured}
												</span>
											</span>
											<span
												class={
													value === state.currentModel
														? ""
														: "invisible"
												}
												aria-hidden="true"
											>
												•
											</span>
											<button
												type="button"
												class={[
													"btn h-7 shrink-0 overflow-hidden p-0",
													model.scoped
														? "w-7"
														: "w-0 opacity-0 group-hover:w-7 group-hover:opacity-100 focus-visible:w-7 focus-visible:opacity-100",
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
															? "size-4 [&_path]:fill-current"
															: "size-4"
													}
												/>
											</button>
										</div>
									);
								})}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>,
	);
}

function modelTriggerLabel(model: AppStateSnapshot["models"][number]): string {
	return model.id.slice(model.id.lastIndexOf("/") + 1);
}
