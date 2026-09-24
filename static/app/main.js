import { fuzzyFilter, fuzzyMatch } from "../../src/client/pi-fuzzy.ts";
import { shouldAutofocusPromptOnLoad } from "./autofocus.js";
import { bindCodeCopy } from "./code-copy.js";
import { activateCommandItem, bindControls, refreshControls } from "./controls.js";
import { hydrateDateTime } from "./date-time.js";
import { bindDisplayRefreshMeasurement } from "./display-refresh.js";
import {
	bindExtensionKeys,
	promptInputBusy,
	promptLevelInputActive,
	takesPromptKey,
} from "./extension-keys.js";
import { bindFileLinks } from "./file-links.js";
import * as fileTransfer from "./file-transfer.js";
import { bindDismissibleHistory } from "./history-stack.js";
import {
	bindMessageResize,
	bindMessageScroll,
	captureAnchor,
	hydratePierreDiff,
	restoreAnchor,
	scrollBottom,
	trimOldMessages,
} from "./message-scroll.js";
import { filterModelSearch } from "./model-search.js";
import {
	bindPickers,
	closePickers,
	completeSlashCommand,
	copyLastAssistantMessage,
	isFileOpen,
	isOpen as isPickerOpen,
	syncPickerSelection,
} from "./pickers.js";
import { createPromptHistory } from "./prompt-history.js";
import { focusPromptEnd, setPromptValue } from "./prompt.js";
import {
	readTransitionState,
	startSessionPerformanceMeasurement,
} from "./session-performance.js";
import { bindStreamReconnect } from "./stream-reconnect.js";
import { bindTerminalSurfaces } from "./terminal-keys.js";
import { bindTooltips } from "./tooltips.js";
import { bindVimScroll } from "./vim-scroll.js";
import { windowFocus } from "./window-focus.js";

const promptHistory = createPromptHistory();

window.piUi = {
	controls: { refresh: refreshControls, activate: activateCommandItem },
	codeTheme: { loadPreviews() {} },
	dateTime: { hydrate: hydrateDateTime },
	extensionKeys: { promptInputBusy, promptLevelInputActive, takesPromptKey },
	fonts: { apply() {} },
	fileTransfer,
	messageScroll: {
		bindResize: bindMessageResize,
		captureAnchor,
		hydratePierreDiff,
		restoreAnchor,
		scrollBottom,
		trimOldMessages,
	},
	modelSearch: { filter: filterModelSearch },
	pickers: {
		close: closePickers,
		complete: completeSlashCommand,
		copyLastMessage: copyLastAssistantMessage,
		fuzzyMatch,
		isFileOpen,
		isOpen: isPickerOpen,
		sync: syncPickerSelection,
	},
	prompt: {
		clear: () => setPromptValue(""),
	},
	promptHistory,
	sessionPerformance: {
		observe: readTransitionState,
		start: startSessionPerformanceMeasurement,
	},
	windowFocus,
	workspaceReview: { applyOpen: () => {} },
	liveWorkspace: { applyOpen: () => {} },
	shouldAbortOnEscape(event) {
		return !event.defaultPrevented && !hasOpenDismissible();
	},
};

function hasOpenDismissible() {
	if (isPickerOpen() || document.querySelector(":modal")) return true;
	return Boolean(
		document.querySelector(
			"[popover]:popover-open:not([data-slot='tooltip-content'])",
		),
	);
}

// Register delegated file-link handling as soon as this module evaluates. Waiting for
// DOMContentLoaded makes it vulnerable to another initializer failing first and leaves
// the browser to attempt the forbidden file:// navigation itself.
bindFileLinks();

window.addEventListener("DOMContentLoaded", async () => {
	bindControls();
	if (shouldAutofocusPromptOnLoad()) focusPromptEnd();
	bindDismissibleHistory();
	bindPickers({ fuzzyFilter });
	bindMessageScroll();
	bindCodeCopy();
	bindTooltips();
	bindVimScroll();
	bindDisplayRefreshMeasurement();
	bindStreamReconnect();
	bindTerminalSurfaces();
	bindExtensionKeys();
	bindDebugFps();

	await Promise.all([
		import("../../src/client/fonts.ts"),
		import("../../src/client/code-theme.ts"),
		import("../../src/client/workspace-review.ts"),
		import("../../src/client/live-workspace.ts"),
	]);
});

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
