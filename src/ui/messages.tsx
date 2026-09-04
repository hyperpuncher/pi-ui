import { getHighlighterIfLoaded, type ThemedToken } from "@pierre/diffs";

import {
	attachmentFileExtension,
	attachmentFileIcons,
	attachmentFileKind,
} from "../../static/app/attachment-file.js";
import { authDialogAction } from "../commands/actions.ts";
import { getActiveCodeThemeId, getPierreThemes } from "../pierre-theme.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type { AppKeybindHint, AppSessionSummary } from "../state/app-store.ts";
import type { TranscriptMessageTitlePart } from "../state/transcript-state.ts";
import { escapeHtml } from "../utils/html.ts";
import { primaryModifierExpression } from "../utils/keyboard.ts";
import { DateTime } from "./date-time.tsx";
import { Icon } from "./icon.tsx";
import { ChevronRight, Loader } from "./icons.ts";
import { altShortcutAction, ShortcutKbd } from "./keyboard.tsx";
import { renderMarkdownStreaming } from "./markdown.tsx";
import type { AppMessage } from "./render-state.ts";
import { SessionSubtitle } from "./session-summary.tsx";
import { resumeSessionAction } from "./session-transition.tsx";
import { shikiTokenStyle } from "./shiki-token-style.ts";
import { StatusDot } from "./status-dot.tsx";
import { syncHtml } from "./sync-html.ts";

const inlineBashCache = new Map<string, string>();
const maxInlineBashCacheEntries = 500;

function preservesFinalizedMessageDom(message: AppMessage): boolean {
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
			class={messages.length === 0 ? "messages-empty" : undefined}
			data-show="!$_sessionTransitionVisible"
			data-class:messages-loading="
				$_sessionLoading ||
				$_sessionTransitionLoading
			"
			data-attr:aria-busy="
				$_sessionLoading ||
				$_sessionTransitionLoading ? 'true' : 'false'
			"
			aria-live="polite"
			aria-keyshortcuts="Alt+C"
			tabindex="-1"
			data-init="window.piUi.messageScroll.bindResize()"
			data-on:keydown__window={`if (
			${primaryModifierExpression()} &&
			evt.altKey &&
			!evt.shiftKey &&
			evt.code === 'KeyT'
			) {
			evt.preventDefault();
			@post('${endpoints.thinkingVisibilityToggle}', { payload: {} });
			}
			${altShortcutAction("KeyC", "el.focus({ preventScroll: true });")}`}
		>
			<div class="messages-stack">
				<div id="message-list">
					<div
						class="older-messages-loading"
						data-show="$_olderMessagesLoading"
						style="display: none"
					>
						<Icon
							icon={Loader}
							label="Loading older messages"
							role="status"
							class="icon-spin older-messages-spinner"
						/>
					</div>
					{renderOlderMessagesTrigger(hasOlderMessages)}
					{messages.length === 0
						? renderEmptyMessages(
								emptyHint,
								sessions.slice(0, 3),
								authenticated,
								sessionCatalogLoading,
							)
						: messages.map(renderMessage)}
				</div>
				<button
					id="messages-trim"
					type="button"
					hidden
					data-on:click={`@post('${endpoints.messagesTrim}', { payload: {} })`}
					tabindex="-1"
					aria-hidden="true"
				/>
				{messages.length > 0 && (
					<div
						id="messages-prompt-spacer"
						class="messages-prompt-spacer"
						style="height: 12rem"
						data-preserve-attr="style"
						aria-hidden="true"
					/>
				)}
			</div>
		</main>,
	);
}

export function renderOlderMessagesPatch(messages: readonly AppMessage[]): string {
	return messages.map(renderMessage).join("");
}

export function renderOlderMessagesTriggerPatch(active: boolean): string {
	return syncHtml(renderOlderMessagesTrigger(active));
}

