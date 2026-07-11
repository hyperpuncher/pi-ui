import { fileUriToPath } from "./file-uri.js";

const messagesScrollState = {
	wasPinnedToBottom: true,
};

// Convenience checks mirrored from src/server/transferred-files.ts. The server
// remains authoritative.
const MAX_TRANSFER_FILES = 10;
const MAX_TRANSFER_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TRANSFER_TOTAL_BYTES = 50 * 1024 * 1024;

window.addEventListener("DOMContentLoaded", () => {
	focusPromptEnd();
	bindPromptInteractions();
	bindSlashPicker();
	bindFilePicker();
	bindFileTransfers();
	bindMessagesAutoscroll();
	bindCodeCopy();
	bindMessagesHistoryPagination();
	bindTooltipSuppression();
	bindPickerKeyboard();
	bindVimControls();
	bindDebugFps();
	hydratePierreDiffs();
	scrollMessagesBottomSoon();
});

function bindPromptInteractions() {
	document.addEventListener("keydown", (event) => {
		if (event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		if (event.key !== "Escape") {
			return;
		}
		closeSlashPicker();
		closeFilePicker({ suppressUntilInput: true });
		if (promptValue() === "/") setPromptValue("");
	});

	document.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const slash = target.closest("[data-slash-command]");
		if (target.closest("[data-file-trigger]")) {
			event.preventDefault();
			insertFilePrefix();
		} else if (target.closest("[data-send-trigger]")) {
			closeSlashPicker();
			closeFilePicker({ suppressUntilInput: true });
		} else if (slash instanceof HTMLElement) {
			event.preventDefault();
			setPromptValue(slash.dataset.slashCommand ?? "");
			closeSlashPicker();
			focusPromptEnd();
		}
	});
}

function promptValue() {
	const input = document.getElementById("prompt-input");
	return input instanceof HTMLTextAreaElement ? input.value : "";
}

function setPromptValue(value) {
	const input = document.getElementById("prompt-input");
	if (!(input instanceof HTMLTextAreaElement)) return;
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function bindTooltipSuppression() {
	document.addEventListener("pointerdown", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const trigger = target.closest("[data-tooltip]");
		if (!(trigger instanceof HTMLElement)) return;
		trigger.setAttribute("data-tooltip-suppressed", "");
		trigger.addEventListener(
			"pointerleave",
			() => trigger.removeAttribute("data-tooltip-suppressed"),
			{ once: true },
		);
	});
}

function visibleRows(selector) {
	return [...document.querySelectorAll(selector)].filter(
		(row) => row instanceof HTMLElement && getComputedStyle(row).display !== "none",
	);
}

function focusPromptEnd() {
	const input = document.getElementById("prompt-input");
	if (input instanceof HTMLTextAreaElement) {
		input.focus({ preventScroll: true });
		input.selectionStart = input.value.length;
		input.selectionEnd = input.value.length;
	}
}

function bindSlashPicker() {
	const syncFromPrompt = (event) => {
		if (
			event.target instanceof HTMLTextAreaElement &&
			event.target.id === "prompt-input"
		) {
			updateSlashPicker(event.target.value);
		}
	};
	document.addEventListener("input", syncFromPrompt);
	document.addEventListener("keyup", syncFromPrompt);
	document.addEventListener("pointerdown", (event) => {
		const target = event.target;
		if (!(target instanceof Node)) return;
		const promptBox = document.getElementById("prompt-box");
		if (promptBox?.contains(target)) return;
		closeSlashPicker();
	});
	updateSlashPicker("");
}

function updateSlashPicker(value) {
	const popover = document.getElementById("prompt-slash-popover");
	if (!(popover instanceof HTMLElement)) return;
	const canOpen = value.startsWith("/") && !value.includes(" ");
	const query = canOpen ? value.slice(1).toLowerCase() : "";
	let visibleCount = 0;
	for (const row of document.querySelectorAll("[data-slash-row]")) {
		if (!(row instanceof HTMLElement)) continue;
		const visible =
			canOpen && (!query || (row.dataset.slashHaystack ?? "").includes(query));
		row.style.display = visible ? "" : "none";
		if (visible) visibleCount += 1;
	}
	popover.style.display = visibleCount > 0 ? "" : "none";
}

