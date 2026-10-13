import { bindCodeCopy } from "#static/app/code-copy.js";
import {
	activateCommandItem,
	bindControls,
	refreshControls,
} from "#static/app/controls.js";
import { hydrateDateTime } from "#static/app/date-time.js";
import { bindDebugFrames } from "#static/app/debug-frames.js";
import { bindFileLinks } from "#static/app/file-links.js";
import * as fileTransfer from "#static/app/file-transfer.js";
import {
	afterUpdate,
	beforeUpdate,
	bindMessageResize,
	bindMessageScroll,
	hydratePierreDiff,
	isReading,
	scrollBottom,
	trimOldMessages,
} from "#static/app/message-scroll.js";
import { requestPermission, show } from "#static/app/notifications.js";
import {
	bindPickers,
	closePickers,
	completeSlashCommand,
	isFileOpen,
	isOpen as isPickerOpen,
	syncPickerSelection,
} from "#static/app/pickers.js";
import { createPromptHistory } from "#static/app/prompt-history.js";
import { focusPromptEnd, setPromptValue } from "#static/app/prompt.js";
import {
	readTransitionState,
	startSessionPerformanceMeasurement,
} from "#static/app/session-performance.js";
import { bindTooltips } from "#static/app/tooltips.js";
import { bindVimScroll } from "#static/app/vim-scroll.js";
import { windowFocus } from "#static/app/window-focus.js";

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
		import("#src/client/fonts.ts"),
		import("#src/client/code-theme.ts"),
		import("#src/client/workspace-review.ts"),
	]);
});
