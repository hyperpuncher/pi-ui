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
import { ShortcutKbd, ShortcutTooltip } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

export function renderWorkspacePicker(state: AppStateSnapshot): string {
	const label = workspaceDisplayName(state.workspacePath);
	return syncHtml(
		<button
			id="workspace-picker"
			class="btn hidden max-w-48 min-w-0 font-mono text-muted-foreground hover:text-foreground sm:inline-flex"
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
			<span class="truncate" safe>
				{label}
			</span>
			<ShortcutTooltip label="Workspace" shortcut="ctrl /" />
		</button>,
	);
}

export function renderThinkingPicker(state: AppStateSnapshot): string {
	const current = state.thinkingLevel;
	return syncHtml(
		<div id="thinking-picker" class="hidden min-w-0 sm:block">
			<label class="sr-only" for="thinking-select-trigger">
				Thinking level
			</label>
			<div
				id="thinking-select"
				class="dropdown-menu"
				data-on:keydown="if (evt.code === 'Escape') evt.stopPropagation()"
				data-on:keydown__window={`if (evt.altKey && evt.code === 'KeyT') {
				evt.preventDefault();
				${cycleThinkingAction("event-shift")};
				}`}
			>
				<button
					type="button"
					class="btn w-fit max-w-40 font-mono text-muted-foreground hover:text-foreground"
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
					data-align="center"
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
			<div id="model-picker" class="shrink-0">
				<button
					type="button"
					class="btn w-fit font-mono text-muted-foreground hover:text-foreground"
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
		<div id="model-picker" class="shrink-0">
			<label class="sr-only" for="model-select-trigger">
				Model
			</label>
			<div
				id="model-select"
				class="popover"
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
					class="btn w-fit font-mono text-muted-foreground hover:text-foreground"
					data-variant="ghost"
					data-size="sm"
					id="model-select-trigger"
					aria-haspopup="menu"
					aria-expanded="false"
					aria-controls="model-select-menu"
					data-tooltip="Model"
					data-tooltip-delay
				>
					<span safe>{currentLabel}</span>
					<ShortcutTooltip label="Model" shortcut="ctrl L" />
				</button>
				<div
					id="model-select-popover"
					data-popover
					data-side="top"
					data-align="center"
					aria-hidden="true"
					class="w-80 max-w-[calc(100vw-2rem)] p-0"
				>
					<div class="command" aria-label="Models" data-filter="manual">
						<header>
							<input
								id="model-select-input"
								type="text"
								placeholder="Search models..."
								autocomplete="off"
								autocorrect="off"
								spellcheck="false"
								aria-autocomplete="list"
								role="combobox"
								aria-expanded="true"
								aria-controls="model-select-menu"
								autofocus
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
											role="menuitem"
											class="[contain-intrinsic-block-size:auto_3rem] [content-visibility:auto]"
											aria-current={
												value === state.currentModel
													? "true"
													: "false"
											}
											data-filter={`${model.id} ${model.provider}`}
											data-keywords={model.name}
											data-model-search-order={index}
											data-on:click={`
												document.getElementById('model-select-trigger')?.click();
												@post('${endpoints.model}', {
												payload: { model: ${JSON.stringify(value)} },
											});
												requestAnimationFrame(() => document.getElementById('prompt-input')?.focus());
											`}
										>
											<span class="min-w-0 flex-1">
												<span
													class="block max-w-56 truncate font-medium"
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
												class="btn size-7 shrink-0"
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
													window.piUi.modelSearch.preserve();
													@post('${endpoints.modelsScopeToggle}', {
													payload: { model: ${JSON.stringify(value)} },
												});
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
		</div>,
	);
}

function modelTriggerLabel(model: AppStateSnapshot["models"][number]): string {
	return model.id;
}
