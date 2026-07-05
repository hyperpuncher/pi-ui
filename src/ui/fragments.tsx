import type {
	AppMessage,
	AppMessageTitlePart,
	AppSessionSummary,
	AppThinkingLevel,
	AppUsage,
	AppSlashCommand,
	AppState,
} from "../state/app-state.ts";
import { formatTime } from "../utils/locale.ts";

export function renderComposerAction(state: AppState): string {
	if (state.activityText) {
		return (
			<button
				id="composer-action"
				class="btn"
				data-variant="destructive"
				data-size="icon"
				type="button"
				data-on:click="@post('/abort')"
				data-tooltip="Abort"
				title="Abort"
				aria-label="Abort"
			>
				■
			</button>
		) as string;
	}

	return (
		<button
			id="composer-action"
			class="btn"
			data-size="icon"
			type="button"
			data-send-trigger
			data-attr:disabled="$composer.trim() === ''"
			data-on:click="@post('/prompt', { filterSignals: { include: /^composer$/ } })"
			data-tooltip="Send"
			aria-label="Send"
		>
			↑
		</button>
	) as string;
}

export function renderComposerStatus(state: AppState): string {
	if (state.activityText) {
		return (
			<span
				id="composer-status"
				class="text-muted-foreground inline-flex min-w-0 shrink-0 truncate font-mono text-xs"
			>
				<span class="inline-flex items-center gap-1.5">
					{loaderIcon()}
					<span safe>{state.activityText}</span>
				</span>
			</span>
		) as string;
	}

	return renderUsageIndicator(state.usage);
}

