import { getHighlighterIfLoaded, type ThemedToken } from "@pierre/diffs";

import {
	attachmentFileIcons,
	attachmentFileKind,
} from "../../static/app/attachment-file.js";
import { authDialogAction } from "../commands/actions.ts";
import { getActiveCodeThemeId, getPierreThemes } from "../pierre-theme.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type {
	AppKeybindHint,
	AppMessageTitlePart,
	AppSessionSummary,
} from "../state/app-store.ts";
import { escapeHtml } from "../utils/html.ts";
import { DateTime } from "./date-time.tsx";
import { Icon } from "./icon.tsx";
import { ShortcutKbd } from "./keyboard.tsx";
import { renderMarkdownStreaming } from "./markdown.tsx";
import type { AppMessage } from "./render-state.ts";
import { SessionSubtitle } from "./session-summary.tsx";
import { resumeSessionAction } from "./session-transition.tsx";
import { shikiTokenStyle } from "./shiki-token-style.ts";
import { StatusDot } from "./status-dot.tsx";
import { syncHtml } from "./sync-html.ts";

const inlineBashCache = new Map<string, string>();
const maxInlineBashCacheEntries = 500;

export function preservesFinalizedMessageDom(message: AppMessage): boolean {
	return (
		message.presentationState === "final" &&
		(message.role === "assistant" || message.role === "thought")
	);
}

export function renderMessages(
	messages: readonly AppMessage[],
	emptyHint: AppKeybindHint,
	hasOlderMessages = false,
	sessions: readonly AppSessionSummary[] = [],
	authenticated = true,
	sessionCatalogLoading = false,
): string {
	return syncHtml(
		<main
			id="messages"
			class={[
				"min-h-0 overflow-y-auto mask-[linear-gradient(to_bottom,black_92%,transparent),linear-gradient(black,black)] mask-size-[calc(100%-var(--scrollbar-width))_100%,var(--scrollbar-width)_100%] mask-position-[left_top,right_top] mask-no-repeat px-4 sm:px-6 xl:px-8",
				messages.length === 0 ? "pt-8 pb-32" : "pt-24",
			]}
			data-show="!$_sessionTransitionVisible"
			data-class:opacity-50="
				$_sessionLoading ||
				$_sessionTransitionLoading
			"
			data-attr:aria-busy="
				$_sessionLoading ||
				$_sessionTransitionLoading ? 'true' : 'false'
			"
			aria-live="polite"
			data-init="window.piUi.messageScroll.bindResize()"
		>
			<div class="messages-stack relative mx-auto min-h-full w-[calc(100%-2rem)] max-w-(--pi-messages-max-width)">
				{hasOlderMessages ? renderOlderMessagesTrigger() : ""}
				<div id="message-list" class="contents">
					{messages.length === 0
						? renderEmptyMessages(
								emptyHint,
								sessions.slice(0, 3),
								authenticated,
								sessionCatalogLoading,
							)
						: messages.map(renderMessage)}
				</div>
				{messages.length > 0 && (
					<div
						id="messages-prompt-spacer"
						class="pointer-events-none min-h-48 shrink-0"
						style="height: 12rem"
						data-preserve-attr="style"
						aria-hidden="true"
					/>
				)}
			</div>
		</main>,
	);
}

export function renderOlderMessagesPatch(
	messages: readonly AppMessage[],
	messageIds: readonly string[],
	hasOlderMessages: boolean,
): string {
	const ids = new Set(messageIds);
	return (
		(hasOlderMessages ? renderOlderMessagesTrigger() : "") +
		messages
			.map((message) => (ids.has(message.id) ? renderMessage(message) : ""))
			.join("")
	);
}

