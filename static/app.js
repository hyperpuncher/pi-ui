const messagesScrollState = {
	wasPinnedToBottom: true,
};

bindReservedShortcutPrevention();
bindAppCommands();

window.addEventListener("DOMContentLoaded", () => {
	focusPrompt();
	bindPromptAutosize();
	bindSlashPicker();
	bindFilePicker();
	bindMessagesAutoscroll();
	bindCommandRefresh();
	bindCodeCopy();
	bindTooltipSuppression();
	bindPickerKeyboard();
	bindDialogKeyboard();
});

function bindAppCommands() {
	document.addEventListener("keydown", (event) => {
		const key = event.key.toLowerCase();
		if (event.altKey && key === "t") {
			event.preventDefault();
			cycleThinkingLevel();
			return;
		}

		if (!(event.ctrlKey || event.metaKey)) {
			if (event.key === "Escape") {
				closeSlashPicker();
				closeFilePicker({ suppressUntilInput: true });
				if (promptValue() === "/") setPromptValue("");
			}
			return;
		}

		if (key === "k") {
			event.preventDefault();
			openDialog("command-dialog", "command-input");
		} else if (key === "o") {
			event.preventDefault();
			clickFirst("[data-new-chat-trigger]");
		} else if (key === "r") {
			event.preventDefault();
			openSessionDialog();
		} else if (key === "l") {
			event.preventDefault();
			openModelSelector();
		}
	});

	document.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const slash = target.closest("[data-slash-command]");
		if (target.closest("[data-dialog-trigger='command-dialog']")) {
			event.preventDefault();
			openDialog("command-dialog", "command-input");
		} else if (target.closest("[data-new-chat-trigger]")) {
			setTimeout(focusPrompt, 0);
		} else if (target.closest("[data-file-trigger]")) {
			event.preventDefault();
			insertFilePrefix();
		} else if (target.closest("[data-send-trigger]")) {
			closeSlashPicker();
			closeFilePicker({ suppressUntilInput: true });
		} else if (target.closest("[data-workspace-submit]")) {
			rememberSubmittedWorkspace();
		} else if (target.closest("[data-workspace-trigger]")) {
			event.preventDefault();
			openWorkspaceDialog();
		} else if (slash instanceof HTMLElement) {
			event.preventDefault();
			setPromptValue(slash.dataset.slashCommand ?? "");
			closeSlashPicker();
			focusPromptEnd();
		}
	});
}

function openDialog(id, focusId) {
	const dialog = document.getElementById(id);
	if (dialog instanceof HTMLDialogElement && !dialog.open) {
		dialog.showModal();
	}
	if (focusId) {
		setTimeout(() => document.getElementById(focusId)?.focus(), 0);
	}
}

function closeDialog(id) {
	const dialog = document.getElementById(id);
	if (dialog instanceof HTMLDialogElement && dialog.open) {
		dialog.close();
	}
}

function openSessionDialog() {
	closeDialog("command-dialog");
	clickFirst("[data-session-trigger]");
}

