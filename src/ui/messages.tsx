import { type ThemedToken, tokenStyle } from "@pierre/diffs";

import { providerErrorPresentation } from "#src/agent/provider-error-message.ts";
import { formatDuration, toolTitleParts } from "#src/agent/tool-presentation.ts";
import { authDialogAction } from "#src/commands/actions.ts";
import { keybindActions, keybindAria } from "#src/keybinds.ts";
import { codeThemeKey } from "#src/pierre-theme.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";
import type { AppKeybindHint, AppSessionSummary } from "#src/state/app-store.ts";
import type { TranscriptMessageTitlePart } from "#src/state/transcript-state.ts";
import {
	type CodeSnippet,
	codeSnippets,
	highlightArguments,
	highlightBash,
	highlightCodemode,
} from "#src/ui/bash-highlight.ts";
import { DateTime } from "#src/ui/date-time.tsx";
import { Icon } from "#src/ui/icon.tsx";
import { ShortcutKbd } from "#src/ui/keyboard.tsx";
import { renderMarkdownStreaming } from "#src/ui/markdown.tsx";
import { BoundedCache } from "#src/ui/render-cache.ts";
import type { AppMessage } from "#src/ui/render-state.ts";
import { SessionSubtitle } from "#src/ui/session-summary.tsx";
import { resumeSessionAction } from "#src/ui/session-transition.tsx";
import { loaderIcon, StatusIcon } from "#src/ui/status-icon.tsx";
import { syncHtml } from "#src/ui/sync-html.ts";
import {
	attachmentFileExtension,
	attachmentFileIcons,
	attachmentFileKind,
} from "#static/app/attachment-file.js";

type InlineCodeCacheEntry = { html: string };
const inlineCodeCache = new BoundedCache<string, InlineCodeCacheEntry>(500);

// Matches the 18rem cap on .message-image. Both sides must agree or the
// reserved box and the rendered box differ and the image shifts on load.
const imageDisplayMaxHeight = 288;