function renderEmptyMessages(
	emptyHint: AppKeybindHint,
	sessions: readonly AppSessionSummary[],
	authenticated: boolean,
	sessionCatalogLoading: boolean,
) {
	return (
		<div class="grid flex-1 place-items-center text-center text-muted-foreground">
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
					(sessionCatalogLoading || sessions.length > 0) && (
						<div class="mt-8 h-50 text-left">
							<p class="mb-2 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
								Recent sessions
							</p>
							{sessionCatalogLoading && sessions.length === 0 ? (
								<div
									class="grid h-44 place-items-center text-muted-foreground"
									role="status"
									aria-label="Loading recent sessions"
								>
									<svg
										class="size-5 animate-spin"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M12 2v4m4.2 1.8l2.9-2.9M18 12h4m-5.8 4.2l2.9 2.9M12 18v4m-7.1-2.9l2.9-2.9M2 12h4M4.9 4.9l2.9 2.9" />
									</svg>
								</div>
							) : (
								<div class="flex flex-col gap-1">
									{sessions.map((session, index) =>
										renderRecentSession(session, index),
									)}
								</div>
							)}
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
			class="flex h-14 w-full items-start justify-between gap-4 overflow-hidden rounded-md border-0 bg-transparent px-2 py-2 text-left outline-none hover:bg-muted focus:bg-muted"
			data-indicator:_session-loading
			data-attr:disabled="$_sessionTransitionLoading"
			data-on:click={resumeSessionAction(session.path)}
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
			<span class="flex shrink-0 items-center gap-2 whitespace-nowrap">
				<DateTime dateTime={session.modifiedAt} label={session.modified} />
				<ShortcutKbd shortcut={shortcut} />
			</span>
		</button>
	);
}

function renderOlderMessagesTrigger() {
	const loadOlderMessages = `window.piUi.messageScroll.captureAnchor() && @post('${endpoints.messagesOlder}', { payload: {} })`;
	return (
		<div
			id="older-messages-trigger"
			class="pointer-events-none absolute inset-0"
			aria-hidden="true"
		>
			<div
				class="absolute top-0 h-[min(50vh,100%)] w-full opacity-0"
				data-on-intersect={loadOlderMessages}
			/>
			<div
				class="absolute h-px w-full opacity-0"
				style="top: min(250vh, calc(100% - 1px))"
				data-on-intersect={loadOlderMessages}
			/>
		</div>
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

function renderPlainOutput(message: AppMessage) {
	return (
		<div
			class="tool-output pi-tool-output-surface max-h-[calc(5lh+1px)] overflow-hidden leading-5.5"
			data-init={`el.scrollTop = el.scrollHeight; ${message.presentationVersion}`}
		>
			{renderPendingToolOutput(message.text, "pl-2")}
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
	const cacheKey = `${getActiveCodeThemeId()}\0${command}`;
	const cached = inlineBashCache.get(cacheKey);
	if (cached) return cached;

	const highlighter = getHighlighterIfLoaded();
	if (!highlighter) return escapeHtml(command);

	try {
		const result = highlighter.codeToTokens(command, {
			lang: "bash",
			themes: getPierreThemes(),
		});
		const highlighted = result.tokens
			.map((line) => line.map(renderInlineToken).join(""))
			.join("\n");
		cacheInlineBash(cacheKey, highlighted);
		return highlighted;
	} catch {
		return escapeHtml(command);
	}
}

function cacheInlineBash(cacheKey: string, html: string): void {
	if (inlineBashCache.size >= maxInlineBashCacheEntries) {
		inlineBashCache.delete(inlineBashCache.keys().next().value ?? "");
	}
	inlineBashCache.set(cacheKey, html);
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
				payload: {},
			})`}
		>
			Enhance formatting
		</button>
	);
}

function renderUserFileAttachment(
	attachment: NonNullable<AppMessage["attachments"]>[number],
) {
	const extension = attachment.name.includes(".")
		? attachment.name.split(".").at(-1)?.slice(0, 4).toLowerCase()
		: undefined;
	const kind = attachmentFileKind(attachment.name, attachment.mimeType);
	return (
		<div class="flex h-16 max-w-60 min-w-0 items-center gap-2 rounded-xl border bg-card p-2 pr-3 text-card-foreground shadow-sm">
			<span class="pi-fine-print flex size-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border bg-muted">
				<AttachmentFileIcon kind={kind} />
				{extension && (
					<span class="font-mono text-[9px] leading-none uppercase" safe>
						{extension}
					</span>
				)}
			</span>
			<span class="min-w-0">
				<span class="block truncate text-xs font-medium" safe>
					{attachment.name}
				</span>
				<span class="pi-fine-print block text-[10px]">{fileKindLabel(kind)}</span>
			</span>
		</div>
	);
}

type AttachmentFileKind = keyof typeof attachmentFileIcons;

function fileKindLabel(kind: AttachmentFileKind): string {
	return kind;
}

function AttachmentFileIcon(props: { kind: AttachmentFileKind }) {
	const icon = attachmentFileIcons[props.kind];
	return (
		<Icon class="size-5">
			<>
				{icon.paths.map((path) => (
					<path d={path} />
				))}
				{"circle" in icon && <circle {...icon.circle} />}
			</>
		</Icon>
	);
}

function toolTitlePartClass(part: AppMessageTitlePart, index: number): string {
	const classes = [];
	if (index === 0 && !part.mono) classes.push("mr-2");
	if (part.mono) classes.push("font-mono");
	if (part.highlight === "bash") classes.push("break-all whitespace-pre-wrap");
	if (part.tone === "accent") classes.push("text-primary");
	if (part.tone === "warning") classes.push("pi-warning-foreground");
	if (part.tone === "muted") classes.push("text-muted-foreground");
	return classes.join(" ");
}

function renderPlainTextLinks(text: string): string {
	const parts = text.split(/(https?:\/\/\S+)/gu);
	return syncHtml(
		<>
			{parts.filter(Boolean).map((part) =>
				part.startsWith("http://") || part.startsWith("https://") ? (
					<a
						class="underline decoration-border underline-offset-2 hover:decoration-current"
						href={part}
						target="_blank"
						rel="noreferrer"
						safe
					>
						{part}
					</a>
				) : (
					<span safe>{part}</span>
				),
			)}
		</>,
	);
}

export function renderMessage(message: AppMessage): string {
	if (message.role === "user") return renderUserMessage(message);
	if (message.role === "assistant" || message.role === "thought") {
		return renderNarrativeMessage(message);
	}
	if (message.role === "system" || message.role === "notice") {
		return renderSystemMessage(message);
	}
	if (message.role === "compaction" || message.role === "skill") {
		return renderContextMessage(message);
	}
	return renderToolMessage(message);
}

function renderUserMessage(message: AppMessage): string {
	const imageAttachments =
		message.attachments?.filter((attachment) => attachment.image) ?? [];
	const fileAttachments =
		message.attachments?.filter((attachment) => !attachment.image) ?? [];
	return syncHtml(
		<article
			class="message message-user flex max-w-[min(32rem,72%)] flex-col items-end gap-2 self-end"
			data-message-id={message.id}
		>
			{imageAttachments.length ? (
				<div class="flex max-w-full flex-wrap justify-end gap-2">
					{imageAttachments.map((attachment, index) => (
						<div class="overflow-clip rounded-xl bg-primary p-1.5">
							<img
								class="max-h-72 max-w-full rounded-lg object-contain"
								src={
									attachment.image!.url ??
									`data:${attachment.image!.mimeType};base64,${attachment.image!.data}`
								}
								alt={attachment.name || `Attached image ${index + 1}`}
								style="overflow-clip-margin: unset;"
							/>
						</div>
					))}
				</div>
			) : (
				""
			)}
			{fileAttachments.length ? (
				<div class="flex max-w-full flex-wrap justify-end gap-2">
					{fileAttachments.map(renderUserFileAttachment)}
				</div>
			) : (
				""
			)}
			{message.text && (
				<p
					class="m-0 max-w-full rounded-xl bg-primary px-3.5 py-2.5 wrap-anywhere whitespace-pre-wrap text-primary-foreground"
					safe
				>
					{message.text}
				</p>
			)}
		</article>,
	);
}

function renderNarrativeMessage(message: AppMessage): string {
	return syncHtml(
		<article
			class={[
				"message message-narrative markdown-content w-full self-start",
				message.role === "assistant"
					? "message-assistant"
					: "message-thought pi-thought-foreground text-sm italic",
			]}
			data-message-id={message.id}
			data-ignore-morph={preservesFinalizedMessageDom(message)}
		>
			<div>{message.renderedHtml ?? renderMarkdownStreaming(message.text)}</div>
			{renderDeferredEnhancement(message)}
		</article>,
	);
}

function renderSystemMessage(message: AppMessage): string {
	const isError = message.state === "error";
	return syncHtml(
		<article
			class={[
				"message message-narrative max-w-3xl self-start",
				isError
					? "message-system pi-error-foreground"
					: message.role === "notice"
						? "message-notice pi-warning-foreground"
						: "message-system text-muted-foreground",
			]}
			data-message-id={message.id}
			role={isError ? "alert" : message.role === "notice" ? "status" : undefined}
		>
			<p class="m-0 whitespace-pre-wrap">{renderPlainTextLinks(message.text)}</p>
		</article>,
	);
}

function renderContextMessage(message: AppMessage): string {
	const label = message.role === "compaction" ? "compaction" : "skill";
	return syncHtml(
		<article
			class={[
				"message pi-tool-timeline-item w-full self-start",
				message.role === "compaction" ? "message-compaction" : "message-skill",
			]}
			data-message-id={message.id}
		>
			<details class="group" data-preserve-attr="open">
				<summary class="flex min-h-4.5 cursor-pointer list-none items-start gap-2 font-mono text-sm outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
					<span class="pi-tool-state-dot inline-grid size-2" aria-hidden="true">
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
							class="size-3.5 rotate-180 transition-transform duration-150 ease-(--pi-ease-out) group-open:rotate-90 motion-reduce:transition-none"
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
						<div>
							{message.renderedHtml ??
								renderMarkdownStreaming(message.text)}
						</div>
					</div>
				</div>
			</details>
		</article>,
	);
}

function renderToolOutput(message: AppMessage) {
	if (!message.text.trim()) return "";
	if (message.format === "diff") return renderDiffOutput(message);
	if (message.format === "code") return renderCodeOutput(message);
	if (message.format === "output") return renderPlainOutput(message);
	return renderPreOutput(message.text);
}

type ToolMessageStatus = {
	state: "running" | "error" | "success";
	label: "Running" | "Failed" | "Completed";
};

function toolMessageStatus(message: AppMessage): ToolMessageStatus {
	if (message.state === "running") return { state: "running", label: "Running" };
	if (message.state === "error") return { state: "error", label: "Failed" };
	return { state: "success", label: "Completed" };
}

function renderToolMessage(message: AppMessage): string {
	const status = toolMessageStatus(message);
	return syncHtml(
		<article
			class="message message-tool pi-tool-timeline-item w-full self-start"
			data-message-id={message.id}
		>
			<header class="flex min-h-4.5 items-start gap-2 font-mono text-sm">
				<StatusDot
					class="pi-tool-state-dot"
					state={status.state}
					label={status.label}
				/>
				<span class="min-w-0 flex-1 leading-4.5 font-medium wrap-anywhere">
					{renderToolTitle(message.title ?? "Tool", message.titleParts)}
				</span>
				<span
					class="ml-auto inline-flex h-4.5 min-w-[6ch] shrink-0 items-center justify-end text-xs font-normal text-muted-foreground tabular-nums"
					aria-hidden={message.meta ? undefined : "true"}
					safe
				>
					{message.meta ?? ""}
				</span>
			</header>
			{renderToolOutput(message)}
			{renderDeferredEnhancement(message)}
		</article>,
	);
}
