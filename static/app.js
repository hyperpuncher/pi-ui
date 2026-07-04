const transcriptState = {
	wasPinnedToBottom: true,
};

bindReservedShortcutPrevention();
bindDesktopCommands();
bindSystemThemeSync();

window.addEventListener("DOMContentLoaded", () => {
	focusComposer();
	bindComposerAutosize();
	bindSlashPicker();
	bindFilePicker();
	bindModelSearch();
	bindTranscriptAutoscroll();
	bindCommandPaletteFocus();
	bindSessionKeyboard();
});

function bindDesktopCommands() {
	globalThis.__piUiCommand = (command) => {
		const eventName = {
			"new-chat": "pi-new-chat",
			"resume-session": "pi-resume-session",
			"command-palette": "pi-command-palette",
			"switch-model": "pi-switch-model",
			"change-workspace": "pi-change-workspace",
		}[command];

		if (eventName) {
			window.dispatchEvent(new CustomEvent(eventName));
		}
	};

	globalThis.__piUiRunFirstCommand = () => {
		runFirstVisible("[data-command-row]");
	};

	globalThis.__piUiRunFirstSession = () => {
		runFirstVisible("[data-session-row]");
	};

	globalThis.__piUiFocusSlashRow = (direction) => {
		focusSlashRow(direction);
	};

	globalThis.__piUiFocusComposerEnd = () => {
		focusComposerEnd();
	};

	globalThis.__piUiSlashOpen = () => isSlashPickerOpen();

	globalThis.__piUiUpdateSlashPicker = (value) => updateSlashPicker(value ?? "");

	globalThis.__piUiCloseSlashPicker = () => closeSlashPicker();

	globalThis.__piUiOpenModelSelector = () => openModelSelector();

	globalThis.__piUiPromptWorkspace = () => promptWorkspace();

	globalThis.__piUiFileOpen = () => isFilePickerOpen();

	globalThis.__piUiFocusFileRow = (direction) => focusFileRow(direction);

	globalThis.__piUiRunFirstFile = () => runBestFileRow();

	globalThis.__piUiInsertFilePrefix = () => insertFilePrefix();
}

function promptWorkspace() {
	const current = document.body?.dataset.workspacePath ?? "";
	const next = window.prompt("Workspace folder", current);
	if (!next?.trim()) {
		return;
	}
	document.body.dataset.workspacePath = next.trim();
	globalThis.Datastar?.signals?.set?.("workspacePath", next.trim());
	fetch("/workspace/open", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ workspacePath: next.trim() }),
	}).catch(() => undefined);
}

function bindSystemThemeSync() {
	const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
	if (!media) {
		return;
	}

	const apply = () => {
		const stored = localStorage.getItem("themeMode");
		const dark = stored ? stored === "dark" : media.matches;
		document.documentElement.classList.toggle("dark", dark);
	};

	apply();
	media.addEventListener("change", apply);
	globalThis.addEventListener("storage", (event) => {
		if (event.key === "themeMode") {
			apply();
		}
	});
}

function bindReservedShortcutPrevention() {
	window.addEventListener(
		"keydown",
		(event) => {
			if (!(event.ctrlKey || event.metaKey)) {
				return;
			}

			const appShortcutKeys = new Set(["k", "l", "o", "r"]);
			if (appShortcutKeys.has(event.key.toLowerCase())) {
				event.preventDefault();
			}
		},
		{ capture: true },
	);
}

function runFirstVisible(selector) {
	const row = visibleRows(selector)[0];
	row?.querySelector("button")?.click();
}

function visibleRows(selector) {
	return [...document.querySelectorAll(selector)].filter(
		(row) => row instanceof HTMLElement && getComputedStyle(row).display !== "none",
	);
}

function focusComposer() {
	const input = document.getElementById("composer-input");
	if (input instanceof HTMLTextAreaElement) {
		input.focus();
	}
}

function focusComposerEnd() {
	const input = document.getElementById("composer-input");
	if (input instanceof HTMLTextAreaElement) {
		input.focus();
		input.selectionStart = input.value.length;
		input.selectionEnd = input.value.length;
	}
}

function bindSlashPicker() {
	const syncFromComposer = (event) => {
		if (
			event.target instanceof HTMLTextAreaElement &&
			event.target.id === "composer-input"
		) {
			updateSlashPicker(event.target.value);
		}
	};
	document.addEventListener("input", syncFromComposer);
	document.addEventListener("keyup", syncFromComposer);
	document.addEventListener("pointerdown", (event) => {
		const target = event.target;
		if (!(target instanceof Node)) return;
		const composer = document.getElementById("composer");
		if (composer?.contains(target)) return;
		closeSlashPicker();
	});
	updateSlashPicker("");
}