/** Display box for a chat image: cap height, let max-width handle width. */
function displayImageSize(width?: number, height?: number) {
	if (width === undefined || height === undefined) return undefined;
	const scale = height > imageDisplayMaxHeight ? imageDisplayMaxHeight / height : 1;
	return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export type MessageRenderOptions = {
	thinkingHidden?: boolean;
	minimalMode?: boolean;
};

export function renderMessages(
	messages: readonly AppMessage[],
	emptyHint: AppKeybindHint,
	hasOlderMessages = false,
	sessions: readonly AppSessionSummary[] = [],
	authenticated = true,
	sessionCatalogLoading = false,
	compactTools = false,
	options: MessageRenderOptions = {},
): string {
	return syncHtml(
		<main
			id="messages"
			class={messages.length === 0 ? "messages-empty" : undefined}
			data-compact-tools={compactTools || undefined}
			data-class:messages-loading="$_sessionSwitching || $_sessionTransitionStatus === 'loading'"
			data-attr:aria-busy="$_sessionSwitching || $_sessionTransitionStatus === 'loading' ? 'true' : 'false'"
			aria-live="polite"
			aria-keyshortcuts={keybindAria("focus-conversation")}
			tabindex="-1"
			data-init="
				window.piUi.messageScroll.bindResize();
				window.piUi.messageScroll.checkOlder()
			"
			data-preserve-attr="style"
			data-on:scroll="window.piUi.messageScroll.checkOlder()"
			data-indicator:_history-trimming
			data-on:pi-ui-trim={`if (!$_historyLoading && !$_historyTrimming && $_sessionTransitionStatus !== 'loading') {
				@post('${endpoints.messagesTrim}', { payload: evt.detail, retry: 'never' });
			}`}
			data-on:keydown__window={keybindActions(
				[
					"toggle-thinking",
					`@post('${endpoints.thinkingVisibilityToggle}', { payload: {}, retry: 'never' });`,
				],
				["focus-conversation", "el.focus({ preventScroll: true });"],
			)}
		>
			<div class="messages-stack">
				<div id="message-list">
					<div
						class="older-messages-loading"
						data-show="$_historyLoading"
						style="display: none"
					>
						{loaderIcon("Loading older messages")}
					</div>
					{renderOlderMessagesTrigger(hasOlderMessages)}
					{messages.length === 0
						? renderEmptyMessages(
								emptyHint,
								sessions.slice(0, 3),
								authenticated,
								sessionCatalogLoading,
							)
						: messages.map((message) =>
								renderMessage(message, compactTools, options),
							)}
				</div>

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

export function renderOlderMessagesTrigger(active: boolean): string {
	return syncHtml(
		<div
			id="older-messages-trigger"
			style="height: 1px"
			data-active={active && "1"}
			data-indicator:_history-loading
			data-on:pi-ui-older={
				active &&
				`if (!$_historyLoading) { @post('${endpoints.messagesOlder}', { payload: {}, retry: 'never' }) }`
			}
			data-on:datastar-fetch={
				active &&
				`if (evt.detail.el === el && evt.detail.type === 'finished') window.piUi.messageScroll.checkOlder()`
			}
			aria-hidden="true"
		/>,
	);
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
									{loaderIcon()}
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
			data-attr:disabled="$_sessionTransitionStatus === 'loading'"
			data-on:click={resumeSessionAction(session.path)}
			data-indicator:_session-switching
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
		<div class="tool-output tool-output-surface tool-plain-output">
			{renderPendingToolOutput(message.text, "tool-output-padding")}
		</div>
	);
}

function renderPendingCodeOutput(text: string) {
	return (
		<pre class="tool-pending-output tool-pending-code">
			<code>{renderInlineCode(text)}</code>
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

function renderToolTitle(
	title: string,
	parts: TranscriptMessageTitlePart[] | undefined,
	snippets: CodeSnippet[] = [],
) {
	if (!parts?.length) return <span safe>{title}</span>;
	if (parts[0]?.text === "$ " && parts[1]?.highlight === "bash") {
		return (
			<span class="tool-command-title">
				<span class="tool-command-prompt" safe>
					{parts[0].text.trimEnd()}
				</span>
				<span class="tool-command-content">
					{renderToolTitlePart(
						parts[1],
						1,
						parts
							.slice(2)
							.map((part, index) => renderToolTitlePart(part, index + 2))
							.join(""),
					)}
				</span>
			</span>
		);
	}
	return (
		<>{parts.map((part, index) => renderToolTitlePart(part, index, "", snippets))}</>
	);
}

function renderToolTitlePart(
	part: TranscriptMessageTitlePart,
	index: number,
	suffix = "",
	snippets: CodeSnippet[] = [],
) {
	return part.highlight ? (
		<span class={toolTitlePartClass(part, index)}>
			{renderInlineCode(
				part.highlight === "javascript" ? part.text.trimEnd() : part.text,
				suffix,
				part.highlight,
				snippets,
			)}
		</span>
	) : (
		<span class={toolTitlePartClass(part, index)} safe>
			{part.text}
		</span>
	);
}

function renderInlineCode(
	command: string,
	suffix = "",
	language = "bash",
	snippets: CodeSnippet[] = [],
): string {
	const hintsKey = snippets
		.map(({ field, language, value }) => `${field}:${language}:${Bun.hash(value)}`)
		.join("\0");
	const cacheKey = `${codeThemeKey()}\0${language}\0${command}\0${suffix}\0${hintsKey}`;
	const cached = inlineCodeCache.get(cacheKey);
	if (cached) return cached.html;

	try {
		const result =
			language === "bash"
				? highlightBash(command, { format: true })
				: language === "yaml"
					? highlightArguments(command)
					: highlightCodemode(command, snippets);
		if (!result) return Bun.escapeHTML(command) + suffix;
		const { tokens } = result;
		const highlighted = tokens
			.map((line, index) => {
				const text = line.map((token) => token.content).join("");
				const indent = (text.match(/^[\t ]*/)?.[0] ?? "").replaceAll(
					"\t",
					"    ",
				).length;
				return `<span class="shell-line" style="--shell-indent:${indent + 2}ch">${line.map(renderInlineToken).join("")}${index === tokens.length - 1 ? suffix : ""}</span>`;
			})
			.join("\n");
		inlineCodeCache.set(cacheKey, { html: highlighted });
		return highlighted;
	} catch {
		return Bun.escapeHTML(command) + suffix;
	}
}

function renderInlineToken(token: ThemedToken): string {
	const style = tokenStyle(token, true);
	const styleAttribute = style ? ` style="${Bun.escapeHTML(style)}"` : "";
	return `<span${styleAttribute}>${Bun.escapeHTML(token.content)}</span>`;
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
		<Icon>
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
	if (part.highlight) classes.push(`tool-title-${part.highlight}`);
	if (part.inline) classes.push("tool-title-inline");
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

export function renderMessage(
	message: AppMessage,
	compactTools = false,
	options: MessageRenderOptions = {},
): string {
	if (message.role === "user") return renderUserMessage(message);
	if (message.role === "assistant" || message.role === "thought") {
		return renderNarrativeMessage(message, options);
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
	if (message.page && message.pageUrl)
		return renderPageMessage(message, message.pageUrl);
	return renderToolMessage(message, compactTools, options);
}

function renderImageAttachments(
	attachments: AppMessage["attachments"],
	className?: string,
) {
	const images = attachments?.filter((attachment) => attachment.image) ?? [];
	if (!images.length) return "";
	return (
		<div class={["message-attachments", className]}>
			{images.map((attachment, index) => renderImageAttachment(attachment, index))}
		</div>
	);
}

function renderImageAttachment(
	attachment: NonNullable<AppMessage["attachments"]>[number],
	index: number,
) {
	const image = attachment.image!;
	const full = image.url ?? `data:${image.mimeType};base64,${image.data}`;
	// Thumbnails only exist for store URLs; data URLs and animated GIFs load
	// as-is (still lazy). Width/height reserve the box before bytes arrive.
	const thumb =
		image.url && image.mimeType !== "image/gif" ? `${image.url}&thumb=1` : undefined;
	const src = thumb ?? full;
	// Reserve the exact displayed box so decode cannot shift layout. The
	// browser honors max-width before load, so a narrow container shrinks the
	// reserved box the same way it shrinks the image.
	const size = displayImageSize(image.width, image.height);
	const content = (
		<img
			class="message-image"
			src={src}
			alt={attachment.name || `Attached image ${index + 1}`}
			loading="lazy"
			decoding="async"
			width={size?.width}
			height={size?.height}
		/>
	);
	return thumb ? (
		<a class="message-image-frame" href={full}>
			{content}
		</a>
	) : (
		<span class="message-image-frame">{content}</span>
	);
}

function renderUserMessage(message: AppMessage): string {
	const fileAttachments =
		message.attachments?.filter((attachment) => !attachment.image) ?? [];
	return syncHtml(
		<article class="message message-user" id={`message-${message.id}`}>
			{renderImageAttachments(message.attachments)}
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

function toggleMessageExpandAction(id: string): string {
	return `@post('${endpoints.messagesToggleExpand}', { payload: { messageId: ${JSON.stringify(id)} }, retry: 'never' })`;
}

function thoughtPreview(text: string): string | undefined {
	for (let start = 0; start < text.length;) {
		const end = text.indexOf("\n", start);
		const lineEnd = end === -1 ? text.length : end;
		const line = text
			.slice(start, lineEnd)
			.trim()
			.replace(/^[#>*\-`\s]+/, "")
			.replace(/\s+/g, " ")
			.trim();
		if (line) {
			const clipped = line.match(/^[\s\S]{0,80}/u)?.[0] ?? "";
			return clipped === line ? line : `${clipped}…`;
		}
		start = lineEnd + 1;
	}
	return undefined;
}

function formatActivitySummaryLabel(
	summary: NonNullable<AppMessage["activitySummary"]>,
): string {
	if (summary.stepCount > 0) {
		return `completed ${summary.stepCount} ${summary.stepCount === 1 ? "step" : "steps"} in ${summary.duration}`;
	}
	return summary.duration ? `thought for ${summary.duration}` : "thought";
}

function renderNarrativeMessage(
	message: AppMessage,
	options: MessageRenderOptions = {},
): string {
	if (message.role === "thought") {
		const isMinimalRow = Boolean(options.minimalMode) && !message.minimalExpanded;
		if (isMinimalRow) {
			return syncHtml(
				<article
					class="message message-narrative message-thought thought-foreground"
					id={`message-${message.id}`}
				>
					<div class="tool-timeline-item minimal-activity">
						<StatusIcon
							class="tool-state-dot"
							state={message.streaming ? "running" : "success"}
							label={message.streaming ? "Thinking" : "Thought"}
						/>
						<p class="minimal-activity-label">
							{message.activityStep && message.activityStep > 0
								? `step ${message.activityStep + 1} · `
								: ""}
							{message.streaming ? "thinking..." : "thought"}
						</p>
					</div>
				</article>,
			);
		}
		const content = message.renderedHtml ?? renderMarkdownStreaming(message.text);
		const isCollapsible =
			Boolean(options.thinkingHidden) ||
			(Boolean(options.minimalMode) && Boolean(message.minimalExpanded));
		if (isCollapsible) {
			const preview = thoughtPreview(message.text);
			return syncHtml(
				<article
					class={[
						"message message-narrative message-thought message-context tool-timeline-item thought-foreground",
						message.minimalExpanded && "minimal-turn-expanded",
					]}
					id={`message-${message.id}`}
				>
					<details
						class="context-details thought-details"
						data-preserve-attr="open"
					>
						<summary class="context-summary thought-summary">
							<StatusIcon
								class="tool-state-dot"
								state={message.streaming ? "running" : "success"}
								label={message.streaming ? "Thinking" : "Thought"}
							/>
							<span class="context-title thought-summary-title">
								<span>
									{message.streaming ? "thinking..." : "thought"}
								</span>
								{message.thoughtDuration && (
									<span class="context-meta" safe>
										{message.thoughtDuration}
									</span>
								)}
								{preview && (
									<span class="context-meta thought-preview" safe>
										{preview}
									</span>
								)}
							</span>
							<span class="context-chevron">
								<Icon name="chevron-right" />
							</span>
						</summary>
						<div class="thought-details-content">
							<div class="markdown-content">{content}</div>
						</div>
					</details>
				</article>,
			);
		}
		return syncHtml(
			<article
				class="message message-narrative message-thought thought-foreground"
				id={`message-${message.id}`}
			>
				<div class="thought-content">
					<div class="markdown-content">{content}</div>
				</div>
			</article>,
		);
	}
	const content = message.renderedHtml ?? renderMarkdownStreaming(message.text);
	return syncHtml(
		<article
			class="message message-narrative message-assistant"
			id={`message-${message.id}`}
		>
			{message.activitySummary && (
				<button
					type="button"
					class="activity-summary tool-timeline-item minimal-activity"
					aria-expanded={message.activitySummary.expanded ? "true" : "false"}
					data-on:click={toggleMessageExpandAction(message.id)}
				>
					<StatusIcon
						class="tool-state-dot"
						state="success"
						label="Completed"
					/>
					<span class="minimal-activity-label">
						{formatActivitySummaryLabel(message.activitySummary)}
					</span>
					<span class="context-chevron">
						<Icon name="chevron-right" />
					</span>
				</button>
			)}
			<div class="markdown-content">{content}</div>
		</article>,
	);
}

const noticeLabels = { info: "Info: ", warning: "Warning: ", error: "Error: " };

function renderSystemMessage(message: AppMessage): string {
	if (message.state === "error") return renderErrorMessage(message);
	const hasStatus = message.role === "notice";
	const level = message.level ?? "warning";
	return syncHtml(
		<article
			class={[
				"message message-narrative message-system-row",
				hasStatus && "message-status-row tool-timeline-item",
				hasStatus ? "message-notice" : "message-system message-muted",
			]}
			id={`message-${message.id}`}
			role={hasStatus ? "status" : undefined}
		>
			{hasStatus && <StatusIcon class="tool-state-dot" state={level} />}
			<p class={["message-system-text", hasStatus && "tool-header"]}>
				<span class={hasStatus ? "tool-title" : undefined}>
					{hasStatus && <span class="sr-only">{noticeLabels[level]}</span>}
					{message.title ? (
						<>
							<span safe>{message.title}</span>
							<span class="context-meta">
								{renderPlainTextLinks(message.text)}
							</span>
						</>
					) : (
						renderPlainTextLinks(message.text)
					)}
				</span>
			</p>
		</article>,
	);
}

function renderErrorMessage(message: AppMessage): string {
	const { summary, details } = providerErrorPresentation(message.text);
	return syncHtml(
		<article
			class="message message-narrative message-system message-system-row message-status-row tool-timeline-item"
			id={`message-${message.id}`}
			role="alert"
		>
			<details class="context-details" data-preserve-attr="open">
				<summary class="context-summary">
					<StatusIcon class="tool-state-dot" state="error" />
					<span class="context-title">
						error
						<span class="context-meta" safe>
							{summary}
						</span>
					</span>
					<span class="context-chevron">
						<Icon name="chevron-right" />
					</span>
				</summary>
				{renderPreOutput(details)}
			</details>
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
			id={`message-${message.id}`}
		>
			<details class="context-details" data-preserve-attr="open">
				<summary class="context-summary">
					<StatusIcon class="tool-state-dot" state="success" />
					<span class="context-title">
						<span safe>{label}</span>
						{message.meta && (
							<span class="context-meta" safe>
								{message.meta}
							</span>
						)}
					</span>
					<span class="context-chevron">
						<Icon name="chevron-right" />
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

/** A finished render_html call shows only its page, like any other reply content. */
function renderPageMessage(message: AppMessage, pageUrl: string): string {
	return syncHtml(
		<article
			class="message message-narrative message-page"
			id={`message-${message.id}`}
		>
			<iframe
				id={`page-${message.id}`}
				class="html-page"
				src={pageUrl}
				title={message.page?.title ?? "HTML"}
				sandbox="allow-scripts allow-forms"
				allow="fullscreen"
				referrerpolicy="no-referrer"
				loading="lazy"
				data-ignore-morph
			></iframe>
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

function renderNestedToolCalls(message: AppMessage) {
	const nested = message.nestedCalls;
	if (!nested?.calls.length) return "";
	return (
		<div class="nested-tool-calls" aria-label="Nested tool calls">
			{nested.calls.map((call) =>
				renderToolMessage({
					id: `${message.id}-${call.id}`,
					role: "tool",
					timestamp: message.timestamp,
					title: call.name,
					titleParts: toolTitleParts(call.name, call.arguments ?? {}),
					state:
						call.status === "ok"
							? "success"
							: call.status === "unfinished" && message.state === "running"
								? "running"
								: "error",
					text:
						call.error ??
						(call.argumentsBytes !== undefined
							? `arguments omitted: ${call.argumentsBytes} bytes`
							: ""),
					format: "output",
					meta:
						call.status === "unfinished" && message.state !== "running"
							? "unfinished"
							: call.durationMs !== undefined
								? formatDuration(call.durationMs)
								: undefined,
				}),
			)}
			{!nested.complete && (
				<p class="fine-print">Nested call record is incomplete.</p>
			)}
		</div>
	);
}

// Compact rows show one line, not a clipped copy of the full syntax tree.
function compactToolTitlePart(part: TranscriptMessageTitlePart) {
	const source = part.highlight ? part.text.trim() : part.text;
	const firstLine = source.split(/[\r\n\u2028\u2029]/, 1)[0] ?? "";
	const preview = firstLine.match(/^[\s\S]{0,256}/u)?.[0] ?? "";
	const truncated = preview !== source;
	return {
		part: { ...part, text: preview + (truncated ? "…" : "") },
		truncated,
	};
}

function renderToolMessage(
	message: AppMessage,
	compactTools = false,
	options: MessageRenderOptions = {},
): string {
	const status = toolMessageStatus(message);
	const showCompact = compactTools && !message.toolExpanded;
	const canCollapse = compactTools && Boolean(message.toolExpanded);
	const compactedParts = showCompact
		? message.titleParts?.map(compactToolTitlePart)
		: undefined;
	const parts = compactedParts
		? compactedParts.map((entry) => entry.part)
		: message.titleParts;
	const fallbackTitle = message.title ?? "Tool";
	const compactedFallback = showCompact
		? compactToolTitlePart({ text: fallbackTitle })
		: undefined;
	const titleTruncated = compactedParts
		? compactedParts.some((entry) => entry.truncated)
		: Boolean(compactedFallback?.truncated);
	const code = showCompact
		? undefined
		: parts?.find((part) => part.highlight === "javascript");
	const snippets = code ? codeSnippets(message.nestedCalls, code.text.length) : [];
	const title = renderToolTitle(
		compactedFallback ? compactedFallback.part.text : fallbackTitle,
		parts,
		snippets,
	);
	const meta = (
		<span class="tool-meta" aria-hidden={message.meta ? undefined : "true"} safe>
			{message.meta ?? ""}
		</span>
	);
	const isExpandable =
		showCompact &&
		(Boolean(message.text.trim()) ||
			Boolean(message.nestedCalls?.calls.length) ||
			Boolean(message.attachments?.some((attachment) => attachment.image)) ||
			titleTruncated);
	const stepPrefix =
		showCompact &&
		options.minimalMode &&
		!message.minimalExpanded &&
		message.activityStep ? (
			<span class="minimal-step-prefix">step {message.activityStep} · </span>
		) : (
			""
		);
	return syncHtml(
		<article
			class={[
				"message message-tool tool-timeline-item",
				message.minimalExpanded && "minimal-turn-expanded",
			]}
			id={`message-${message.id}`}
		>
			<StatusIcon
				class="tool-state-dot"
				state={status.state}
				label={status.label}
			/>
			{showCompact ? (
				isExpandable ? (
					<button
						type="button"
						class="tool-title-compact tool-compact-toggle"
						aria-expanded="false"
						data-on:click={toggleMessageExpandAction(message.id)}
					>
						<span class="tool-title-compact-content">
							{stepPrefix}
							{title}
						</span>
						{message.compactMeta && (
							<span class="tool-compact-meta" safe>
								{message.compactMeta}
							</span>
						)}
						{meta}
						<span class="context-chevron">
							<Icon name="chevron-right" />
						</span>
					</button>
				) : (
					<p class="tool-title-compact">
						<span class="tool-title-compact-content">
							{stepPrefix}
							{title}
						</span>
						{meta}
					</p>
				)
			) : (
				<>
					<header class="tool-header">
						<span class="tool-title">{title}</span>
						{meta}
						{canCollapse && (
							<button
								type="button"
								class="tool-collapse-button"
								aria-expanded="true"
								aria-label="Collapse tool output"
								data-on:click={toggleMessageExpandAction(message.id)}
							>
								<span class="context-chevron">
									<Icon name="chevron-right" />
								</span>
							</button>
						)}
					</header>
					<div>
						{renderNestedToolCalls(message)}
						{renderImageAttachments(
							message.attachments,
							"tool-image-attachments",
						)}
						{renderToolOutput(message)}
					</div>
				</>
			)}
		</article>,
	);
}
