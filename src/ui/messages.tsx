import { DEFAULT_THEMES, getHighlighterIfLoaded, type ThemedToken } from "@pierre/diffs";

import type {
	AppKeybindHint,
	AppMessage,
	AppMessageTitlePart,
	AppSessionSummary,
} from "../state/app-state.ts";
import { escapeHtml } from "../utils/html.ts";
import { ShortcutKbd } from "./keyboard.tsx";
import { loaderIcon } from "./prompt-box.tsx";

const inlineBashCache = new Map<string, string>();
const maxInlineBashCacheEntries = 500;

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
			<div class="messages-stack mx-auto w-full max-w-[52rem]">
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
	return (
		<div class="diff-output border-border/60 max-h-96 overflow-auto rounded-md border-t bg-[var(--code-background)] [&_.pierre-diff]:block [&_.pierre-diff]:min-w-0 [&_.pierre-diff]:overflow-hidden [&_.pierre-diff]:rounded-md [&_.pierre-diff+_.pierre-diff]:mt-3 [&_.shiki]:m-0 [&_.shiki]:bg-transparent! [&_.shiki]:text-sm [&_.shiki]:leading-relaxed [&_.shiki]:wrap-anywhere [&_.shiki]:whitespace-pre-wrap [&_.shiki_code]:whitespace-pre-wrap">
			{message.renderedHtml ??
				renderPendingToolOutput(stripDiffMetadata(message.text), "pl-13")}
		</div>
	);
}

function renderCodeOutput(message: AppMessage) {
	return (
		<div class="code-output border-border/60 max-h-80 overflow-auto rounded-md border-t bg-[var(--code-background)] [&_.pierre-code]:block [&_.pierre-code]:min-w-0 [&_.pierre-code]:overflow-hidden [&_.pierre-code]:rounded-md [&_.shiki]:m-0 [&_.shiki]:bg-transparent! [&_.shiki]:text-sm [&_.shiki]:leading-relaxed [&_.shiki]:wrap-anywhere [&_.shiki]:whitespace-pre-wrap [&_.shiki_code]:whitespace-pre-wrap">
			{message.renderedHtml ?? renderPendingCodeOutput(message.text)}
		</div>
	);
}

function renderPendingCodeOutput(text: string) {
	return (
		<pre class="text-muted-foreground m-0 bg-[var(--code-background)] pr-3 pl-2 font-mono text-[13px] leading-[22px] wrap-anywhere whitespace-pre-wrap">
			<code>{renderInlineBash(text)}</code>
		</pre>
	);
}

function renderPendingToolOutput(text: string, paddingClass: string) {
	return (
		<pre
			class={[
				"text-muted-foreground m-0 bg-[var(--code-background)] pr-3 font-mono text-[13px] leading-[22px] wrap-anywhere whitespace-pre-wrap",
				paddingClass,
			]}
		>
			<code safe>{text}</code>
		</pre>
	);
}

function stripDiffMetadata(text: string): string {
	return text
		.split("\n")
		.filter(
			(line) =>
				!line.startsWith("--- ") &&
				!line.startsWith("+++ ") &&
				!line.startsWith("@@ "),
		)
		.join("\n");
}

function renderToolTitle(title: string, parts: AppMessageTitlePart[] | undefined) {
	if (!parts?.length) return <span safe>{title}</span>;
	return (
		<>
			{parts.map((part, index) =>
				part.highlight === "bash" ? (
					<span class={toolTitlePartClass(part, index)}>
						{renderInlineBash(part.text)}
					</span>
				) : (
					<span class={toolTitlePartClass(part, index)} safe>
						{part.text}
					</span>
				),
			)}
		</>
	);
}

function renderInlineBash(command: string): string {
	const cached = inlineBashCache.get(command);
	if (cached) return cached;

	const highlighter = getHighlighterIfLoaded();
	if (!highlighter) return escapeHtml(command);

	try {
		const result = highlighter.codeToTokens(command, {
			lang: "bash",
			themes: DEFAULT_THEMES,
		});
		const highlighted = result.tokens.flat().map(renderInlineToken).join("");
		cacheInlineBash(command, highlighted);
		return highlighted;
	} catch {
		return escapeHtml(command);
	}
}

function cacheInlineBash(command: string, html: string): void {
	if (inlineBashCache.size >= maxInlineBashCacheEntries) {
		inlineBashCache.delete(inlineBashCache.keys().next().value ?? "");
	}
	inlineBashCache.set(command, html);
}

function renderInlineToken(token: ThemedToken): string {
	const style = styleObjectToAttribute(token.htmlStyle ?? tokenStyle(token));
	const styleAttribute = style ? ` style="${escapeHtml(style)}"` : "";
	return `<span class="streaming-token"${styleAttribute}>${escapeHtml(token.content)}</span>`;
}

function tokenStyle(token: ThemedToken): Record<string, string> {
	const style: Record<string, string> = {};
	if (token.color) style.color = token.color;
	if (token.bgColor) style["background-color"] = token.bgColor;
	return style;
}

function styleObjectToAttribute(style: Record<string, string>): string {
	return Object.entries(style)
		.map(([key, value]) => `${key}:${value}`)
		.join(";");
}

function toolTitlePartClass(part: AppMessageTitlePart, index: number): string {
	const classes = [];
	if (index === 0 && !part.mono) classes.push("mr-2");
	if (part.mono) classes.push("font-mono");
	if (part.tone === "accent") classes.push("text-primary");
	if (part.tone === "warning") classes.push("text-amber-600 dark:text-yellow-300");
	if (part.tone === "muted") classes.push("text-muted-foreground");
	return classes.join(" ");
}

export function renderMessage(message: AppMessage): string {
	if (message.role === "user") {
		return (
			<article
				class="message message-user bg-primary text-primary-foreground max-w-[min(32rem,72%)] self-end rounded-xl px-3.5 py-2.5"
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
				class="message message-narrative message-assistant markdown-content w-full self-start"
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
				class="message message-narrative message-thought markdown-content text-muted-foreground w-full self-start text-sm italic"
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
				class="message message-narrative message-system text-muted-foreground max-w-3xl self-start"
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
				class={[
					"message message-narrative bg-muted/40 text-muted-foreground w-full self-start rounded-md p-3 text-sm",
					message.role === "skill" ? "message-skill" : "message-compaction",
				]}
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
				"message message-tool bg-muted/40 dark:bg-muted/55 w-full self-start overflow-hidden rounded-md border",
				stateClass,
			]}
			data-message-id={message.id}
		>
			<header
				class={[
					"flex items-start gap-2 px-3 py-2 font-mono text-sm leading-tight",
					hasToolBody ? "" : "",
				]}
			>
				<span class={["mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dotClass]} />
				<span class="min-w-0 flex-1 leading-tight font-medium wrap-anywhere">
					{renderToolTitle(title, message.titleParts)}
				</span>
				{message.state === "running" ? (
					<span class="text-muted-foreground mt-0.5 ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs leading-tight font-normal">
						{loaderIcon()}
						{message.meta && <span safe>{message.meta}</span>}
					</span>
				) : message.meta ? (
					<span
						class="text-muted-foreground mt-0.5 ml-auto shrink-0 text-xs leading-tight font-normal"
						safe
					>
						{message.meta}
					</span>
				) : (
					""
				)}
			</header>
			{hasToolBody
				? message.format === "diff"
					? renderDiffOutput(message)
					: message.format === "code"
						? renderCodeOutput(message)
						: renderPreOutput(message.text)
				: ""}
		</article>
	) as string;
}
