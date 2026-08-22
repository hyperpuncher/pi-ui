import {
	bindModelSearch,
	preserveModelSearch,
	restoreModelSearch,
} from "../build/model-search.js";
import { fuzzyFilter, fuzzyMatch } from "../build/pi-fuzzy.js";
import { refresh } from "./basecoat.js";
import { bindCodeCopy } from "./code-copy.js";
import * as dialogs from "./dialogs.js";
import { bindDisplayRefreshMeasurement } from "./display-refresh.js";
import { bindFileLinks } from "./file-links.js";
import * as fileTransfer from "./file-transfer.js";
import {
	bindMessageResize,
	bindMessageScroll,
	captureAnchor,
	hydratePierreDiff,
	restoreAnchor,
	scrollBottom,
} from "./message-scroll.js";
import { bindPickers, isFileOpen, isOpen as isPickerOpen } from "./pickers.js";
import { createPromptHistory } from "./prompt-history.js";
import { bindPromptInteractions, focusPromptEnd, setPromptValue } from "./prompt.js";
import {
	bindSessionPerformance,
	startSessionPerformanceMeasurement,
} from "./session-performance.js";
import { bindVimScroll } from "./vim-scroll.js";
import { windowFocus } from "./window-focus.js";

const promptHistory = createPromptHistory();

window.piUi = {
	basecoat: { refresh },
	codeTheme: { loadPreviews() {} },
	dialogs,
	fileTransfer,
	messageScroll: {
		bindResize: bindMessageResize,
		captureAnchor,
		hydratePierreDiff,
		restoreAnchor,
		scrollBottom,
	},
	modelSearch: { preserve: preserveModelSearch, restore: restoreModelSearch },
	pickers: { fuzzyMatch, isFileOpen, isOpen: isPickerOpen },
	prompt: { clear: () => setPromptValue("") },
	promptHistory,
	sessionPerformance: { start: startSessionPerformanceMeasurement },
	windowFocus,
	workspaceReview: { applyOpen: () => {} },
	shouldAbortOnEscape(event) {
		return !event.defaultPrevented && !hasOpenDismissible();
	},
};

function hasOpenDismissible() {
	if (isPickerOpen() || document.querySelector("dialog[open]")) return true;
	if (document.querySelector('[data-popover][aria-hidden="false"]')) return true;
	return Boolean(document.querySelector('[aria-haspopup][aria-expanded="true"]'));
}

// Register delegated file-link handling as soon as this module evaluates. Waiting for
// DOMContentLoaded makes it vulnerable to another initializer failing first and leaves
// the browser to attempt the forbidden file:// navigation itself.
bindFileLinks();

window.addEventListener("DOMContentLoaded", () => {
	focusPromptEnd();
	dialogs.bindDialogs();
	bindPromptInteractions();
	bindPickers({ fuzzyFilter });
	bindMessageScroll();
	bindModelSearch();
	bindSessionPerformance();
	bindCodeCopy();
	bindVimScroll();
	bindDisplayRefreshMeasurement();
	bindDebugFps();
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
