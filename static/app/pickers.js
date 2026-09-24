import { endpoints } from "../../src/server/routes/endpoints.ts";
import { focusPromptEnd, promptInput, setPromptValue } from "./prompt.js";

let activeFilePrefix;
let filePickerSuppressUntilInput = false;
let activeArgumentQuery;
let slashCommandFilter;

export function extractFilePrefix(value, cursor) {
	const before = value.slice(0, cursor);
	const token = /(?:^|[\s"'=])(@(?:"[^"]*|[^\s"'=]*))$/.exec(before)?.[1];
	if (!token) return undefined;
	return { start: cursor - token.length, end: cursor, query: token.slice(1) };
}

// "/name rest of the line" up to the caret, single line only (a slash command's name is
// always the prompt's first token). Mirrors extractFilePrefix's shape/contract.
export function extractArgumentQuery(value, cursor) {
	const before = value.slice(0, cursor);
	const match = /^\/(\S+)[ \t]([^\n]*)$/.exec(before);
	if (!match) return undefined;
	return { command: match[1].toLowerCase(), prefix: match[2] };
}

export function completeFileValue(inputValue, match, value) {
	const isDirectory = value.endsWith("/") || value.endsWith('/"');
	const suffix = isDirectory ? "" : " ";
	const after = inputValue.slice(match.end);
	const remaining =
		match.query.startsWith('"') && value.endsWith('"') && after.startsWith('"')
			? after.slice(1)
			: after;
	const text = `${inputValue.slice(0, match.start)}${value}${suffix}${remaining}`;
	const quoteOffset = isDirectory && value.endsWith('"') ? 1 : 0;
	return { text, cursor: match.start + value.length + suffix.length - quoteOffset };
}

export function isFileOpen() {
	return isPopoverVisible("prompt-file-popover");
}

export function isArgumentOpen() {
	return isPopoverVisible("prompt-argument-popover");
}

export function isOpen() {
	return isFileOpen() || isSlashOpen() || isArgumentOpen();
}

export function bindPickers(options) {
	slashCommandFilter = options.fuzzyFilter;
	document.addEventListener("input", syncFromPrompt);
	document.addEventListener("click", handleClick);
	document.addEventListener("keydown", handleKeydown);
	// Keep suggestion clicks from blurring the editor without blocking touch scrolling.
	document.addEventListener("mousedown", (event) => {
		if (
			event.button === 0 &&
			event.target instanceof Element &&
			event.target.closest("[data-picker-kind]")
		) {
			event.preventDefault();
		}
	});
	document.addEventListener("focusout", (event) => {
		if (event.target === promptInput()) closePickers(true);
	});
}

function syncFromPrompt(event) {
	if (event.target !== promptInput() || event.isComposing) return;
	filePickerSuppressUntilInput = false;
	queueFileSearch(event.target);
	queueArgumentSearch(event.target);
}

function queueFileSearch(input) {
	if (filePickerSuppressUntilInput || document.activeElement !== input) return;
	const match = extractFilePrefix(input.value, input.selectionStart);
	if (!match) {
		closeFilePicker();
		return;
	}
	if (
		activeFilePrefix?.start === match.start &&
		activeFilePrefix.end === match.end &&
		activeFilePrefix.query === match.query
	)
		return;
	activeFilePrefix = match;
	input.dispatchEvent(
		new CustomEvent("pi-ui-file-query", {
			bubbles: true,
			detail: { query: match.query },
		}),
	);
}

// Argument completions apply to whatever the extension/built-in returned for the whole
// remaining argument text (not a sub-token), so the picker only re-queries when the
// command name or the trailing argument text actually changed.
function queueArgumentSearch(input) {
	if (document.activeElement !== input) return;
	// A "@file" mention inside the argument text takes the file picker instead.
	if (extractFilePrefix(input.value, input.selectionStart)) {
		closeArgumentPicker();
		return;
	}
	const match = extractArgumentQuery(input.value, input.selectionStart);
	if (!match) {
		closeArgumentPicker();
		return;
	}
	if (
		activeArgumentQuery?.command === match.command &&
		activeArgumentQuery.prefix === match.prefix
	)
		return;
	activeArgumentQuery = match;
	input.dispatchEvent(
		new CustomEvent("pi-ui-argument-query", { bubbles: true, detail: match }),
	);
}

function closeArgumentPicker() {
	if (!activeArgumentQuery) return;
	activeArgumentQuery = undefined;
	promptInput()?.dispatchEvent(
		new CustomEvent("pi-ui-argument-close", { bubbles: true }),
	);
}

function applyArgumentCompletion(value) {
	const input = promptInput();
	if (!input || !activeArgumentQuery) return;
	const cursor = input.selectionStart;
	const match = /^(\/\S+[ \t])([^\n]*)$/.exec(input.value.slice(0, cursor));
	if (!match) return;
	const before = input.value.slice(0, match[1].length) + value;
	const command = activeArgumentQuery.command;
	closeArgumentPicker();
	// Record the chosen value as the current query so the input event below does not
	// immediately re-query and reopen the picker for it — an open picker swallows Enter,
	// which would leave the completed command impossible to submit from the keyboard.
	activeArgumentQuery = { command, prefix: value };
	input.value = before + input.value.slice(cursor);
	input.selectionStart = before.length;
	input.selectionEnd = before.length;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	input.focus();
}

function handleClick(event) {
	const target = event.target;
	if (!(target instanceof Element)) return;
	const slash = target.closest('[data-picker-kind="slash"]');
	const file = target.closest('[data-picker-kind="file"]');
	const argument = target.closest('[data-picker-kind="argument"]');
	if (target.closest("[data-file-trigger]")) {
		event.preventDefault();
		insertFilePrefix();
	} else if (target.closest("[data-send-trigger]") || slash instanceof HTMLElement) {
		closePickers(true);
	} else if (file instanceof HTMLElement) {
		event.preventDefault();
		applyFileCompletion(file.dataset.pickerValue ?? "");
	} else if (argument instanceof HTMLElement) {
		event.preventDefault();
		applyArgumentCompletion(argument.dataset.pickerValue ?? "");
	}
}

function handleKeydown(event) {
	if (
		event.target !== promptInput() ||
		event.isComposing ||
		event.ctrlKey ||
		event.metaKey ||
		event.altKey ||
		event.shiftKey ||
		!isOpen()
	)
		return;
	if (event.code === "Escape") {
		event.preventDefault();
		closePickers(true);
		return;
	}
	const selector = isFileOpen()
		? "[data-file-row]"
		: isArgumentOpen()
			? "[data-argument-row]"
			: "[data-slash-row]";
	if (event.code === "ArrowDown" || event.code === "ArrowUp") {
		event.preventDefault();
		selectPickerRow(selector, event.code === "ArrowDown" ? 1 : -1);
	} else if (event.code === "Enter" || event.code === "Tab") {
		event.preventDefault();
		selectedPickerRow(selector)?.click();
	}
}

function applyFileCompletion(value) {
	const input = promptInput();
	if (!input || !activeFilePrefix) return;
	const completion = completeFileValue(input.value, activeFilePrefix, value);
	input.value = completion.text;
	input.selectionStart = completion.cursor;
	input.selectionEnd = completion.cursor;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	input.focus();
	if (value.endsWith("/") || value.endsWith('/"')) queueFileSearch(input);
	else closeFilePicker();
}

export function completeSlashCommand(name) {
	setPromptValue(`/${name} `);
	focusPromptEnd();
	closePickers();
}

// Native `/copy` handling: the SDK's built-in copies the last assistant message to the
// clipboard, a browser-only capability the backend can't perform for itself — so this
// (and its callers in prompt-box.tsx / pickers.tsx) intercept "/copy" entirely client-side
// and never send it to the server. `RuntimeController.prompt()` still no-ops "/copy" too,
// as a defensive fallback for any caller that posts it anyway.
//
// The return value means "handled client-side": `false` only when there is no assistant
// reply to copy, so the caller falls through to the server for a "Nothing to copy yet."
// notice. `navigator.clipboard` doesn't exist over plain HTTP on a LAN and in some embedded
// webviews (O3), and `writeText` itself can reject (permission denied, no focused
// document), so a synchronous hidden-textarea `execCommand("copy")` is the fallback. If
// that fails too — synchronously or after `writeText`'s promise rejects — the failure is
// reported to the server as `/copy unavailable`, which shows a visible notice, instead of
// silently reporting success with nothing copied.
export function copyLastAssistantMessage() {
	const clipboard = navigator.clipboard;
	const nodes = document.querySelectorAll(".message-assistant .markdown-content");
	const text = nodes[nodes.length - 1]?.textContent?.trim();
	if (!text) return false;
	if (clipboard?.writeText) {
		clipboard.writeText(text).catch(() => {
			if (!copyWithFallback(text)) reportCopyUnavailable();
		});
		return true;
	}
	if (!copyWithFallback(text)) reportCopyUnavailable();
	return true;
}

function reportCopyUnavailable() {
	fetch(endpoints.prompt, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ prompt: "/copy unavailable" }),
	}).catch(() => {});
}