function clickFirst(selector) {
	document.querySelector(selector)?.click();
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

function openWorkspaceDialog() {
	const current = document.body?.dataset.workspacePath ?? "";
	if (current) {
		rememberWorkspace(current);
	}
	openDialog("workspace-dialog", "workspace-input");
	renderRecentWorkspaces();
	setTimeout(() => {
		const input = document.getElementById("workspace-input");
		if (input instanceof HTMLInputElement) {
			input.value = current;
			input.focus();
			input.select();
		}
	}, 0);
}

function rememberSubmittedWorkspace() {
	const input = document.getElementById("workspace-input");
	const workspacePath = input instanceof HTMLInputElement ? input.value.trim() : "";
	if (!workspacePath) return;
	document.body.dataset.workspacePath = workspacePath;
	rememberWorkspace(workspacePath);
	closeDialog("workspace-dialog");
	renderRecentWorkspaces();
}

function recentWorkspaces() {
	try {
		const parsed = JSON.parse(localStorage.getItem("recentWorkspaces") ?? "[]");
		return Array.isArray(parsed)
			? parsed.filter((item) => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

function rememberWorkspace(workspacePath) {
	const recent = [
		workspacePath,
		...recentWorkspaces().filter((item) => item !== workspacePath),
	].slice(0, 8);
	localStorage.setItem("recentWorkspaces", JSON.stringify(recent));
}

function renderRecentWorkspaces() {
	const list = document.getElementById("workspace-recent-list");
	if (!(list instanceof HTMLElement)) return;
	const current = document.body?.dataset.workspacePath ?? "";
	const recent = [current, ...recentWorkspaces()]
		.filter(Boolean)
		.filter((item, index, array) => array.indexOf(item) === index);
	list.replaceChildren();
	if (recent.length === 0) {
		const row = document.createElement("li");
		row.className = "text-muted-foreground px-3 py-4 text-center text-sm";
		row.textContent = "No recent workspaces.";
		list.append(row);
		return;
	}
	for (const workspacePath of recent) {
		const row = document.createElement("li");
		const button = document.createElement("button");
		button.type = "button";
		button.className =
			"hover:bg-muted focus:bg-muted flex w-full items-center justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2 text-left outline-none";
		button.addEventListener("click", () => {
			const input = document.getElementById("workspace-input");
			if (input instanceof HTMLInputElement) {
				input.value = workspacePath;
				input.dispatchEvent(new Event("input", { bubbles: true }));
			}
			clickFirst("[data-workspace-submit]");
		});
		const label = document.createElement("span");
		label.className = "min-w-0 truncate font-mono text-sm";
		label.textContent = workspacePath;
		button.append(label);
		row.append(button);
		list.append(row);
	}
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

function bindDialogKeyboard() {
	document.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && document.activeElement?.id === "workspace-input") {
			event.preventDefault();
			clickFirst("[data-workspace-submit]");
		}
		if (event.key === "Enter" && document.activeElement?.id === "command-input") {
			event.preventDefault();
			runFirstVisible("[data-command-row]");
		}
		if (event.key === "Enter" && document.activeElement?.id === "session-input") {
			event.preventDefault();
			runFirstVisible("[data-session-row]");
		}
	});
}

function bindReservedShortcutPrevention() {
	window.addEventListener(
		"keydown",
		(event) => {
			const key = event.key.toLowerCase();
			if (event.altKey && key === "t") {
				event.preventDefault();
				return;
			}
			if (!(event.ctrlKey || event.metaKey)) {
				return;
			}

			const appShortcutKeys = new Set(["k", "l", "o", "r"]);
			if (appShortcutKeys.has(key)) {
				event.preventDefault();
			}
		},
		{ capture: true },
	);
}

function runFirstVisible(selector) {
	const row = visibleRows(selector)[0];
	const button = row?.querySelector("button");
	if (button instanceof HTMLElement) {
		button.click();
	} else if (row instanceof HTMLElement) {
		row.click();
	}
}

function visibleRows(selector) {
	return [...document.querySelectorAll(selector)].filter(
		(row) => row instanceof HTMLElement && getComputedStyle(row).display !== "none",
	);
}

function focusPrompt() {
	const input = document.getElementById("prompt-input");
	if (input instanceof HTMLTextAreaElement) {
		input.focus();
	}
}

function focusPromptEnd() {
	const input = document.getElementById("prompt-input");
	if (input instanceof HTMLTextAreaElement) {
		input.focus();
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
	const open = value.startsWith("/") && !value.includes(" ");
	const query = open ? value.slice(1).toLowerCase() : "";
	popover.style.display = open ? "" : "none";
	for (const row of document.querySelectorAll("[data-slash-row]")) {
		if (!(row instanceof HTMLElement)) continue;
		row.style.display =
			!query || (row.dataset.slashHaystack ?? "").includes(query) ? "" : "none";
	}
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

function cycleThinkingLevel() {
	fetch("/thinking/cycle", { method: "POST" }).catch(() => undefined);
}

function openModelSelector() {
	const trigger = document.getElementById("model-select-trigger");
	if (trigger instanceof HTMLButtonElement) {
		trigger.click();
	}
}

function bindFilePicker() {
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

function bindPromptAutosize() {
	const resize = () => {
		const input = document.getElementById("prompt-input");
		if (!(input instanceof HTMLTextAreaElement)) {
			return;
		}
		input.style.height = "auto";
		input.style.height = `${input.scrollHeight}px`;
	};

	document.addEventListener("input", (event) => {
		if (
			event.target instanceof HTMLTextAreaElement &&
			event.target.id === "prompt-input"
		) {
			resize();
		}
	});

	resize();
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

	const observer = new MutationObserver(() => {
		requestAnimationFrame(() => {
			const messages = document.getElementById("messages");
			if (!messages || !messagesScrollState.wasPinnedToBottom) {
				return;
			}
			messages.scrollTop = messages.scrollHeight;
		});
	});

	observer.observe(document.body, { childList: true, subtree: true });
}

function bindCommandRefresh() {
	let queued = false;
	const refresh = () => {
		queued = false;
		document.querySelectorAll(".command, .dropdown-menu").forEach((component) => {
			if (typeof component.refresh === "function") {
				component.refresh();
			} else {
				window.basecoat?.refresh?.(component);
			}
		});
	};
	const queueRefresh = () => {
		if (queued) return;
		queued = true;
		queueMicrotask(refresh);
	};

	const observer = new MutationObserver((mutations) => {
		if (
			mutations.some(
				(mutation) =>
					mutation.target instanceof Element &&
					mutation.target.closest(".command, .dropdown-menu"),
			)
		) {
			queueRefresh();
		}
	});

	observer.observe(document.body, { childList: true, subtree: true });
}

function bindCodeCopy() {
	document.addEventListener("click", async (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const button = target.closest("[data-copy-code]");
		if (!(button instanceof HTMLButtonElement)) return;
		const code = button.closest("[data-code-block]")?.querySelector("code");
		if (!code?.textContent) return;
		try {
			await navigator.clipboard.writeText(code.textContent);
			const previous = button.textContent;
			button.textContent = "Copied";
			setTimeout(() => {
				button.textContent = previous;
			}, 1200);
		} catch {
			button.textContent = "Failed";
		}
	});
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
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				if (isFilePickerOpen()) {
					runBestFileRow();
				} else {
					clickFirst("[data-send-trigger]");
				}
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