function closeSlashPicker() {
	const popover = document.getElementById("prompt-slash-popover");
	if (popover instanceof HTMLElement) {
		popover.style.display = "none";
	}
}

function isSlashPickerOpen() {
	const popover = document.getElementById("prompt-slash-popover");
	return popover instanceof HTMLElement && popover.style.display !== "none";
}

function bindFilePicker() {
	window.piUiIsFilePickerOpen = isFilePickerOpen;
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && isFilePickerOpen()) {
			event.preventDefault();
			closeFilePicker({ suppressUntilInput: true });
			focusPromptEnd();
			return;
		}

		if (document.activeElement?.closest?.("[data-file-row]")) {
			if (event.key === "Backspace") {
				event.preventDefault();
				focusPromptEnd();
				deletePromptCharBeforeCursor();
				return;
			}
			if (
				event.key.length === 1 &&
				!event.ctrlKey &&
				!event.metaKey &&
				!event.altKey
			) {
				event.preventDefault();
				focusPromptEnd();
				insertPromptText(event.key);
			}
		}
	});

	const syncFromPrompt = (event) => {
		if (
			event.target instanceof HTMLTextAreaElement &&
			event.target.id === "prompt-input"
		) {
			if (filePickerSuppressUntilInput && event.type === "keyup") {
				return;
			}
			if (event.type === "input") {
				filePickerSuppressUntilInput = false;
			}
			updateFilePicker(event.target);
		}
	};
	document.addEventListener("input", syncFromPrompt);
	document.addEventListener("keyup", syncFromPrompt);
	document.addEventListener("click", (event) => {
		if (
			event.target instanceof HTMLTextAreaElement &&
			event.target.id === "prompt-input"
		) {
			updateFilePicker(event.target);
		}
	});
	document.addEventListener("pointerdown", (event) => {
		const target = event.target;
		if (!(target instanceof Node)) return;
		const promptBox = document.getElementById("prompt-box");
		if (promptBox?.contains(target)) return;
		closeFilePicker();
	});
}

let filePickerAbort;
let activeFilePrefix;
let filePickerSuppressUntilInput = false;

function updateFilePicker(input) {
	if (filePickerSuppressUntilInput) {
		return;
	}
	const match = extractFilePrefix(
		input.value,
		input.selectionStart ?? input.value.length,
	);
	if (!match) {
		closeFilePicker();
		return;
	}
	activeFilePrefix = match;
	filePickerAbort?.abort();
	filePickerAbort = new AbortController();
	fetch(`/files/search?q=${encodeURIComponent(match.query)}`, {
		signal: filePickerAbort.signal,
	})
		.then((response) => response.json())
		.then((items) => {
			if (activeFilePrefix !== match) return;
			renderFileRows(Array.isArray(items) ? items : []);
		})
		.catch(() => undefined);
}

function extractFilePrefix(value, cursor) {
	const before = value.slice(0, cursor);
	const delimiter = Math.max(
		before.lastIndexOf(" "),
		before.lastIndexOf("\n"),
		before.lastIndexOf("\t"),
		before.lastIndexOf("="),
	);
	const start = delimiter + 1;
	const token = before.slice(start);
	if (!token.startsWith("@")) return undefined;
	if (token.includes(" ")) return undefined;
	return { start, end: cursor, query: token.slice(1) };
}

function renderFileRows(items) {
	const popover = document.getElementById("prompt-file-popover");
	const list = document.getElementById("file-picker-list");
	if (!(popover instanceof HTMLElement) || !(list instanceof HTMLElement)) return;
	list.replaceChildren();
	if (items.length === 0) {
		const row = document.createElement("li");
		row.className = "text-muted-foreground px-3 py-4 text-center text-sm";
		row.textContent = "No files found.";
		list.append(row);
	} else {
		for (const item of [...items].reverse()) {
			list.append(createFileRow(item));
		}
	}
	popover.style.display = "";
	list.scrollTop = list.scrollHeight;
}

