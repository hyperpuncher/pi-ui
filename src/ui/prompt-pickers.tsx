import {
	authDialogAction,
	cycleModelAction,
	cycleThinkingAction,
	openWorkspaceDialogAction,
	togglePopoverAction,
	toggleWorkspaceDialogAction,
} from "../commands/actions.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type { AppRenderSnapshot, AppThinkingLevel } from "../state/app-store.ts";
import { formatHomePath } from "../utils/workspace.ts";
import { ShortcutKbd, ShortcutTooltip } from "./keyboard.tsx";

export function renderWorkspacePicker(state: AppRenderSnapshot): string {
	const label = workspaceLabel(state.workspacePath);
	return (
		<button
			id="workspace-picker"
			class="btn hidden max-w-48 min-w-0 font-mono text-muted-foreground hover:text-foreground sm:inline-flex"
			data-variant="ghost"
			data-size="sm"
			type="button"
			aria-label={state.workspacePath}
			data-attr:disabled="$sessionTransitionLoading"
			data-on:click={openWorkspaceDialogAction()}
			data-on:keydown__window={`if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && !evt.shiftKey && evt.code === 'Slash') {
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
									data-on:click={`
										$thinkingLevel = ${JSON.stringify(level)};
										@post('${endpoints.thinking}', { filterSignals: { include: /^thinkingLevel$/ } });
									`}
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
			return "Extra-high reasoning";
		case "max":
			return "Maximum reasoning";
	}
}

function workspaceLabel(path: string): string {
	const display = formatHomePath(path).replaceAll("\\", "/");
	if (display === "~") return display;
	return display.split("/").filter(Boolean).at(-1) ?? display;
}

export function renderModelPicker(state: AppRenderSnapshot): string {
	const current = state.models.find(
		(model) => `${model.provider}/${model.id}` === state.currentModel,
	);
	const hasModels = state.models.length > 0;
	if (!hasModels) {
		return (
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
			</div>
		) as string;
	}
	const currentLabel = current ? modelTriggerLabel(current) : "choose model";
	return (
		<div id="model-picker" class="shrink-0">
			<label class="sr-only" for="model-select-trigger">
				Model
			</label>
			<div
				id="model-select"
				class="popover"
				data-on:keydown__window={`if ((evt.ctrlKey || evt.metaKey) && evt.code === 'KeyL') {
				evt.preventDefault();
				${togglePopoverAction("model-select-trigger")};
				} else if ((evt.ctrlKey || evt.metaKey) && evt.code === 'KeyP') {
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
					<span class="max-w-40 truncate sm:max-w-48" safe>
						{currentLabel}
					</span>
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
					<div class="command" aria-label="Models">
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
								{state.models.map((model) => {
									const value = `${model.provider}/${model.id}`;
									const configured = model.configured
										? ""
										: " • no auth";
									return (
										<div
											role="menuitem"
											aria-current={
												value === state.currentModel
													? "true"
													: "false"
											}
											data-filter={model.id}
											data-keywords={`${model.provider} ${model.name}`}
											data-on:click={`
												$model = ${JSON.stringify(value)};
												document.getElementById('model-select-trigger')?.click();
												@post('${endpoints.model}', { filterSignals: { include: /^model$/ } });
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
													$model = ${JSON.stringify(value)};
													@post('${endpoints.modelsScopeToggle}', { filterSignals: { include: /^model$/ } });
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
		</div>
	) as string;
}

function modelTriggerLabel(model: AppRenderSnapshot["models"][number]): string {
	return model.id;
}
