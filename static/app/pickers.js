import { promptInput } from "./prompt.js";

let activeFilePrefix;
let filePickerSuppressUntilInput = false;
let searchTimer;
let slashCommandFilter;

export function extractFilePrefix(value, cursor) {
	const before = value.slice(0, cursor);
	const token = /(?:^|[\s"'=])(@(?:"[^"]*|[^\s"'=]*))$/.exec(before)?.[1];
	if (!token) return undefined;
	return { start: cursor - token.length, end: cursor, query: token.slice(1) };
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

export function isOpen() {
	return isFileOpen() || isSlashOpen();
}

export function bindPickers(options) {
	slashCommandFilter = options.fuzzyFilter;
	document.addEventListener("input", syncFromPrompt);
	document.addEventListener("selectionchange", syncFromPrompt);
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
	if (
		!(event.target instanceof HTMLTextAreaElement) ||
		event.target.id !== "prompt-input"
	) {
		return;
	}
	if (event.isComposing) return;
	if (event.type === "input") filePickerSuppressUntilInput = false;
	queueFileSearch(event.target);
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
	} else if (target.closest("[data-send-trigger]") || slash instanceof HTMLElement) {
		closePickers(true);
	} else if (file instanceof HTMLElement) {
		event.preventDefault();
		applyFileCompletion(file.dataset.pickerValue ?? "");
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
	const selector = isFileOpen() ? "[data-file-row]" : "[data-slash-row]";
	if (event.code === "ArrowDown" || event.code === "ArrowUp") {
		event.preventDefault();
		selectPickerRow(selector, event.code === "ArrowDown" ? 1 : -1);
	} else if (event.code === "Enter") {
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
	return popover instanceof HTMLElement && popover.checkVisibility();
}

function visibleRows(selector) {
	return [...document.querySelectorAll(selector)].filter(
		(row) => row instanceof HTMLElement && row.checkVisibility(),
	);
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