function createFileRow(item) {
	const row = document.createElement("li");
	row.dataset.fileRow = "";
	const button = document.createElement("button");
	button.type = "button";
	button.className =
		"hover:bg-muted focus:bg-muted flex w-full items-center justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2 text-left outline-none";
	button.addEventListener("click", () => applyFileCompletion(item.value));
	const text = document.createElement("span");
	text.className = "min-w-0";
	const label = document.createElement("span");
	label.className = "block truncate font-medium";
	label.textContent = item.label ?? item.value;
	const description = document.createElement("span");
	description.className = "text-muted-foreground block truncate text-xs";
	description.textContent = item.description ?? item.value;
	text.append(label, description);
	const badge = document.createElement("span");
	badge.className = "badge";
	badge.dataset.variant = "secondary";
	badge.textContent = item.isDirectory ? "dir" : "file";
	button.append(text, badge);
	row.append(button);
	return row;
}

function applyFileCompletion(value) {
	const input = document.getElementById("prompt-input");
	if (!(input instanceof HTMLTextAreaElement) || !activeFilePrefix) return;
	const suffix = value.endsWith("/") ? "" : " ";
	input.value = `${input.value.slice(0, activeFilePrefix.start)}@${value}${suffix}${input.value.slice(activeFilePrefix.end)}`;
	const cursor = activeFilePrefix.start + value.length + 1 + suffix.length;
	input.selectionStart = cursor;
	input.selectionEnd = cursor;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	input.focus();
	if (value.endsWith("/")) {
		updateFilePicker(input);
	} else {
		closeFilePicker();
	}
}

