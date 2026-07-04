import type {
	AppMessage,
	AppMessageTitlePart,
	AppSessionSummary,
	AppSlashCommand,
	AppState,
} from "../state/app-state.ts";

function sync(html: JSX.Element): string {
	return html as string;
}

export function renderComposerStatus(state: AppState): string {
	return sync(
		<span
			id="composer-status"
			class="text-muted-foreground min-w-0 truncate text-xs"
			title={state.status}
		>
			{state.usageText}
		</span>,
	);
}

export function renderModelPicker(state: AppState): string {
	const current = state.models.find(
		(model) => `${model.provider}/${model.id}` === state.currentModel,
	);
	return sync(
		<div id="model-picker" class="min-w-0">
			<label class="sr-only" for="model-select-trigger">
				Model
			</label>
			<div
				id="model-select"
				class="select"
				data-placeholder="Loading models…"
				data-on:change="
					$model = evt.detail.value;
					@post('/model', { filterSignals: { include: /^model$/ } });
				"
			>
				<button
					type="button"
					class="h-9 max-w-44 text-sm font-medium"
					id="model-select-trigger"
					aria-haspopup="listbox"
					aria-expanded="false"
					aria-controls="model-select-listbox"
					disabled={state.models.length === 0}
				>
					<span class="truncate">
						{current ? current.name : "Loading models…"}
					</span>
					<span class="text-muted-foreground shrink-0 opacity-50">⌄</span>
				</button>
				<div
					id="model-select-popover"
					data-popover
					data-side="top"
					aria-hidden="true"
				>
					<div
						role="listbox"
						id="model-select-listbox"
						class="max-h-70 overflow-y-auto"
						aria-orientation="vertical"
						aria-labelledby="model-select-trigger"
					>
						{state.models.map((model) => {
							const value = `${model.provider}/${model.id}`;
							const configured = model.configured ? "" : " • no auth";
							return (
								<div
									role="option"
									data-value={value}
									aria-selected={
										value === state.currentModel ? "true" : "false"
									}
								>
									{model.name}
									{configured}
								</div>
							);
						})}
					</div>
				</div>
				<input type="hidden" name="model" value={state.currentModel ?? ""} />
			</div>
		</div>,
	);
}

export function renderTranscript(messages: AppMessage[]): string {
	return sync(
		<main
			id="transcript"
			class="min-h-0 overflow-y-auto px-[max(1rem,calc((100vw-46rem)/2))] pt-24 pb-48"
			aria-live="polite"
		>
			<div class="mx-auto flex w-full max-w-3xl flex-col gap-8">
				{messages.map(renderMessage)}
			</div>
		</main>,
	);
}

export function renderSlashPicker(state: AppState): string {
	return sync(
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
		</div>,
	);
}

function renderSlashRow(item: AppSlashCommand): string {
	const label = `/${item.name}`;
	const haystack = `${item.name} ${item.description} ${item.source}`.toLowerCase();
	const commandText = `${label} `;
	return sync(
		<li data-slash-row data-slash-haystack={haystack}>
			<button
				class="hover:bg-muted focus:bg-muted flex w-full items-center justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2 text-left outline-none"
				type="button"
				data-slash-command={commandText}
				data-on:click={`
					$composer = ${JSON.stringify(commandText)};
					globalThis.__piUiUpdateSlashPicker?.(${JSON.stringify(commandText)});
					setTimeout(() => globalThis.__piUiFocusComposerEnd?.(), 0);
				`}
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
		</li>,
	);
}

export function renderSessionPicker(state: AppState): string {
	return sync(
		<div id="session-picker">
			<ul class="mt-3 max-h-[55vh] list-none overflow-y-auto p-0">
				{state.sessions.length === 0 ? (
					<li class="text-muted-foreground px-3 py-6 text-center text-sm">
						No saved sessions for this project yet.
					</li>
				) : (
					state.sessions.map(renderSessionRow)
				)}
			</ul>
		</div>,
	);
}

function renderSessionRow(session: AppSessionSummary): string {
	const haystack = `${session.title} ${session.subtitle} ${session.path}`.toLowerCase();
	return sync(
		<li
			data-session-row
			data-show={`
				$sessionQuery === '' ||
				${JSON.stringify(haystack)}.includes($sessionQuery.toLowerCase())
			`}
		>
			<button
				class="hover:bg-muted focus:bg-muted flex w-full items-start justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2 text-left outline-none"
				type="button"
				data-on:click={`
					$sessionPath = ${JSON.stringify(session.path)};
					$sessionOpen = false;
					$sessionQuery = '';
					@post('/sessions/resume', { filterSignals: { include: /^sessionPath$/ } });
				`}
			>
				<span class="min-w-0">
					<span class="block truncate" safe>
						{session.title}
					</span>
					<span class="text-muted-foreground mt-1 line-clamp-2 text-xs" safe>
						{session.subtitle}
					</span>
				</span>
				<time class="text-muted-foreground shrink-0 text-xs" safe>
					{session.modified}
				</time>
			</button>
		</li>,
	);
}

function renderPreOutput(text: string): JSX.Element {
	return (
		<pre class="text-muted-foreground m-0 max-h-80 overflow-auto rounded-sm bg-transparent text-sm leading-relaxed whitespace-pre-wrap">
			<code safe>{text}</code>
		</pre>
	);
}

function renderDiffOutput(message: AppMessage): JSX.Element {
	if (message.renderedHtml) {
		return (
			<div class="max-h-96 overflow-auto rounded-sm [&_.shiki]:m-0 [&_.shiki]:bg-transparent! [&_.shiki]:p-0 [&_.shiki]:text-sm [&_.shiki]:leading-relaxed [&_.shiki]:break-words [&_.shiki]:whitespace-pre-wrap [&_.shiki_code]:whitespace-pre-wrap">
				{message.renderedHtml}
			</div>
		);
	}
	return renderPreOutput(message.text);
}

function renderToolTitle(
	title: string,
	parts: AppMessageTitlePart[] | undefined,
): JSX.Element {
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
		return sync(
			<article
				class="bg-primary text-primary-foreground max-w-[min(32rem,72%)] self-end rounded-xl px-3.5 py-2.5"
				data-message-id={message.id}
			>
				<p class="m-0 whitespace-pre-wrap" safe>
					{message.text}
				</p>
			</article>,
		);
	}

	if (message.role === "assistant") {
		return sync(
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
			</article>,
		);
	}

	if (message.role === "thought") {
		return sync(
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
			</article>,
		);
	}

	if (message.role === "system") {
		return sync(
			<article
				class="text-muted-foreground max-w-3xl self-start"
				data-message-id={message.id}
			>
				<p class="m-0 whitespace-pre-wrap" safe>
					{message.text}
				</p>
			</article>,
		);
	}

	if (message.role === "compaction" || message.role === "skill") {
		const label = message.role === "skill" ? "[skill]" : "[compaction]";
		return sync(
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
			</article>,
		);
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
	return sync(
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
					<time>{message.timestamp.toLocaleTimeString()}</time>
				</span>
			</header>
			{hasToolBody
				? message.format === "diff"
					? renderDiffOutput(message)
					: renderPreOutput(message.text)
				: ""}
		</article>,
	);
}
