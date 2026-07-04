const transcriptState = {
	wasPinnedToBottom: true,
};

bindReservedShortcutPrevention();
bindDesktopCommands();

window.addEventListener("DOMContentLoaded", () => {
	focusComposer();
	bindComposerAutosize();
	bindTranscriptAutoscroll();
	bindCommandPaletteFocus();
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
	const rows = document.querySelectorAll(selector);
	for (const row of rows) {
		if (row instanceof HTMLElement && row.style.display !== "none") {
			row.querySelector("button")?.click();
			return;
		}
	}
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