function renderEmptyMessages(
	emptyHint: AppKeybindHint,
	sessions: readonly AppSessionSummary[],
	authenticated: boolean,
	sessionCatalogLoading: boolean,
) {
	return (
		<div class="messages-empty-state">
			<div class="messages-empty-content">
				<p class="messages-empty-title">What can I help with?</p>
				<p class="messages-empty-hint" data-keybind-hint>
					<ShortcutKbd shortcut={emptyHint.keys} />
					<span safe>{emptyHint.description}</span>
				</p>
				{!authenticated ? (
					<p class="messages-empty-login">
						<button
							type="button"
							class="btn messages-login-button"
							data-variant="link"
							data-on:click={authDialogAction("login")}
						>
							/login
						</button>{" "}
						to connect a provider and start chatting
					</p>
				) : (
					(sessionCatalogLoading || sessions.length > 0) && (
						<div class="recent-sessions">
							<p class="recent-sessions-heading">Recent sessions</p>
							{sessionCatalogLoading && sessions.length === 0 ? (
								<div
									class="recent-sessions-loading"
									role="status"
									aria-label="Loading recent sessions"
								>
									<Icon
										icon={Loader}
										class="icon-spin recent-sessions-spinner"
									/>
								</div>
							) : (
								<div class="recent-sessions-list">
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
			class="recent-session"
			data-indicator:_session-loading
			data-attr:disabled="$_sessionTransitionLoading"
			data-on:click={resumeSessionAction(session.path)}
		>
			<span class="recent-session-main">
				<span class="recent-session-title" safe>
					{session.title}
				</span>
				<SessionSubtitle session={session} class="recent-session-subtitle" />
			</span>
			<span class="recent-session-meta">
				<DateTime dateTime={session.modifiedAt} label={session.modified} />
				<ShortcutKbd shortcut={shortcut} />
			</span>
		</button>
	);
}

function renderOlderMessagesTrigger(active: boolean) {
	const action = active
		? `window.piUi.messageScroll.captureAnchor() && @post('${endpoints.messagesOlder}', { payload: {} })`
		: undefined;
	return (
		<div
			id="older-messages-trigger"
			class="older-messages-trigger"
			aria-hidden="true"
		>
			{action && (
				<>
					<div
						class="older-messages-sensor older-messages-sensor-top"
						data-indicator:_older-messages-loading
						data-on-intersect={action}
					/>
					<div
						class="older-messages-sensor older-messages-sensor-bottom"
						style="top: min(250vh, calc(100% - 1px))"
						data-indicator:_older-messages-loading
						data-on-intersect={action}
					/>
				</>
			)}
		</div>
	);
}

function renderPreOutput(text: string) {
	return (
		<div class="tool-output-surface tool-pre-output">
			<pre class="tool-pre">
				<code safe>{text}</code>
			</pre>
		</div>
	);
}

function renderDiffOutput(message: AppMessage) {
	return (
		<div class="diff-output tool-output-surface tool-rendered-output">
			{message.renderedHtml ??
				renderPendingToolOutput(
					stripDiffMetadata(message.text),
					"tool-output-diff-padding",
				)}
		</div>
	);
}

function renderCodeOutput(message: AppMessage) {
	return (
		<div class="code-output tool-output-surface tool-rendered-output">
			{message.renderedHtml ?? renderPendingCodeOutput(message.text)}
		</div>
	);
}

function renderPlainOutput(message: AppMessage) {
	return (
		<div
			class="tool-output tool-output-surface tool-plain-output"
			data-init={`el.scrollTop = el.scrollHeight; ${message.presentationVersion}`}
		>
			{renderPendingToolOutput(message.text, "tool-output-padding")}
		</div>
	);
}

function renderPendingCodeOutput(text: string) {
	return (
		<pre class="tool-pending-output tool-pending-code">
			<code>{renderInlineBash(text)}</code>
		</pre>
	);
}

function renderPendingToolOutput(text: string, paddingClass: string) {
	return (
		<pre class={["tool-pending-output", paddingClass]}>
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

function renderToolTitle(title: string, parts: TranscriptMessageTitlePart[] | undefined) {
	if (!parts?.length) return <span safe>{title}</span>;
	if (parts[0]?.text === "$ " && parts[1]?.highlight === "bash") {
		return (
			<span class="tool-command-title">
				<span class="tool-command-prompt" safe>
					{parts[0].text.trimEnd()}
				</span>
				<span class="tool-command-content">
					{parts
						.slice(1)
						.map((part, index) => renderToolTitlePart(part, index + 1))}
				</span>
			</span>
		);
	}
	return <>{parts.map(renderToolTitlePart)}</>;
}

function renderToolTitlePart(part: TranscriptMessageTitlePart, index: number) {
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
			class="btn enhance-message"
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
	const extension = attachmentFileExtension(attachment.name);
	const kind = attachmentFileKind(attachment.name, attachment.mimeType);
	return (
		<div class="message-file">
			<span class="fine-print message-file-icon">
				<AttachmentFileIcon kind={kind} />
				{extension && (
					<span class="message-file-extension" safe>
						{extension}
					</span>
				)}
			</span>
			<span class="message-file-content">
				<span class="message-file-name" safe>
					{attachment.name}
				</span>
				<span class="fine-print message-file-kind">{kind}</span>
			</span>
		</div>
	);
}

type AttachmentFileKind = keyof typeof attachmentFileIcons;

function AttachmentFileIcon(props: { kind: AttachmentFileKind }) {
	const icon = attachmentFileIcons[props.kind];
	return (
		<Icon class="message-file-type-icon">
			<>
				{icon.paths.map((path) => (
					<path d={path} />
				))}
				{"circle" in icon && <circle {...icon.circle} />}
			</>
		</Icon>
	);
}

function toolTitlePartClass(part: TranscriptMessageTitlePart, index: number): string {
	const classes = [];
	if (index === 0 && !part.mono) classes.push("tool-title-gap");
	if (part.mono) classes.push("tool-title-mono");
	if (part.highlight === "bash") classes.push("tool-title-bash");
	if (part.tone === "accent") classes.push("tool-title-accent");
	if (part.tone === "warning") classes.push("warning-foreground");
	if (part.tone === "muted") classes.push("tool-title-muted");
	return classes.join(" ");
}

function renderPlainTextLinks(text: string): string {
	const parts = text.split(/(https?:\/\/\S+)/gu);
	return syncHtml(
		<>
			{parts.filter(Boolean).map((part) =>
				part.startsWith("http://") || part.startsWith("https://") ? (
					<a
						class="message-link"
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
	if (
		message.role === "compaction" ||
		message.role === "summary" ||
		message.role === "skill"
	) {
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
		<article class="message message-user" data-message-id={message.id}>
			{imageAttachments.length ? (
				<div class="message-attachments">
					{imageAttachments.map((attachment, index) => (
						<div class="message-image-frame">
							<img
								class="message-image"
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
				<div class="message-attachments">
					{fileAttachments.map(renderUserFileAttachment)}
				</div>
			) : (
				""
			)}
			{message.text && (
				<p class="message-user-text" safe>
					{message.text}
				</p>
			)}
		</article>,
	);
}

function renderNarrativeMessage(message: AppMessage): string {
	const content = message.renderedHtml ?? renderMarkdownStreaming(message.text);
	if (message.role === "thought") {
		return syncHtml(
			<article
				class="message message-narrative message-thought thought-foreground"
				data-message-id={message.id}
				data-ignore-morph={preservesFinalizedMessageDom(message)}
			>
				<p
					class="thinking-placeholder"
					data-show="$_thinkingHidden && !$_minimalMode"
				>
					Thinking...
				</p>
				<div
					class="tool-timeline-item minimal-activity"
					style="display: none"
					data-show="$_minimalMode"
				>
					<StatusDot class="tool-state-dot" state="running" label="Thinking" />
					<p class="minimal-activity-label">thinking...</p>
				</div>
				<div data-show="!$_thinkingHidden && !$_minimalMode">
					<div class="markdown-content">{content}</div>
					{renderDeferredEnhancement(message)}
				</div>
			</article>,
		);
	}
	return syncHtml(
		<article
			class={[
				"message message-narrative message-assistant",
				message.activitySummary && "message-activity-result",
			]}
			data-message-id={message.id}
			data-ignore-morph={preservesFinalizedMessageDom(message)}
		>
			{message.activitySummary && (
				<div
					class="activity-summary tool-timeline-item minimal-activity"
					style="display: none"
					data-show="$_minimalMode"
				>
					<StatusDot class="tool-state-dot" state="success" label="Completed" />
					<p class="minimal-activity-label">
						completed {message.activitySummary.stepCount}{" "}
						{message.activitySummary.stepCount === 1 ? "step" : "steps"} in{" "}
						{message.activitySummary.duration}
					</p>
				</div>
			)}
			<div class="markdown-content">{content}</div>
			{renderDeferredEnhancement(message)}
		</article>,
	);
}

function renderSystemMessage(message: AppMessage): string {
	const isError = message.state === "error";
	return syncHtml(
		<article
			class={[
				"message message-narrative message-system-row",
				isError
					? "message-system error-foreground"
					: message.role === "notice"
						? "message-notice warning-foreground"
						: "message-system message-muted",
			]}
			data-message-id={message.id}
			role={isError ? "alert" : message.role === "notice" ? "status" : undefined}
		>
			<p class="message-system-text">{renderPlainTextLinks(message.text)}</p>
		</article>,
	);
}

function renderContextMessage(message: AppMessage): string {
	const label =
		message.role === "compaction"
			? "compaction"
			: message.role === "summary"
				? "summarize"
				: "skill";
	return syncHtml(
		<article
			class={[
				"message message-context tool-timeline-item",
				message.role === "compaction"
					? "message-compaction"
					: message.role === "skill"
						? "message-skill"
						: undefined,
			]}
			data-message-id={message.id}
		>
			<details class="context-details" data-preserve-attr="open">
				<summary class="context-summary">
					<span class="tool-state-dot status-dot" aria-hidden="true">
						<span class="tool-status-ball tool-status-success" />
					</span>
					<span class="context-title">
						<span safe>{label}</span>
						{message.meta && (
							<span class="context-meta" safe>
								{message.meta}
							</span>
						)}
					</span>
					<span class="context-chevron">
						<Icon icon={ChevronRight} class="context-chevron-icon" />
					</span>
				</summary>
				<div class="tool-output-surface context-output">
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
			class="message message-tool tool-timeline-item"
			data-message-id={message.id}
		>
			<StatusDot class="tool-state-dot" state={status.state} label={status.label} />
			<header class="tool-header" data-show="!$_minimalMode && !$_toolOutputHidden">
				<span class="tool-title">
					{renderToolTitle(message.title ?? "Tool", message.titleParts)}
				</span>
				<span
					class="tool-meta"
					aria-hidden={message.meta ? undefined : "true"}
					safe
				>
					{message.meta ?? ""}
				</span>
			</header>
			<p class="tool-title-compact" data-show="$_minimalMode || $_toolOutputHidden">
				<span class="tool-title-compact-content">
					{renderToolTitle(message.title ?? "Tool", message.titleParts)}
				</span>
			</p>
			<div data-show="!$_minimalMode && !$_toolOutputHidden">
				{renderToolOutput(message)}
				{renderDeferredEnhancement(message)}
			</div>
		</article>,
	);
}
