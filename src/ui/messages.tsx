import { DEFAULT_THEMES, getHighlighterIfLoaded, type ThemedToken } from "@pierre/diffs";

import { authDialogAction } from "../commands/actions.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type {
	AppKeybindHint,
	AppMessage,
	AppMessageTitlePart,
	AppSessionSummary,
} from "../state/app-store.ts";
import { escapeHtml } from "../utils/html.ts";
import { ShortcutKbd } from "./keyboard.tsx";
import { SessionSubtitle } from "./session-summary.tsx";
import { resumeSessionAction } from "./session-transition.tsx";
import { shikiTokenStyle } from "./shiki-token-style.ts";

const inlineBashCache = new Map<string, string>();
const maxInlineBashCacheEntries = 500;

export function renderMessages(
	messages: readonly AppMessage[],
	emptyHint: AppKeybindHint,
	hasOlderMessages = false,
	sessions: readonly AppSessionSummary[] = [],
	sessionTransitionVisible = false,
	authenticated = true,
): string {
	const olderMessagesTriggerIndex = Math.min(25, Math.max(0, messages.length - 1));
	return (
		<main
			id="messages"
			class="min-h-0 overflow-y-auto mask-[linear-gradient(to_bottom,black_92%,transparent),linear-gradient(black,black)] mask-size-[calc(100%-var(--scrollbar-width))_100%,var(--scrollbar-width)_100%] mask-position-[left_top,right_top] mask-no-repeat px-4 pt-24 pb-48 sm:px-6 xl:px-8"
			style={sessionTransitionVisible ? "display: none" : undefined}
			data-show="!($_sessionLoading || $sessionTransitionVisible)"
			data-on:scroll={hasOlderMessages ? loadOlderMessagesAction() : undefined}
			aria-live="polite"
		>
			<div class="messages-stack mx-auto w-[calc(100%-2rem)] max-w-(--pi-messages-max-width)">
				{messages.length === 0
					? renderEmptyMessages(emptyHint, sessions.slice(0, 3), authenticated)
					: messages.map((message, index) => (
							<>
								{hasOlderMessages && index === olderMessagesTriggerIndex
									? renderOlderMessagesTrigger()
									: ""}
								{renderMessage(
									message,
									messages[index + 1]?.role === "tool",
								)}
							</>
						))}
			</div>
		</main>
	) as string;
}