function insertPromptText(text) {
	const input = document.getElementById("prompt-input");
	if (!(input instanceof HTMLTextAreaElement)) return;
	filePickerSuppressUntilInput = false;
	const start = input.selectionStart ?? input.value.length;
	const end = input.selectionEnd ?? start;
	input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
	const cursor = start + text.length;
	input.selectionStart = cursor;
	input.selectionEnd = cursor;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function deletePromptCharBeforeCursor() {
	const input = document.getElementById("prompt-input");
	if (!(input instanceof HTMLTextAreaElement)) return;
	filePickerSuppressUntilInput = false;
	const start = input.selectionStart ?? input.value.length;
	const end = input.selectionEnd ?? start;
	if (start !== end) {
		input.value = `${input.value.slice(0, start)}${input.value.slice(end)}`;
		input.selectionStart = start;
		input.selectionEnd = start;
	} else if (start > 0) {
		input.value = `${input.value.slice(0, start - 1)}${input.value.slice(start)}`;
		input.selectionStart = start - 1;
		input.selectionEnd = start - 1;
	}
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertFilePrefix() {
	const input = document.getElementById("prompt-input");
	if (!(input instanceof HTMLTextAreaElement)) return;
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
	updateFilePicker(input);
}

function bindFileTransfers() {
	let dragDepth = 0;
	window.piUiHasTransferredFiles = hasTransferredFiles;
	window.piUiInsertTransferredFiles = insertTransferredFiles;
	window.piUiEnterFileDrag = () => {
		dragDepth += 1;
		return true;
	};
	window.piUiLeaveFileDrag = () => {
		dragDepth = Math.max(0, dragDepth - 1);
		return dragDepth > 0;
	};
	window.piUiResetFileDrag = () => {
		dragDepth = 0;
	};
}

function hasTransferredFiles(data) {
	if (!data) return false;
	if (data.files?.length) return true;
	return [...data.types].some((type) => type === "Files" || type === "text/uri-list");
}

async function insertTransferredFiles(data) {
	if (!data) return;
	showTransferError("");
	const paths = extractTransferredFilePaths(data);
	const files = [...(data.files ?? [])];
	if (paths.length > 0) {
		insertFileReferences(paths);
		return;
	}
	if (files.length === 0) return;
	const validationError = validateTransferredFiles(files);
	if (validationError) {
		showTransferError(validationError);
		return;
	}
	const uploaded = await uploadTransferredFiles(files);
	if (uploaded.length > 0) insertFileReferences(uploaded);
}

function extractTransferredFilePaths(data) {
	const uriList = data.getData("text/uri-list");
	return uriList
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.map(fileUriToPath)
		.filter(Boolean);
}

function validateTransferredFiles(files) {
	if (files.length > MAX_TRANSFER_FILES) {
		return `Attach at most ${MAX_TRANSFER_FILES} files at a time.`;
	}
	if (files.some((file) => file.size > MAX_TRANSFER_FILE_BYTES)) {
		return "Each transferred file must be 20 MiB or smaller.";
	}
	const totalBytes = files.reduce((total, file) => total + file.size, 0);
	if (totalBytes > MAX_TRANSFER_TOTAL_BYTES) {
		return "Transferred files must total 50 MiB or less.";
	}
}

async function uploadTransferredFiles(files) {
	const formData = new FormData();
	for (const file of files) {
		formData.append("file", file, file.name || "pasted-file");
	}
	try {
		const response = await fetch("/files/import", { method: "POST", body: formData });
		const result = await response.json().catch(() => ({}));
		if (!response.ok) {
			showTransferError(
				typeof result.message === "string"
					? result.message
					: "Could not transfer the selected files.",
			);
			return [];
		}
		showTransferError("");
		return Array.isArray(result.paths) ? result.paths : [];
	} catch {
		showTransferError("Could not transfer the selected files.");
		return [];
	}
}

function showTransferError(message) {
	const input = document.getElementById("prompt-input");
	if (!(input instanceof HTMLTextAreaElement)) return;
	let error = document.getElementById("file-transfer-error");
	if (!(error instanceof HTMLParagraphElement)) {
		error = document.createElement("p");
		error.id = "file-transfer-error";
		error.className = "text-destructive mb-1 px-1 text-xs";
		error.setAttribute("role", "alert");
		error.setAttribute("aria-live", "polite");
		input.before(error);
	}
	error.textContent = message;
	error.hidden = !message;
}

function insertFileReferences(paths) {
	const input = document.getElementById("prompt-input");
	if (!(input instanceof HTMLTextAreaElement)) return;
	const start = input.selectionStart ?? input.value.length;
	const end = input.selectionEnd ?? start;
	const prefix = start > 0 && !/\s/.test(input.value[start - 1] ?? "") ? " " : "";
	const suffix =
		end < input.value.length && !/\s/.test(input.value[end] ?? "") ? " " : "";
	const text = `${prefix}${paths.map((path) => `@${path}`).join(" ")}${suffix}`;
	input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
	const cursor = start + text.length;
	input.selectionStart = cursor;
	input.selectionEnd = cursor;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	input.focus();
	closeSlashPicker();
	closeFilePicker({ suppressUntilInput: true });
}

function closeFilePicker(options = {}) {
	const popover = document.getElementById("prompt-file-popover");
	if (popover instanceof HTMLElement) {
		popover.style.display = "none";
	}
	if (options.suppressUntilInput) {
		filePickerSuppressUntilInput = true;
	}
	activeFilePrefix = undefined;
	filePickerAbort?.abort();
}

function isFilePickerOpen() {
	const popover = document.getElementById("prompt-file-popover");
	return popover instanceof HTMLElement && popover.style.display !== "none";
}

function runBestFileRow() {
	const rows = visibleRows("[data-file-row]");
	rows.at(-1)?.querySelector("button")?.click();
}

function focusFileRow(direction) {
	const rows = visibleRows("[data-file-row]");
	if (rows.length === 0) {
		return;
	}

	const activeRow = document.activeElement?.closest?.("[data-file-row]");
	const activeIndex = rows.findIndex((row) => row === activeRow);
	const nextIndex =
		activeIndex === -1
			? rows.length - 1
			: (activeIndex + direction + rows.length) % rows.length;
	focusRow(rows[nextIndex]);
}

function bindDebugFps() {
	const fps = document.getElementById("debug-fps");
	if (!(fps instanceof HTMLElement)) return;
	let frames = 0;
	let startedAt = performance.now();
	const tick = (now) => {
		frames += 1;
		const elapsed = now - startedAt;
		if (elapsed >= 500) {
			fps.textContent = String(Math.round((frames * 1000) / elapsed));
			frames = 0;
			startedAt = now;
		}
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

function bindVimControls() {
	let pendingG = false;
	document.addEventListener("keydown", (event) => {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (isTextInputFocused()) return;
		if (document.querySelector("dialog[open]")) return;

		const key = event.key;
		if (pendingG) {
			pendingG = false;
			if (key === "g") {
				event.preventDefault();
				scrollMessagesTo("top");
				return;
			}
			if (key === "i") {
				event.preventDefault();
				focusPromptEnd();
				return;
			}
		}

		if (key === "g") {
			event.preventDefault();
			pendingG = true;
			return;
		}
		if (key === "G") {
			event.preventDefault();
			scrollMessagesTo("bottom");
			return;
		}
		if (key === "j" || key === "k") {
			event.preventDefault();
			scrollMessagesBy(key === "j" ? 100 : -100, event.repeat);
		}
	});
	document.addEventListener("keyup", (event) => {
		if (event.key === "j" || event.key === "k") {
			stopVimiumLineScroll();
		}
	});
}

function isTextInputFocused() {
	const active = document.activeElement;
	return (
		active instanceof HTMLInputElement ||
		active instanceof HTMLTextAreaElement ||
		active instanceof HTMLSelectElement ||
		active?.isContentEditable === true
	);
}

const vimScrollStepPx = 100;
const vimScrollStepDurationMs = 120;
const vimScrollFrameMs = 1000 / 144;
let vimScrollAnimation;
let vimScrollTarget;
let vimScrollTargetPosition;
let vimScrollLastFrame = 0;
let vimScrollDirection = 0;
let vimScrollKeyHeld = false;
let vimScrollDelta = 0;
let vimScrollRemainder = 0;

function scrollMessagesBy(delta, _repeated) {
	if (vimScrollAnimation && vimScrollTarget !== undefined) {
		cancelAnimationFrame(vimScrollAnimation);
		vimScrollAnimation = undefined;
		vimScrollTarget = undefined;
		vimScrollTargetPosition = undefined;
	}
	const direction = Math.sign(delta);
	if (!vimScrollAnimation || vimScrollDirection !== direction) {
		vimScrollDirection = direction;
		vimScrollDelta = 0;
		vimScrollRemainder = 0;
		vimScrollLastFrame = performance.now();
	}
	vimScrollKeyHeld = true;
	startVimiumLineScroll();
	messagesScrollState.wasPinnedToBottom = false;
}

function scrollMessagesTo(position) {
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return;
	vimScrollDirection = 0;
	vimScrollKeyHeld = false;
	const max = messages.scrollHeight - messages.clientHeight;
	vimScrollTargetPosition = position;
	vimScrollTarget = position === "top" ? 0 : max;
	startVimiumTargetScroll();
	messagesScrollState.wasPinnedToBottom = position === "bottom";
}

function stopVimiumLineScroll() {
	vimScrollKeyHeld = false;
}

function startVimiumLineScroll() {
	if (vimScrollAnimation) return;
	const tick = (now) => {
		const messages = document.getElementById("messages");
		if (!(messages instanceof HTMLElement) || !vimScrollDirection) {
			vimScrollAnimation = undefined;
			return;
		}
		const elapsed = Math.min(Math.max(now - vimScrollLastFrame, 0), vimScrollFrameMs);
		vimScrollLastFrame = now;
		const max = messages.scrollHeight - messages.clientHeight;
		const wanted =
			vimScrollDirection * ((vimScrollStepPx * elapsed) / vimScrollStepDurationMs) +
			vimScrollRemainder;
		const before = messages.scrollTop;
		const next = Math.max(0, Math.min(before + wanted, max));
		messages.scrollTop = next;
		const actual = next - before;
		vimScrollRemainder = wanted - actual;
		vimScrollDelta += Math.abs(actual);
		if (
			next === 0 ||
			next === max ||
			(!vimScrollKeyHeld && vimScrollDelta >= vimScrollStepPx)
		) {
			vimScrollDirection = 0;
			vimScrollDelta = 0;
			vimScrollRemainder = 0;
			vimScrollAnimation = undefined;
			return;
		}
		vimScrollAnimation = requestAnimationFrame(tick);
	};
	vimScrollAnimation = requestAnimationFrame(tick);
}

function startVimiumTargetScroll() {
	if (vimScrollAnimation) {
		cancelAnimationFrame(vimScrollAnimation);
	}
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement) || vimScrollTarget === undefined) return;
	const start = messages.scrollTop;
	const target = Math.max(
		0,
		Math.min(vimScrollTarget, messages.scrollHeight - messages.clientHeight),
	);
	const amount = Math.abs(target - start);
	const duration = Math.max(
		vimScrollStepDurationMs,
		20 * Math.log(Math.max(amount, 1)),
	);
	let elapsedTotal = 0;
	vimScrollLastFrame = 0;
	const tick = (now) => {
		const currentMessages = document.getElementById("messages");
		if (!(currentMessages instanceof HTMLElement) || vimScrollTarget === undefined) {
			vimScrollAnimation = undefined;
			return;
		}
		const elapsed = vimScrollLastFrame ? now - vimScrollLastFrame : 16.7;
		vimScrollLastFrame = now;
		elapsedTotal += elapsed;
		const progress = Math.min(1, elapsedTotal / duration);
		const currentMax = currentMessages.scrollHeight - currentMessages.clientHeight;
		const currentTarget = vimScrollTargetPosition === "bottom" ? currentMax : target;
		currentMessages.scrollTop = start + (currentTarget - start) * progress;
		if (progress >= 1) {
			if (vimScrollTargetPosition === "bottom") {
				scrollMessagesBottomSoon();
			}
			vimScrollTarget = undefined;
			vimScrollTargetPosition = undefined;
			vimScrollAnimation = undefined;
			return;
		}
		vimScrollAnimation = requestAnimationFrame(tick);
	};
	vimScrollAnimation = requestAnimationFrame(tick);
}

function hydratePierreDiffs() {
	for (const host of document.querySelectorAll("[data-pierre-diff]")) {
		if (!(host instanceof HTMLElement) || host.shadowRoot) continue;
		const template = host.querySelector('template[shadowrootmode="open"]');
		if (!(template instanceof HTMLTemplateElement)) continue;
		host.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
		template.remove();
	}
}

function bindMessagesAutoscroll() {
	document.addEventListener(
		"scroll",
		() => {
			const messages = document.getElementById("messages");
			if (!messages) {
				return;
			}
			const distanceFromBottom =
				messages.scrollHeight - messages.scrollTop - messages.clientHeight;
			messagesScrollState.wasPinnedToBottom = distanceFromBottom < 120;
		},
		true,
	);

	let autoscrollFrame;
	const observer = new MutationObserver(() => {
		hydratePierreDiffs();
		if (autoscrollFrame) return;
		autoscrollFrame = requestAnimationFrame(() => {
			autoscrollFrame = undefined;
			const messages = document.getElementById("messages");
			if (!messages || !messagesScrollState.wasPinnedToBottom) {
				return;
			}
			messages.scrollTop = messages.scrollHeight;
		});
	});

	const messages = document.getElementById("messages");
	if (messages) {
		observer.observe(messages, { childList: true, subtree: true });
	}
}

let messagesAnchor;
let messagesHistoryLoading = false;

function bindMessagesHistoryPagination() {
	window.piUiCaptureMessagesAnchor = captureMessagesAnchor;
	window.piUiRestoreMessagesAnchor = restoreMessagesAnchor;
	window.piUiScrollMessagesBottom = scrollMessagesBottomSoon;
}

function captureMessagesAnchor() {
	if (messagesHistoryLoading) return false;
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return false;
	messagesHistoryLoading = true;
	messagesScrollState.wasPinnedToBottom = false;
	messagesAnchor = {
		scrollHeight: messages.scrollHeight,
		scrollTop: messages.scrollTop,
	};
	return true;
}

function restoreMessagesAnchor() {
	const anchor = messagesAnchor;
	messagesAnchor = undefined;
	messagesHistoryLoading = false;
	if (!anchor) return;
	requestAnimationFrame(() => {
		const messages = document.getElementById("messages");
		if (!(messages instanceof HTMLElement)) return;
		messages.scrollTop =
			anchor.scrollTop + messages.scrollHeight - anchor.scrollHeight;
	});
}

function scrollMessagesBottomSoon() {
	messagesScrollState.wasPinnedToBottom = true;
	for (const delay of [0, 16, 80, 180]) {
		setTimeout(() => {
			const messages = document.getElementById("messages");
			if (messages instanceof HTMLElement) {
				messages.scrollTop = messages.scrollHeight;
			}
		}, delay);
	}
}

function bindCodeCopy() {
	document.addEventListener("click", async (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const button = target.closest("[data-copy-code]");
		if (!(button instanceof HTMLButtonElement)) return;
		const block = button.closest("[data-code-block]");
		const source = block?.querySelector("[data-code-source]");
		const code = block?.querySelector("code");
		const text = source?.textContent
			? decodeHtmlEntities(source.textContent)
			: code?.textContent;
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			button.dataset.copyState = "copied";
			button.setAttribute("aria-label", "Copied");
			setTimeout(() => {
				delete button.dataset.copyState;
				button.setAttribute("aria-label", "Copy code");
			}, 1200);
		} catch {
			button.setAttribute("aria-label", "Copy failed");
		}
	});
}

function decodeHtmlEntities(text) {
	const textarea = document.createElement("textarea");
	textarea.innerHTML = text;
	return textarea.value;
}

function bindPickerKeyboard() {
	document.addEventListener("keydown", (event) => {
		const active = document.activeElement;
		if (active?.id === "prompt-input") {
			if (event.key === "ArrowDown" && isSlashPickerOpen()) {
				event.preventDefault();
				focusSlashRow(1);
				return;
			}
			if (
				(event.key === "ArrowDown" || event.key === "ArrowUp") &&
				isFilePickerOpen()
			) {
				event.preventDefault();
				focusFileRow(event.key === "ArrowDown" ? 1 : -1);
				return;
			}
			if (event.key === "Enter" && !event.shiftKey && isFilePickerOpen()) {
				event.preventDefault();
				runBestFileRow();
				return;
			}
		}

		if (
			(event.key === "ArrowDown" || event.key === "ArrowUp") &&
			active?.closest?.("[data-slash-row]")
		) {
			event.preventDefault();
			focusSlashRow(event.key === "ArrowDown" ? 1 : -1);
			return;
		}
		if (event.key === "Enter" && active?.closest?.("[data-slash-row]")) {
			event.preventDefault();
			active.click();
			return;
		}

		if (
			(event.key === "ArrowDown" || event.key === "ArrowUp") &&
			active?.closest?.("[data-file-row]")
		) {
			event.preventDefault();
			focusFileRow(event.key === "ArrowDown" ? 1 : -1);
			return;
		}
		if (event.key === "Enter" && active?.closest?.("[data-file-row]")) {
			event.preventDefault();
			active.click();
			return;
		}
	});
}

function focusSlashRow(direction) {
	const rows = visibleRows("[data-slash-row]");
	if (rows.length === 0) {
		return;
	}

	const activeRow = document.activeElement?.closest?.("[data-slash-row]");
	const activeIndex = rows.findIndex((row) => row === activeRow);
	const nextIndex =
		activeIndex === -1
			? direction > 0
				? 0
				: rows.length - 1
			: (activeIndex + direction + rows.length) % rows.length;
	focusRow(rows[nextIndex]);
}

function focusRow(row) {
	const button = row?.querySelector("button");
	if (button instanceof HTMLElement) {
		button.focus();
	} else if (row instanceof HTMLElement) {
		row.focus();
	}
}