function renderUsageIndicator(usage: AppUsage): string {
	const percent = usage.contextPercent ?? 0;
	const circumference = 2 * Math.PI * 10;
	const strokeDashoffset = circumference - (percent / 100) * circumference;
	const colorClass =
		percent > 90
			? "text-red-500"
			: percent > 70
				? "text-yellow-500"
				: "text-violet-400";
	return (
		<span
			id="composer-status"
			class="hidden size-8 shrink-0 items-center justify-center lg:inline-flex"
			data-tooltip={usage.text}
			aria-label={usage.text}
		>
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
					class={colorClass}
					stroke-dasharray={circumference}
					stroke-dashoffset={strokeDashoffset}
				/>
			</svg>
		</span>
	) as string;
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
			class="btn hidden max-w-[12rem] min-w-0 px-2 font-mono text-xs sm:inline-flex"
			data-variant="ghost"
			type="button"
			title={state.workspacePath}
			data-workspace-trigger
			data-tooltip="Workspace"
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
			<div id="thinking-select" class="dropdown-menu">
				<button
					type="button"
					class="btn h-9 w-fit max-w-[10rem] px-2 text-sm"
					data-variant="ghost"
					id="thinking-select-trigger"
					aria-haspopup="menu"
					aria-expanded="false"
					aria-controls="thinking-select-menu"
					data-tooltip="Thinking"
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
							<div role="heading" id="thinking-select-heading">
								Thinking
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
										✓
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
	const home = Deno.env.get("HOME");
	const display =
		home && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
	const parts = display.split("/").filter(Boolean);
	if (display === "~" || parts.length <= 2) {
		return display;
	}
	return `${parts.at(-2)}/${parts.at(-1)}`;
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
			<div id="model-select" class="dropdown-menu">
				<button
					type="button"
					class="btn h-9 w-fit px-2 text-sm font-medium"
					data-variant="ghost"
					id="model-select-trigger"
					aria-haspopup="menu"
					aria-expanded="false"
					aria-controls="model-select-menu"
					data-tooltip="Model"
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
							<div role="heading" id="model-select-heading">
								Models
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
										`}
									>
										<span data-ignore data-indicator>
											✓
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

export function renderTranscript(messages: AppMessage[]): string {
	return (
		<main
			id="transcript"
			class="min-h-0 overflow-y-auto px-[max(1rem,calc((100vw-46rem)/2))] pt-24 pb-48"
			aria-live="polite"
		>
			<div class="mx-auto flex w-full max-w-3xl flex-col gap-8">
				{messages.map(renderMessage)}
			</div>
		</main>
	) as string;
}

export function renderSlashPicker(state: AppState): string {
	return (
		<div id="slash-picker">
			<ul class="max-h-72 list-none overflow-y-auto p-1">
				{state.slashCommands.length === 0 ? (
					<li class="text-muted-foreground px-3 py-4 text-center text-sm">
						No prompts or skills found.
					</li>
				) : (
					state.slashCommands.map(renderSlashRow)
				)}
			</ul>
		</div>
	) as string;
}

function renderSlashRow(item: AppSlashCommand): string {
	const label = `/${item.name}`;
	const haystack = `${item.name} ${item.description} ${item.source}`.toLowerCase();
	const commandText = `${label} `;
	return (
		<li data-slash-row data-slash-haystack={haystack}>
			<button
				class="hover:bg-muted focus:bg-muted flex w-full items-center justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2 text-left outline-none"
				type="button"
				data-slash-command={commandText}
			>
				<span class="min-w-0">
					<span class="block truncate">
						<span class="text-primary" safe>
							{label}
						</span>
						{item.argumentHint && (
							<span class="text-muted-foreground ml-2" safe>
								{item.argumentHint}
							</span>
						)}
					</span>
					<span class="text-muted-foreground block truncate text-xs" safe>
						{item.description || item.source}
					</span>
				</span>
				<span class="badge" data-variant="secondary" safe>
					{item.source}
				</span>
			</button>
		</li>
	) as string;
}

export function renderSessionPicker(state: AppState): string {
	return (
		<div
			role="menu"
			id="session-menu"
			class="mt-1"
			aria-orientation="vertical"
			data-empty="No saved sessions for this project yet."
		>
			<div role="group" aria-labelledby="session-menu-heading">
				<span role="heading" id="session-menu-heading">
					Recent sessions
				</span>
				{state.sessions.map(renderSessionRow)}
			</div>
		</div>
	) as string;
}

function renderSessionRow(session: AppSessionSummary): string {
	const haystack = `${session.title} ${session.subtitle} ${session.path}`.toLowerCase();
	return (
		<div
			role="menuitem"
			tabindex="-1"
			class="items-start gap-4"
			data-session-row
			data-filter={haystack}
			data-keywords={haystack}
			data-on:click={`
				$sessionPath = ${JSON.stringify(session.path)};
				document.getElementById('session-dialog')?.close();
				@post('/sessions/resume', { filterSignals: { include: /^sessionPath$/ } });
			`}
		>
			<span class="min-w-0 flex-1">
				<span class="block truncate" safe>
					{session.title}
				</span>
				<span class="text-muted-foreground mt-1 line-clamp-2 text-xs" safe>
					{session.subtitle}
				</span>
			</span>
			<span class="w-32 shrink-0 text-right whitespace-nowrap" data-shortcut safe>
				{session.modified}
			</span>
		</div>
	) as string;
}

function renderPreOutput(text: string) {
	return (
		<pre class="text-muted-foreground m-0 max-h-80 overflow-auto rounded-sm bg-transparent text-sm leading-relaxed whitespace-pre-wrap">
			<code safe>{text}</code>
		</pre>
	);
}

function renderDiffOutput(message: AppMessage) {
	if (message.renderedHtml) {
		return (
			<div class="max-h-96 overflow-auto rounded-sm bg-[var(--code-background)] [&_.shiki]:m-0 [&_.shiki]:bg-[var(--code-background)]! [&_.shiki]:text-sm [&_.shiki]:leading-relaxed [&_.shiki]:break-words [&_.shiki]:whitespace-pre-wrap [&_.shiki_code]:whitespace-pre-wrap">
				{message.renderedHtml}
			</div>
		);
	}
	return renderPreOutput(message.text);
}

function renderToolTitle(title: string, parts: AppMessageTitlePart[] | undefined) {
	if (!parts?.length) return <span safe>{title}</span>;
	return (
		<>
			{parts.map((part) => (
				<span class={toolTitlePartClass(part)} safe>
					{part.text}
				</span>
			))}
		</>
	);
}

function toolTitlePartClass(part: AppMessageTitlePart): string {
	if (part.tone === "accent") return "text-primary";
	if (part.tone === "warning") return "text-amber-600 dark:text-yellow-300";
	if (part.tone === "muted") return "text-muted-foreground";
	return "";
}

function renderMessage(message: AppMessage): string {
	if (message.role === "user") {
		return (
			<article
				class="bg-primary text-primary-foreground max-w-[min(32rem,72%)] self-end rounded-xl px-3.5 py-2.5"
				data-message-id={message.id}
			>
				<p class="m-0 whitespace-pre-wrap" safe>
					{message.text}
				</p>
			</article>
		) as string;
	}

	if (message.role === "assistant") {
		return (
			<article
				class="[&_code]:bg-muted max-w-full self-start leading-relaxed [&_.shiki]:my-4 [&_.shiki]:overflow-auto [&_.shiki]:rounded-lg [&_.shiki]:p-4 [&_.shiki]:break-words [&_.shiki]:whitespace-pre-wrap [&_.shiki_code]:whitespace-pre-wrap [&_.table-container]:my-4 [&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-4 [&_code]:rounded [&_code]:px-1 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_p]:whitespace-pre-wrap [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-6"
				data-message-id={message.id}
			>
				{message.renderedHtml ? (
					<div>{message.renderedHtml}</div>
				) : (
					<p class="m-0 whitespace-pre-wrap" safe>
						{message.text}
					</p>
				)}
			</article>
		) as string;
	}

	if (message.role === "thought") {
		return (
			<article
				class="text-muted-foreground [&_code]:bg-muted max-w-3xl self-start text-sm leading-relaxed italic [&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-4 [&_code]:rounded [&_code]:px-1 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-6"
				data-message-id={message.id}
			>
				{message.renderedHtml ? (
					<div>{message.renderedHtml}</div>
				) : (
					<p class="m-0 whitespace-pre-wrap" safe>
						{message.text}
					</p>
				)}
			</article>
		) as string;
	}

	if (message.role === "system") {
		return (
			<article
				class="text-muted-foreground max-w-3xl self-start"
				data-message-id={message.id}
			>
				<p class="m-0 whitespace-pre-wrap" safe>
					{message.text}
				</p>
			</article>
		) as string;
	}

	if (message.role === "compaction" || message.role === "skill") {
		const label = message.role === "skill" ? "[skill]" : "[compaction]";
		return (
			<article
				class="bg-muted/40 text-muted-foreground w-full max-w-3xl self-start rounded-sm p-3 text-sm"
				data-message-id={message.id}
			>
				<details>
					<summary class="cursor-pointer list-none">
						<span class="font-semibold" safe>
							{message.title ?? label}
						</span>
						{message.meta && (
							<span class="ml-2" safe>
								{message.meta}
							</span>
						)}
						<span class="ml-2 text-xs">click to expand</span>
					</summary>
					<div class="[&_code]:bg-muted mt-3 [&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-4 [&_code]:rounded [&_code]:px-1 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-6">
						{message.renderedHtml ? (
							<div>{message.renderedHtml}</div>
						) : (
							<p class="m-0 whitespace-pre-wrap" safe>
								{message.text}
							</p>
						)}
					</div>
				</details>
			</article>
		) as string;
	}

	const title = message.title ?? "Tool";
	const hasToolBody = message.text.trim().length > 0;
	const stateClass =
		message.state === "error" ? "border-destructive/40" : "border-transparent";
	const dotClass =
		message.state === "running"
			? "bg-muted-foreground animate-pulse"
			: message.state === "error"
				? "bg-destructive"
				: "bg-emerald-500";
	return (
		<article
			class={[
				"bg-muted/40 dark:bg-muted/55 w-full max-w-3xl self-start rounded-sm border p-3",
				stateClass,
			]}
			data-message-id={message.id}
		>
			<header
				class={[
					"flex items-center justify-between gap-4 text-sm",
					hasToolBody ? "mb-3" : "",
				]}
			>
				<span class="flex min-w-0 items-center gap-2">
					<span class={["h-1.5 w-1.5 shrink-0 rounded-full", dotClass]} />
					<span class="truncate font-medium">
						{renderToolTitle(title, message.titleParts)}
					</span>
				</span>
				<span class="text-muted-foreground flex shrink-0 items-center gap-3 text-xs">
					{message.meta && <span safe>{message.meta}</span>}
					<time>{formatTime(message.timestamp)}</time>
				</span>
			</header>
			{hasToolBody
				? message.format === "diff"
					? renderDiffOutput(message)
					: renderPreOutput(message.text)
				: ""}
		</article>
	) as string;
}
