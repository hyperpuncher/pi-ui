import { bindCodeCopy } from "./code-copy.js";
import { activateCommandItem, bindControls, refreshControls } from "./controls.js";
import { hydrateDateTime } from "./date-time.js";
import { bindDebugFrames } from "./debug-frames.js";
import { bindFileLinks } from "./file-links.js";
import * as fileTransfer from "./file-transfer.js";
import {
	afterUpdate,
	beforeUpdate,
	bindMessageResize,
	bindMessageScroll,
	hydratePierreDiff,
	isReading,
	scrollBottom,
	trimOldMessages,
} from "./message-scroll.js";
import { requestPermission, show } from "./notifications.js";
import {
	bindPickers,
	closePickers,
	completeSlashCommand,
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
import { bindTooltips } from "./tooltips.js";
import { bindVimScroll } from "./vim-scroll.js";
import { windowFocus } from "./window-focus.js";

const promptHistory = createPromptHistory();

window.piUi = {
	controls: { refresh: refreshControls, activate: activateCommandItem },
	codeTheme: { loadPreviews() {} },
	dateTime: { hydrate: hydrateDateTime },
	fonts: { apply() {} },
	fileTransfer,
	messageScroll: {
		afterUpdate,
		beforeUpdate,
		bindResize: bindMessageResize,
		hydratePierreDiff,
		isReading,
		scrollBottom,
		trimOldMessages,
	},
	notifications: { requestPermission, show },
	pickers: {
		close: closePickers,
		complete: completeSlashCommand,
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
	focusPromptEnd();
	bindPickers();
	bindMessageScroll();
	bindCodeCopy();
	bindTooltips();
	bindVimScroll();
	bindDebugFrames();

	await Promise.all([
		import("../../src/client/fonts.ts"),
		import("../../src/client/code-theme.ts"),
		import("../../src/client/workspace-review.ts"),
	]);
});
