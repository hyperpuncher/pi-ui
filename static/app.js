const transcriptState = {
	wasPinnedToBottom: true,
};

bindReservedShortcutPrevention();
bindDesktopCommands();
bindSystemThemeSync();

window.addEventListener("DOMContentLoaded", () => {
	focusComposer();
	bindComposerAutosize();
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

			const appShortcutKeys = new Set(["k", "l", "m", "o", "r"]);
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
