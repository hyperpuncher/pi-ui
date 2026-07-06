import type {
	AppKeybindHint,
	AppMessage,
	AppMessageTitlePart,
	AppSessionSummary,
} from "../state/app-state.ts";
import { formatTime } from "../utils/locale.ts";
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
			class="min-h-0 overflow-y-auto mask-b-from-95% px-[max(1rem,calc((100vw-46rem)/2))] pt-24 pb-48"
			data-on:scroll={hasOlderMessages ? loadOlderMessagesAction() : undefined}
			aria-live="polite"
		>
			<div class="mx-auto flex w-full max-w-3xl flex-col gap-8">
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
							{sessions.map(renderRecentSession)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function renderRecentSession(session: AppSessionSummary) {
	return (
		<button
			type="button"
			class="hover:bg-muted focus:bg-muted flex w-full items-start justify-between gap-4 rounded-md border-0 bg-transparent px-2 py-2 text-left outline-none"
			data-on:click={resumeSessionAction(session.path)}
		>
			<span class="min-w-0">
				<span class="text-foreground block truncate text-sm" safe>
					{session.title}
				</span>
				<span class="text-muted-foreground mt-1 line-clamp-2 text-xs" safe>
					{session.subtitle}
				</span>
			</span>
			<span class="text-muted-foreground shrink-0 text-xs whitespace-nowrap" safe>
				{session.modified}
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

export function renderMessage(message: AppMessage): string {
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
					"flex items-center justify-between gap-4 text-sm leading-none",
					hasToolBody ? "mb-3" : "",
				]}
			>
				<span class="flex min-w-0 items-center gap-2 leading-none">
					<span class={["h-1.5 w-1.5 shrink-0 rounded-full", dotClass]} />
					<span class="truncate leading-none font-medium">
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
