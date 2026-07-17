import {
	deletePromptCharBeforeCursor,
	focusPromptEnd,
	insertPromptText,
	promptInput,
	promptValue,
	setPromptValue,
} from "./prompt.js";

let activeFilePrefix;
let filePickerSuppressUntilInput = false;
let filePickerObserver;
let filePickerResetFrame;
let searchTimer;
let slashPickerResetFrame;

export function extractFilePrefix(value, cursor) {
	const before = value.slice(0, cursor);
	const delimiter = Math.max(
		before.lastIndexOf(" "),
		before.lastIndexOf("\n"),
		before.lastIndexOf("\t"),
		before.lastIndexOf("="),
	);
	const start = delimiter + 1;
	const token = before.slice(start);
	if (!token.startsWith("@") || token.includes(" ")) return undefined;
	return { start, end: cursor, query: token.slice(1) };
}

export function completeFileValue(inputValue, match, value) {
	const suffix = value.endsWith("/") ? "" : " ";
	const text = `${inputValue.slice(0, match.start)}@${value}${suffix}${inputValue.slice(match.end)}`;
	return { text, cursor: match.start + value.length + 1 + suffix.length };
}

export function isFileOpen() {
	return isPopoverVisible("prompt-file-popover");
}

export function isOpen() {
	return isFileOpen() || isSlashOpen();
}

export function bindPickers() {
	document.addEventListener("input", syncFromPrompt);
	document.addEventListener("keyup", syncFromPrompt);
	document.addEventListener("click", handleClick);
	document.addEventListener("pointerdown", handleOutsidePointer);
	document.addEventListener("keydown", handleKeydown);
	filePickerObserver?.disconnect();
	const popover = document.getElementById("prompt-file-popover");
	if (popover) {
		filePickerObserver = new MutationObserver(queueFilePickerReset);
		filePickerObserver.observe(popover, {
			childList: true,
			characterData: true,
			subtree: true,
		});
	}
}

function syncFromPrompt(event) {
	if (
		!(event.target instanceof HTMLTextAreaElement) ||
		event.target.id !== "prompt-input"
	) {
		return;
	}
	if (filePickerSuppressUntilInput && event.type === "keyup") return;
	if (event.type === "input") filePickerSuppressUntilInput = false;
	queueFileSearch(event.target);
	queueSlashPickerSelectionReset();
}

function queueFileSearch(input) {
	if (filePickerSuppressUntilInput) return;
	const match = extractFilePrefix(
		input.value,
		input.selectionStart ?? input.value.length,
	);
	if (!match) {
		closeFilePicker();
		return;
	}
	activeFilePrefix = match;
	queueFilePickerReset();
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => {
		if (activeFilePrefix !== match) return;
		input.dispatchEvent(
			new CustomEvent("pi-ui-file-query", {
				bubbles: true,
				detail: { query: match.query },
			}),
		);
	}, 50);
}

function handleClick(event) {
	const target = event.target;
	if (!(target instanceof Element)) return;
	const slash = target.closest('[data-picker-kind="slash"]');
	const file = target.closest('[data-picker-kind="file"]');
	if (target.closest("[data-file-trigger]")) {
		event.preventDefault();
		insertFilePrefix();
	} else if (target.closest("[data-send-trigger]")) {
		closePickers(true);
	} else if (slash instanceof HTMLElement) {
		event.preventDefault();
		setPromptValue(slash.dataset.pickerValue ?? "");
		focusPromptEnd();
	} else if (file instanceof HTMLElement) {
		event.preventDefault();
		applyFileCompletion(file.dataset.pickerValue ?? "");
	} else if (target instanceof HTMLTextAreaElement && target.id === "prompt-input") {
		queueFileSearch(target);
	}
}

function handleOutsidePointer(event) {
	const target = event.target;
	if (!(target instanceof Node)) return;
	if (document.getElementById("prompt-box")?.contains(target)) return;
	closePickers(false);
}