function copyWithFallback(text) {
	try {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.setAttribute("readonly", "");
		textarea.style.position = "fixed";
		textarea.style.top = "0";
		textarea.style.left = "0";
		textarea.style.opacity = "0";
		textarea.style.pointerEvents = "none";
		document.body.append(textarea);
		textarea.focus();
		textarea.select();
		textarea.setSelectionRange(0, text.length);
		const copied = document.execCommand?.("copy") ?? false;
		textarea.remove();
		return copied;
	} catch {
		return false;
	}
}

function insertFilePrefix() {
	const input = promptInput();
	if (!input) return;
	filePickerSuppressUntilInput = false;
	const cursor = input.selectionStart;
	const needsSpace = cursor > 0 && !/\s/.test(input.value[cursor - 1] ?? "");
	const insert = `${needsSpace ? " " : ""}@`;
	input.setRangeText(insert, cursor, input.selectionEnd, "end");
	input.dispatchEvent(new Event("input", { bubbles: true }));
	input.focus();
	queueFileSearch(input);
}

export function closePickers(suppressUntilInput = false) {
	closeFilePicker(suppressUntilInput);
	closeArgumentPicker();
	promptInput()?.dispatchEvent(
		new CustomEvent("pi-ui-picker-close", { bubbles: true }),
	);
}