function updateSlashPicker(value) {
	const popover = document.getElementById("composer-slash-popover");
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
	const popover = document.getElementById("composer-slash-popover");
	if (popover instanceof HTMLElement) {
		popover.style.display = "none";
	}
}

function isSlashPickerOpen() {
	const popover = document.getElementById("composer-slash-popover");
	return popover instanceof HTMLElement && popover.style.display !== "none";
}

function openModelSelector() {
	const trigger = document.getElementById("model-select-trigger");
	if (trigger instanceof HTMLButtonElement) {
		if (trigger.getAttribute("aria-expanded") !== "true") {
			trigger.click();
		}
		setTimeout(() => document.getElementById("model-search-input")?.focus(), 0);
	}
}

function bindModelSearch() {
	document.addEventListener("input", (event) => {
		if (
			event.target instanceof HTMLInputElement &&
			event.target.id === "model-search-input"
		) {
			filterModelRows(event.target.value);
		}
	});

	document.addEventListener("keydown", (event) => {
		if (
			!(event.target instanceof HTMLInputElement) ||
			event.target.id !== "model-search-input"
		) {
			return;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			focusFirstVisibleModelRow();
		}
	});
}

function filterModelRows(query) {
	const normalized = query.trim().toLowerCase();
	for (const row of document.querySelectorAll("[data-model-row]")) {
		if (!(row instanceof HTMLElement)) continue;
		const haystack = row.dataset.modelHaystack ?? "";
		row.style.display =
			!normalized || fuzzyIncludes(haystack, normalized) ? "" : "none";
	}
}

function fuzzyIncludes(haystack, needle) {
	let index = 0;
	for (const char of needle) {
		index = haystack.indexOf(char, index);
		if (index === -1) return false;
		index += 1;
	}
	return true;
}

function focusFirstVisibleModelRow() {
	const row = visibleRows("[data-model-row]")[0];
	if (row instanceof HTMLElement) {
		row.focus();
	}
}