function renderEmptyMessages(
	emptyHint: AppKeybindHint,
	sessions: readonly AppSessionSummary[],
	authenticated: boolean,
) {
	return (
		<div class="grid min-h-[calc(100vh-18rem)] place-items-center text-center text-muted-foreground">
			<div class="w-full max-w-xl">
				<p class="m-0 text-lg font-medium text-foreground">
					What can I help with?
				</p>
				<p class="m-0 mt-3 flex items-center justify-center gap-2 text-sm">
					<ShortcutKbd shortcut={emptyHint.keys} />
					<span safe>{emptyHint.description}</span>
				</p>
				{!authenticated ? (
					<p class="m-0 mt-8 text-sm text-muted-foreground">
						<button
							type="button"
							class="btn h-auto p-0 font-mono"
							data-variant="link"
							data-on:click={authDialogAction("login")}
						>
							/login
						</button>{" "}
						to connect a provider and start chatting
					</p>
				) : (
					sessions.length > 0 && (
						<div class="mt-8 text-left">
							<p class="mb-2 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
								Recent sessions
							</p>
							<div class="flex flex-col gap-1">
								{sessions.map((session, index) =>
									renderRecentSession(session, index),
								)}
							</div>
						</div>
					)
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
			class="flex w-full items-start justify-between gap-4 rounded-md border-0 bg-transparent px-2 py-2 text-left outline-none hover:bg-muted focus:bg-muted"
			data-indicator:_session-loading
			data-attr:disabled="$sessionTransitionLoading"
			data-on:click={resumeSessionAction(session.path)}
			data-on:keydown__window={resumeSessionShortcutAction(session.path, index)}
		>
			<span class="min-w-0">
				<span class="block truncate text-sm text-foreground" safe>
					{session.title}
				</span>
				<SessionSubtitle
					session={session}
					class="mt-1 line-clamp-2 text-xs text-muted-foreground"
				/>
			</span>
			<span class="flex shrink-0 items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
				<span class="font-mono" safe>
					{session.modified}
				</span>
				<ShortcutKbd shortcut={shortcut} />
			</span>
		</button>
	);
}

function resumeSessionShortcutAction(path: string, index: number): string {
	return `if ((evt.ctrlKey || evt.metaKey) && evt.code === 'Digit${index + 1}') {
		evt.preventDefault();
		${resumeSessionAction(path)}
	}`;
}

function loadOlderMessagesAction(): string {
	return `
		el.scrollTop < el.clientHeight * 2 &&
		window.piUi.messageScroll.captureAnchor() &&
		@post('${endpoints.messagesOlder}', { filterSignals: { include: /^$/ } })
	`;
}

function renderOlderMessagesTrigger() {
	return (
		<div
			class="pointer-events-none mb-[-40vh] h-[40vh] opacity-0"
			data-load-older-messages
			data-on:click={`
				window.piUi.messageScroll.captureAnchor() &&
				@post('${endpoints.messagesOlder}', { filterSignals: { include: /^$/ } })
			`}
			data-on-intersect={`window.piUi.messageScroll.captureAnchor() && @post('${endpoints.messagesOlder}', { filterSignals: { include: /^$/ } })`}
			aria-hidden="true"
		/>
	);
}

function renderPreOutput(text: string) {
	return (
		<div class="pi-tool-output-surface p-3">
			<pre class="m-0 max-h-80 overflow-auto rounded-md bg-transparent text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap text-muted-foreground">
				<code safe>{text}</code>
			</pre>
		</div>
	);
}

function renderDiffOutput(message: AppMessage) {
	return (
		<div class="diff-output pi-tool-output-surface max-h-96 overflow-auto [&_.pierre-diff]:block [&_.pierre-diff]:min-w-0 [&_.pierre-diff]:overflow-hidden [&_.pierre-diff]:rounded-md [&_.pierre-diff+_.pierre-diff]:mt-3 [&_.shiki]:m-0 [&_.shiki]:bg-transparent! [&_.shiki]:text-sm [&_.shiki]:leading-relaxed [&_.shiki]:wrap-anywhere [&_.shiki]:whitespace-pre-wrap [&_.shiki_code]:whitespace-pre-wrap">
			{message.renderedHtml ??
				renderPendingToolOutput(stripDiffMetadata(message.text), "pl-13")}
		</div>
	);
}

function renderCodeOutput(message: AppMessage) {
	return (
		<div class="code-output pi-tool-output-surface max-h-80 overflow-auto [&_.pierre-code]:block [&_.pierre-code]:min-w-0 [&_.pierre-code]:overflow-hidden [&_.pierre-code]:rounded-md [&_.shiki]:m-0 [&_.shiki]:bg-transparent! [&_.shiki]:text-sm [&_.shiki]:leading-relaxed [&_.shiki]:wrap-anywhere [&_.shiki]:whitespace-pre-wrap [&_.shiki_code]:whitespace-pre-wrap">
			{message.renderedHtml ?? renderPendingCodeOutput(message.text)}
		</div>
	);
}

function renderPlainOutput(text: string) {
	return (
		<div class="tool-output pi-tool-output-surface max-h-[calc(5lh+1px)] overflow-hidden leading-5.5">
			{renderPendingToolOutput(text, "pl-2")}
		</div>
	);
}

function renderPendingCodeOutput(text: string) {
	return (
		<pre class="m-0 bg-transparent pr-3 pl-2 font-mono text-[13px] leading-5.5 wrap-anywhere whitespace-pre-wrap text-muted-foreground">
			<code>{renderInlineBash(text)}</code>
		</pre>
	);
}

function renderPendingToolOutput(text: string, paddingClass: string) {
	return (
		<pre
			class={[
				"m-0 bg-transparent pr-3 font-mono text-[13px] leading-5.5 wrap-anywhere whitespace-pre-wrap text-muted-foreground",
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
	if (parts[0]?.text === "$ " && parts[1]?.highlight === "bash") {
		return (
			<span class="inline-flex max-w-full min-w-0 items-start align-top">
				<span class="shrink-0 pr-[1ch] font-mono" safe>
					{parts[0].text.trimEnd()}
				</span>
				<span class="min-w-0">
					{parts
						.slice(1)
						.map((part, index) => renderToolTitlePart(part, index + 1))}
				</span>
			</span>
		);
	}
	return <>{parts.map(renderToolTitlePart)}</>;
}

function renderToolTitlePart(part: AppMessageTitlePart, index: number) {
	return part.highlight === "bash" ? (
		<span class={toolTitlePartClass(part, index)}>{renderInlineBash(part.text)}</span>
	) : (
		<span class={toolTitlePartClass(part, index)} safe>
			{part.text}
		</span>
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
		const highlighted = result.tokens
			.map((line) => line.map(renderInlineToken).join(""))
			.join("\n");
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
	const style = shikiTokenStyle(token);
	const styleAttribute = style ? ` style="${escapeHtml(style)}"` : "";
	return `<span class="streaming-token"${styleAttribute}>${escapeHtml(token.content)}</span>`;
}

function renderDeferredEnhancement(message: AppMessage) {
	if (message.presentationState !== "deferred") return "";
	return (
		<button
			type="button"
			class="btn m-2"
			data-variant="ghost"
			data-size="sm"
			data-on:click={`@post('${endpoints.messagesEnhance}?id=${encodeURIComponent(message.id)}', {
				filterSignals: { include: /^$/ },
			})`}
		>
			Enhance formatting
		</button>
	);
}

function toolTitlePartClass(part: AppMessageTitlePart, index: number): string {
	const classes = [];
	if (index === 0 && !part.mono) classes.push("mr-2");
	if (part.mono) classes.push("font-mono");
	if (part.highlight === "bash") classes.push("break-all whitespace-pre-wrap");
	if (part.tone === "accent") classes.push("text-primary");
	if (part.tone === "warning") classes.push("text-amber-600 dark:text-yellow-300");
	if (part.tone === "muted") classes.push("text-muted-foreground");
	return classes.join(" ");
}

export function renderMessage(message: AppMessage, toolContinues = false): string {
	if (message.role === "user") {
		return (
			<article
				class="message message-user max-w-[min(32rem,72%)] self-end rounded-xl bg-primary px-3.5 py-2.5 text-primary-foreground"
				data-message-id={message.id}
			>
				<p class="m-0 wrap-anywhere whitespace-pre-wrap" safe>
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
				{message.renderedHtml !== undefined ? (
					<div>{message.renderedHtml}</div>
				) : (
					<p class="m-0 whitespace-pre-wrap" safe>
						{message.text}
					</p>
				)}
				{renderDeferredEnhancement(message)}
			</article>
		) as string;
	}

	if (message.role === "thought") {
		return (
			<article
				class="message message-narrative message-thought markdown-content w-full self-start text-sm text-muted-foreground italic"
				data-message-id={message.id}
			>
				{message.renderedHtml !== undefined ? (
					<div>{message.renderedHtml}</div>
				) : (
					<p class="m-0 whitespace-pre-wrap" safe>
						{message.text}
					</p>
				)}
				{renderDeferredEnhancement(message)}
			</article>
		) as string;
	}

	if (message.role === "system") {
		return (
			<article
				class="message message-narrative message-system max-w-3xl self-start text-muted-foreground"
				data-message-id={message.id}
			>
				<p class="m-0 whitespace-pre-wrap" safe>
					{message.text}
				</p>
			</article>
		) as string;
	}

	if (message.role === "compaction" || message.role === "skill") {
		const label = message.role === "compaction" ? "compaction" : "skill";
		return (
			<article
				class={[
					"message pi-tool-timeline-item w-full self-start",
					message.role === "compaction"
						? "message-compaction"
						: "message-skill",
				]}
				data-message-id={message.id}
			>
				<details class="group" data-preserve-attr="open">
					<summary class="flex min-h-4.5 cursor-pointer list-none items-start gap-2 font-mono text-sm outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
						<span
							class="pi-tool-state-dot inline-grid size-2"
							aria-hidden="true"
						>
							<span class="pi-tool-status-ball pi-tool-status-success" />
						</span>
						<span class="min-w-0 flex-1 leading-4.5 font-medium">
							<span safe>{label}</span>
							{message.meta && (
								<span class="ml-2 font-normal text-muted-foreground" safe>
									{message.meta}
								</span>
							)}
						</span>
						<span class="ml-auto inline-flex h-4.5 shrink-0 items-center text-xs text-muted-foreground">
							<svg
								class="size-3.5 rotate-180 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-open:rotate-90 motion-reduce:transition-none"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								aria-hidden="true"
							>
								<path d="m9 18 6-6-6-6" />
							</svg>
						</span>
					</summary>
					<div class="pi-tool-output-surface p-3 text-sm text-muted-foreground">
						<div class="markdown-content">
							{message.renderedHtml !== undefined ? (
								<div>{message.renderedHtml}</div>
							) : (
								<p class="m-0 whitespace-pre-wrap" safe>
									{message.text}
								</p>
							)}
						</div>
					</div>
				</details>
			</article>
		) as string;
	}

	const title = message.title ?? "Tool";
	const hasToolBody = message.text.trim().length > 0;
	const statusClass =
		message.state === "error" ? "pi-tool-status-error" : "pi-tool-status-success";
	const statusLabel =
		message.state === "running"
			? "Running"
			: message.state === "error"
				? "Failed"
				: "Completed";
	return (
		<article
			class="message message-tool pi-tool-timeline-item w-full self-start"
			data-message-id={message.id}
			data-tool-continues={toolContinues ? "" : undefined}
		>
			<header class="flex min-h-4.5 items-start gap-2 font-mono text-sm">
				<span
					class="pi-tool-state-dot inline-grid size-2 *:[grid-area:1/1]"
					aria-label={statusLabel}
					role="status"
				>
					<span
						class={[
							"pi-tool-status-ball text-muted-foreground transition-opacity duration-500 ease-out motion-reduce:transition-none",
							message.state === "running" ? "opacity-100" : "opacity-0",
						]}
					/>
					<span
						class={[
							"pi-tool-status-ball transition-opacity duration-500 ease-out motion-reduce:transition-none",
							statusClass,
							message.state === "running" ? "opacity-0" : "opacity-100",
						]}
					/>
					<span
						class={[
							"pi-tool-status-ball transition-opacity duration-500 ease-out motion-reduce:animate-none motion-reduce:transition-none",
							message.state === "running" ? "animate-ping" : "opacity-0",
						]}
					/>
				</span>
				<span class="min-w-0 flex-1 leading-4.5 font-medium wrap-anywhere">
					{renderToolTitle(title, message.titleParts)}
				</span>
				<span
					class="ml-auto inline-flex h-4.5 min-w-[6ch] shrink-0 items-center justify-end text-xs font-normal text-muted-foreground tabular-nums"
					aria-hidden={message.meta ? undefined : "true"}
					safe
				>
					{message.meta ?? ""}
				</span>
			</header>
			{hasToolBody
				? message.format === "diff"
					? renderDiffOutput(message)
					: message.format === "code"
						? renderCodeOutput(message)
						: message.format === "output"
							? renderPlainOutput(message.text)
							: renderPreOutput(message.text)
				: ""}
			{renderDeferredEnhancement(message)}
		</article>
	) as string;
}