function closeFilePicker(suppressUntilInput = false) {
	if (suppressUntilInput) filePickerSuppressUntilInput = true;
	activeFilePrefix = undefined;
	const input = promptInput();
	input?.dispatchEvent(new CustomEvent("pi-ui-file-query", { bubbles: true }));
	input?.dispatchEvent(new CustomEvent("pi-ui-file-close", { bubbles: true }));
}

function isSlashOpen() {
	return isPopoverVisible("prompt-slash-popover");
}

function isPopoverVisible(id) {
	const popover = document.getElementById(id);
	return popover instanceof HTMLElement && popover.checkVisibility();
}

function visibleRows(selector) {
	return document
		.querySelectorAll(selector)
		.values()
		.filter((row) => row instanceof HTMLElement && row.checkVisibility())
		.toArray();
}

function selectedPickerRow(selector) {
	const rows = visibleRows(selector);
	return rows.find((row) => row.getAttribute("aria-selected") === "true") ?? rows[0];
}

function rankSlashCommands(prompt) {
	if (!prompt.startsWith("/") || prompt.includes(" ")) return;
	const list = document.getElementById("slash-picker-list");
	if (!(list instanceof HTMLElement)) return;
	const rows = [...list.querySelectorAll("[data-slash-row]")].sort(
		(left, right) =>
			Number(left.dataset.slashOrder) - Number(right.dataset.slashOrder),
	);
	const ranked = slashCommandFilter(
		rows,
		prompt.slice(1),
		(row) => row.dataset.slashName ?? "",
	);
	const matches = new Set(ranked);
	list.append(...ranked, ...rows.filter((row) => !matches.has(row)));
}

export function nextPickerIndex(length, activeIndex, direction) {
	if (length <= 0) return -1;
	if (activeIndex === -1) return 0;
	return Math.max(0, Math.min(length - 1, activeIndex - direction));
}

function selectPickerRow(selector, direction) {
	const rows = visibleRows(selector);
	if (rows.length === 0) return;
	const activeIndex = rows.findIndex(
		(row) => row.getAttribute("aria-selected") === "true",
	);
	const nextIndex = nextPickerIndex(rows.length, activeIndex, direction);
	for (const row of rows) row.setAttribute("aria-selected", "false");
	rows[nextIndex]?.setAttribute("aria-selected", "true");
	rows[nextIndex]?.scrollIntoView({ block: "nearest", behavior: "instant" });
	syncPickerSelection();
}

export function syncPickerSelection(reset = false) {
	// Read after Datastar has applied visibility changes and result patches.
	queueMicrotask(() => {
		const input = promptInput();
		if (!input) return;
		const listId = isFileOpen()
			? "file-picker-list"
			: isArgumentOpen()
				? "argument-picker-list"
				: isSlashOpen()
					? "slash-picker-list"
					: undefined;
		if (reset && listId) {
			if (listId === "slash-picker-list") rankSlashCommands(input.value);
			document.getElementById(listId).scrollTop = 0;
			for (const [index, option] of visibleRows(
				`#${listId} [role="option"]`,
			).entries()) {
				option.setAttribute("aria-selected", index === 0 ? "true" : "false");
			}
		}
		const row = listId && selectedPickerRow(`#${listId} [role="option"]`);
		if (row && document.activeElement === input) {
			row.setAttribute("aria-selected", "true");
			input.setAttribute("aria-controls", listId);
			input.setAttribute("aria-activedescendant", row.id);
		} else {
			input.removeAttribute("aria-controls");
			input.removeAttribute("aria-activedescendant");
		}
	});
}