function handleKeydown(event) {
	if (event.ctrlKey || event.metaKey || event.altKey) return;
	if (event.key === "Escape") {
		if (isOpen()) event.preventDefault();
		closePickers(true);
		if (promptValue() === "/") setPromptValue("");
		return;
	}
	if (document.activeElement?.closest?.("[data-file-row]")) {
		if (event.key === "Backspace") {
			event.preventDefault();
			focusPromptEnd();
			deletePromptCharBeforeCursor();
			return;
		}
		if (event.key.length === 1) {
			event.preventDefault();
			focusPromptEnd();
			insertPromptText(event.key);
			return;
		}
	}
	const active = document.activeElement;
	if (active?.id === "prompt-input") {
		if ((event.key === "ArrowDown" || event.key === "ArrowUp") && isSlashOpen()) {
			event.preventDefault();
			focusPickerRow("[data-slash-row]", event.key === "ArrowDown" ? 1 : -1);
			return;
		}
		if ((event.key === "ArrowDown" || event.key === "ArrowUp") && isFileOpen()) {
			event.preventDefault();
			focusPickerRow("[data-file-row]", event.key === "ArrowDown" ? 1 : -1);
			return;
		}
		if (event.key === "Enter" && !event.shiftKey && isFileOpen()) {
			event.preventDefault();
			selectedPickerRow("[data-file-row]")?.querySelector("button")?.click();
			return;
		}
		if (event.key === "Enter" && !event.shiftKey && isSlashOpen()) {
			event.preventDefault();
			selectedPickerRow("[data-slash-row]")?.querySelector("button")?.click();
			return;
		}
	}
	for (const selector of ["[data-slash-row]", "[data-file-row]"]) {
		if (!active?.closest?.(selector)) continue;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			focusPickerRow(selector, event.key === "ArrowDown" ? 1 : -1);
		} else if (event.key === "Enter") {
			event.preventDefault();
			active.click();
		}
		return;
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
	if (value.endsWith("/")) queueFileSearch(input);
	else closeFilePicker();
}

function insertFilePrefix() {
	const input = promptInput();
	if (!input) return;
	filePickerSuppressUntilInput = false;
	const cursor = input.selectionStart ?? input.value.length;
	const needsSpace = cursor > 0 && !/\s/.test(input.value[cursor - 1] ?? "");
	const insert = `${needsSpace ? " " : ""}@`;
	input.value = `${input.value.slice(0, cursor)}${insert}${input.value.slice(input.selectionEnd ?? cursor)}`;
	const nextCursor = cursor + insert.length;
	input.selectionStart = nextCursor;
	input.selectionEnd = nextCursor;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	input.focus();
	queueFileSearch(input);
}

export function closePickers(suppressUntilInput = false) {
	closeFilePicker(suppressUntilInput);
	promptInput()?.dispatchEvent(
		new CustomEvent("pi-ui-picker-close", { bubbles: true }),
	);
}

function closeFilePicker(suppressUntilInput = false) {
	clearTimeout(searchTimer);
	if (suppressUntilInput) filePickerSuppressUntilInput = true;
	activeFilePrefix = undefined;
	promptInput()?.dispatchEvent(new CustomEvent("pi-ui-file-close", { bubbles: true }));
}

function isSlashOpen() {
	return isPopoverVisible("prompt-slash-popover");
}

function isPopoverVisible(id) {
	const popover = document.getElementById(id);
	return popover instanceof HTMLElement && popover.style.display !== "none";
}

function visibleRows(selector) {
	return [...document.querySelectorAll(selector)].filter(
		(row) => row instanceof HTMLElement && getComputedStyle(row).display !== "none",
	);
}

function selectedPickerRow(selector) {
	const rows = visibleRows(selector);
	return rows.find((row) => row.getAttribute("aria-selected") === "true") ?? rows[0];
}

function selectDefaultPickerRow(selector) {
	const rows = visibleRows(selector);
	for (const [index, row] of rows.entries()) {
		row.setAttribute("aria-selected", index === 0 ? "true" : "false");
	}
}

function resetPicker(listId, rowSelector) {
	const list = document.getElementById(listId);
	if (list instanceof HTMLElement) list.scrollTop = 0;
	selectDefaultPickerRow(rowSelector);
}

function queueSlashPickerSelectionReset() {
	if (!promptValue().startsWith("/")) return;
	cancelAnimationFrame(slashPickerResetFrame);
	slashPickerResetFrame = requestAnimationFrame(() => {
		resetPicker("slash-picker-list", "[data-slash-row]");
	});
}

function queueFilePickerReset() {
	cancelAnimationFrame(filePickerResetFrame);
	filePickerResetFrame = requestAnimationFrame(() => {
		resetPicker("file-picker-list", "[data-file-row]");
	});
}

export function nextPickerIndex(length, activeIndex, direction) {
	if (length <= 0) return -1;
	if (activeIndex === -1) return 0;
	return Math.max(0, Math.min(length - 1, activeIndex - direction));
}

function focusPickerRow(selector, direction) {
	const rows = visibleRows(selector);
	if (rows.length === 0) return;
	const activeRow = document.activeElement?.closest?.(selector);
	let activeIndex = rows.findIndex((row) => row === activeRow);
	if (activeIndex === -1) {
		activeIndex = rows.findIndex(
			(row) => row.getAttribute("aria-selected") === "true",
		);
	}
	const nextIndex = nextPickerIndex(rows.length, activeIndex, direction);
	for (const row of rows) row.setAttribute("aria-selected", "false");
	rows[nextIndex]?.setAttribute("aria-selected", "true");
	rows[nextIndex]?.querySelector("button")?.focus();
}
