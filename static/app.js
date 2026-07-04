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
