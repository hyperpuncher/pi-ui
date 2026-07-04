import type { AppMessage, AppSessionSummary, AppState } from "../state/app-state.ts";

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
	return sync(
		<div id="model-picker" class="min-w-0">
			<label class="sr-only" for="model-select">
				Model
			</label>
			<select
				id="model-select"
				class="input h-9 max-w-44 truncate text-sm font-medium"
				data-bind:model
				data-on:change="@post('/model', { filterSignals: { include: /^model$/ } })"
				disabled={state.models.length === 0}
			>
				{state.models.length === 0 ? (
					<option value="">Loading models…</option>
				) : (
					state.models.map((model) => {
						const value = `${model.provider}/${model.id}`;
						const configured = model.configured ? "" : " · no auth";
						return (
							<option value={value} selected={value === state.currentModel}>
								{model.name}
								{configured}
							</option>
						);
					})
				)}
			</select>
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
				class="hover:bg-muted flex w-full items-start justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2 text-left"
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
		const markdownClass = [
			"max-w-full self-start leading-relaxed",
			"[&_.shiki]:my-4 [&_.shiki]:overflow-auto [&_.shiki]:rounded-lg [&_.shiki]:p-4",
			"[&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-4",
			"[&_code]:rounded [&_code]:bg-muted [&_code]:px-1",
			"[&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold",
			"[&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-6",
			"[&_.table-container]:my-4",
		].join(" ");
		return sync(
			<article class={markdownClass} data-message-id={message.id}>
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

	const title = message.title ?? "Tool";
	const stateClass = message.state === "error" ? "border-destructive/40" : "";
	return sync(
		<article
			class={["card w-full max-w-3xl self-start p-4", stateClass]}
			data-message-id={message.id}
		>
			<header class="text-muted-foreground mb-2 flex items-center justify-between gap-4 text-sm">
				<span>{title}</span>
				<span class="flex min-w-0 items-center gap-3">
					{message.meta && <span>{message.meta}</span>}
					<time>{message.timestamp.toLocaleTimeString()}</time>
				</span>
			</header>
			<pre class="m-0 max-h-96 overflow-auto whitespace-pre-wrap">
				<code safe>{message.text}</code>
			</pre>
		</article>,
	);
}