function bindFilePicker() {
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && isFilePickerOpen()) {
			event.preventDefault();
			closeFilePicker({ suppressUntilInput: true });
			focusComposerEnd();
			return;
		}

		if (document.activeElement?.closest?.("[data-file-row]")) {
			if (event.key === "Backspace") {
				event.preventDefault();
				focusComposerEnd();
				deleteComposerCharBeforeCursor();
				return;
			}
			if (
				event.key.length === 1 &&
				!event.ctrlKey &&
				!event.metaKey &&
				!event.altKey
			) {
				event.preventDefault();
				focusComposerEnd();
				insertComposerText(event.key);
			}
		}
	});

	const syncFromComposer = (event) => {
		if (
			event.target instanceof HTMLTextAreaElement &&
			event.target.id === "composer-input"
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
	document.addEventListener("input", syncFromComposer);
	document.addEventListener("keyup", syncFromComposer);
	document.addEventListener("click", (event) => {
		if (
			event.target instanceof HTMLTextAreaElement &&
			event.target.id === "composer-input"
		) {
			updateFilePicker(event.target);
		}
	});
	document.addEventListener("pointerdown", (event) => {
		const target = event.target;
		if (!(target instanceof Node)) return;
		const composer = document.getElementById("composer");
		if (composer?.contains(target)) return;
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
	const popover = document.getElementById("composer-file-popover");
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
	const input = document.getElementById("composer-input");
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

function insertComposerText(text) {
	const input = document.getElementById("composer-input");
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

function deleteComposerCharBeforeCursor() {
	const input = document.getElementById("composer-input");
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
	const input = document.getElementById("composer-input");
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
	const popover = document.getElementById("composer-file-popover");
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
	const popover = document.getElementById("composer-file-popover");
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
	rows[nextIndex]?.querySelector("button")?.focus();
}

function bindComposerAutosize() {
	const resize = () => {
		const input = document.getElementById("composer-input");
		if (!(input instanceof HTMLTextAreaElement)) {
			return;
		}
		input.style.height = "auto";
		input.style.height = `${input.scrollHeight}px`;
	};

	document.addEventListener("input", (event) => {
		if (
			event.target instanceof HTMLTextAreaElement &&
			event.target.id === "composer-input"
		) {
			resize();
		}
	});

	resize();
}

function bindTranscriptAutoscroll() {
	document.addEventListener(
		"scroll",
		() => {
			const transcript = document.getElementById("transcript");
			if (!transcript) {
				return;
			}
			const distanceFromBottom =
				transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
			transcriptState.wasPinnedToBottom = distanceFromBottom < 120;
		},
		true,
	);

	const observer = new MutationObserver(() => {
		requestAnimationFrame(() => {
			const transcript = document.getElementById("transcript");
			if (!transcript || !transcriptState.wasPinnedToBottom) {
				return;
			}
			transcript.scrollTop = transcript.scrollHeight;
		});
	});

	observer.observe(document.body, { childList: true, subtree: true });
}

function bindSessionKeyboard() {
	document.addEventListener("keydown", (event) => {
		if (
			(event.key === "ArrowDown" || event.key === "ArrowUp") &&
			(document.activeElement?.id === "command-input" ||
				document.activeElement?.closest?.("[data-command-row]"))
		) {
			event.preventDefault();
			focusCommandRow(event.key === "ArrowDown" ? 1 : -1);
			return;
		}

		if (
			event.key === "Enter" &&
			document.activeElement?.closest?.("[data-command-row]")
		) {
			event.preventDefault();
			document.activeElement.click();
			return;
		}

		if (
			(event.key === "ArrowDown" || event.key === "ArrowUp") &&
			document.activeElement?.closest?.("[data-slash-row]")
		) {
			event.preventDefault();
			focusSlashRow(event.key === "ArrowDown" ? 1 : -1);
			return;
		}

		if (
			event.key === "Enter" &&
			document.activeElement?.closest?.("[data-slash-row]")
		) {
			event.preventDefault();
			document.activeElement.click();
			return;
		}

		if (
			(event.key === "ArrowDown" || event.key === "ArrowUp") &&
			document.activeElement?.closest?.("[data-file-row]")
		) {
			event.preventDefault();
			focusFileRow(event.key === "ArrowDown" ? 1 : -1);
			return;
		}

		if (
			event.key === "Enter" &&
			document.activeElement?.closest?.("[data-file-row]")
		) {
			event.preventDefault();
			document.activeElement.click();
			return;
		}

		if (event.key === "Escape" && isSlashPickerOpen()) {
			event.preventDefault();
			closeSlashPicker();
			focusComposerEnd();
			return;
		}

		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
			return;
		}

		const picker = document.querySelector("[data-show='$sessionOpen']");
		if (
			!(picker instanceof HTMLElement) ||
			getComputedStyle(picker).display === "none"
		) {
			return;
		}

		const active = document.activeElement;
		if (
			active?.id !== "session-input" &&
			!(active instanceof HTMLButtonElement && active.closest("[data-session-row]"))
		) {
			return;
		}

		event.preventDefault();
		focusSessionRow(event.key === "ArrowDown" ? 1 : -1);
	});
}

function focusCommandRow(direction) {
	const rows = visibleRows("[data-command-row]");
	if (rows.length === 0) {
		return;
	}

	const activeRow = document.activeElement?.closest?.("[data-command-row]");
	const activeIndex = rows.findIndex((row) => row === activeRow);
	const nextIndex =
		activeIndex === -1
			? direction > 0
				? 0
				: rows.length - 1
			: (activeIndex + direction + rows.length) % rows.length;
	rows[nextIndex]?.querySelector("button")?.focus();
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
	rows[nextIndex]?.querySelector("button")?.focus();
}

function focusSessionRow(direction) {
	const rows = visibleRows("[data-session-row]");
	if (rows.length === 0) {
		return;
	}

	const activeRow = document.activeElement?.closest?.("[data-session-row]");
	const activeIndex = rows.findIndex((row) => row === activeRow);
	const nextIndex =
		activeIndex === -1
			? direction > 0
				? 0
				: rows.length - 1
			: (activeIndex + direction + rows.length) % rows.length;
	rows[nextIndex]?.querySelector("button")?.focus();
}

function bindCommandPaletteFocus() {
	let wasOpen = false;
	const observer = new MutationObserver(() => {
		const palette = document.querySelector("[data-show='$commandOpen']");
		const sessionPicker = document.querySelector("[data-show='$sessionOpen']");
		const isCommandOpen =
			palette instanceof HTMLElement && palette.style.display !== "none";
		const isSessionOpen =
			sessionPicker instanceof HTMLElement &&
			sessionPicker.style.display !== "none";
		const isOpen = isCommandOpen || isSessionOpen;
		if (isOpen && !wasOpen) {
			requestAnimationFrame(() => {
				if (isCommandOpen) {
					document.getElementById("command-input")?.focus();
				} else {
					document.getElementById("session-input")?.focus();
				}
			});
		}
		wasOpen = isOpen;
	});

	observer.observe(document.body, {
		attributes: true,
		attributeFilter: ["style"],
		subtree: true,
	});
}
