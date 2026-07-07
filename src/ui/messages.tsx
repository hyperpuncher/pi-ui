import type {
	AppKeybindHint,
	AppMessage,
	AppMessageTitlePart,
	AppSessionSummary,
} from "../state/app-state.ts";
import { ShortcutKbd } from "./keyboard.tsx";

export function renderMessages(
	messages: AppMessage[],
	emptyHint: AppKeybindHint,
	hasOlderMessages = false,
	sessions: AppSessionSummary[] = [],
): string {
	const olderMessagesTriggerIndex = Math.min(25, Math.max(0, messages.length - 1));
	return (
		<main
			id="messages"
			class="min-h-0 overflow-y-auto mask-b-from-95% px-[max(1rem,calc((100vw-52rem)/2))] pt-24 pb-48"
			data-on:scroll={hasOlderMessages ? loadOlderMessagesAction() : undefined}
			aria-live="polite"
		>
			<div class="mx-auto flex w-full max-w-[52rem] flex-col gap-8 [&_.message-user+_.message-user]:-mt-6">
				{messages.length === 0
					? renderEmptyMessages(emptyHint, sessions.slice(0, 3))
					: messages.map((message, index) => (
							<>
								{hasOlderMessages && index === olderMessagesTriggerIndex
									? renderOlderMessagesTrigger()
									: ""}
								{renderMessage(message)}
							</>
						))}
			</div>
		</main>
	) as string;
}

function renderEmptyMessages(emptyHint: AppKeybindHint, sessions: AppSessionSummary[]) {
	return (
		<div class="text-muted-foreground grid min-h-[calc(100vh-18rem)] place-items-center text-center">
			<div class="w-full max-w-xl">
				<p class="text-foreground m-0 text-lg font-medium">
					What can I help with?
				</p>
				<p class="m-0 mt-3 flex items-center justify-center gap-2 text-sm">
					<ShortcutKbd shortcut={emptyHint.keys} />
					<span safe>{emptyHint.description}</span>
				</p>
				{sessions.length > 0 && (
					<div class="mt-8 text-left">
						<p class="text-muted-foreground mb-2 px-2 text-xs font-medium tracking-wide uppercase">
							Recent sessions
						</p>
						<div class="flex flex-col gap-1">
							{sessions.map((session, index) =>
								renderRecentSession(session, index),
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function renderRecentSession(session: AppSessionSummary, index: number) {
	const shortcut = `ctrl ${index + 1}`;
	return (
		<button
			type="button"
			class="hover:bg-muted focus:bg-muted flex w-full items-start justify-between gap-4 rounded-md border-0 bg-transparent px-2 py-2 text-left outline-none"
			data-on:click={resumeSessionAction(session.path)}
			data-on:keydown__window={resumeSessionShortcutAction(session.path, index)}
		>
			<span class="min-w-0">
				<span class="text-foreground block truncate text-sm" safe>
					{session.title}
				</span>
				<span class="text-muted-foreground mt-1 line-clamp-2 text-xs" safe>
					{session.subtitle}
				</span>
			</span>
			<span class="text-muted-foreground flex shrink-0 items-center gap-2 text-xs whitespace-nowrap">
				<span safe>{session.modified}</span>
				<ShortcutKbd shortcut={shortcut} />
			</span>
		</button>
	);
}

function resumeSessionAction(path: string): string {
	return `
		$sessionPath = ${JSON.stringify(path)};
		@post('/sessions/resume', { filterSignals: { include: /^sessionPath$/ } });
	`;
}

function resumeSessionShortcutAction(path: string, index: number): string {
	return `if ((evt.ctrlKey || evt.metaKey) && evt.key === '${index + 1}') {
		evt.preventDefault();
		${resumeSessionAction(path)}
	}`;
}

function loadOlderMessagesAction(): string {
	return `
		el.scrollTop < el.clientHeight * 2 &&
		window.piUiCaptureMessagesAnchor?.() &&
		@post('/messages/older')
	`;
}

function renderOlderMessagesTrigger() {
	return (
		<div
			class="pointer-events-none -mb-[40vh] h-[40vh] opacity-0"
			data-load-older-messages
			data-on:click="window.piUiCaptureMessagesAnchor?.() && @post('/messages/older')"
			data-on-intersect="window.piUiCaptureMessagesAnchor?.() && @post('/messages/older')"
			aria-hidden="true"
		/>
	);
}

function renderPreOutput(text: string) {
	return (
		<div class="border-border/60 rounded-t-md border-t bg-[var(--code-background)] p-3">
			<pre class="text-muted-foreground m-0 max-h-80 overflow-auto rounded-md bg-transparent text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap">
				<code safe>{text}</code>
			</pre>
		</div>
	);
}

function renderDiffOutput(message: AppMessage) {
	if (message.renderedHtml) {
		return (
			<div class="diff-output border-border/60 max-h-96 overflow-auto rounded-md border-t [&_.pierre-diff]:block [&_.pierre-diff]:min-w-0 [&_.pierre-diff]:overflow-hidden [&_.pierre-diff]:rounded-md [&_.pierre-diff+_.pierre-diff]:mt-3 [&_.shiki]:m-0 [&_.shiki]:bg-transparent! [&_.shiki]:text-sm [&_.shiki]:leading-relaxed [&_.shiki]:wrap-anywhere [&_.shiki]:whitespace-pre-wrap [&_.shiki_code]:whitespace-pre-wrap">
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

export function renderMessage(message: AppMessage): string {
	if (message.role === "user") {
		return (
			<article
				class="message-user bg-primary text-primary-foreground max-w-[min(32rem,72%)] self-end rounded-xl px-3.5 py-2.5"
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
				class="markdown-content max-w-full self-start"
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
				class="markdown-content text-muted-foreground max-w-3xl self-start text-sm italic"
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
				class="bg-muted/40 text-muted-foreground w-full max-w-3xl self-start rounded-md p-3 text-sm"
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
					<div class="markdown-content mt-3">
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
		message.state === "error" ? "border-destructive/40" : "border-border/60";
	const dotClass =
		message.state === "running"
			? "bg-muted-foreground animate-pulse"
			: message.state === "error"
				? "bg-destructive"
				: "bg-emerald-500";
	return (
		<article
			class={[
				"bg-muted/40 dark:bg-muted/55 w-full max-w-3xl self-start overflow-hidden rounded-md border",
				stateClass,
			]}
			data-message-id={message.id}
		>
			<header
				class={[
					"flex items-start gap-2 px-3 py-2 text-sm leading-tight",
					hasToolBody ? "" : "",
				]}
			>
				<span class={["mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dotClass]} />
				<span class="min-w-0 leading-tight font-medium wrap-anywhere">
					{renderToolTitle(title, message.titleParts)}
					{message.meta && (
						<span class="text-muted-foreground ml-1 text-xs font-normal" safe>
							{message.meta}
						</span>
					)}
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
