import { bindModelSearch } from "../build/model-search.js";
import { refresh } from "./basecoat.js";
import { bindCodeCopy } from "./code-copy.js";
import * as dialogs from "./dialogs.js";
import { bindDisplayRefreshMeasurement } from "./display-refresh.js";
import { bindFileLinks } from "./file-links.js";
import * as fileTransfer from "./file-transfer.js";
import {
	bindMessageScroll,
	captureAnchor,
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
import { bindSessionSidebarResize } from "./session-sidebar.js";
import { bindVimScroll } from "./vim-scroll.js";
import { windowFocus } from "./window-focus.js";

const promptHistory = createPromptHistory();

window.piUi = {
	basecoat: { refresh },
	dialogs,
	fileTransfer,
	messageScroll: { captureAnchor, restoreAnchor, scrollBottom },
	pickers: { isFileOpen, isOpen: isPickerOpen },
	prompt: { clear: () => setPromptValue("") },
	promptHistory,
	sessionPerformance: { start: startSessionPerformanceMeasurement },
	windowFocus,
	workspaceReview: { applyOpen: () => {} },
	shouldAbortOnEscape(event) {
		return !event.defaultPrevented && !hasOpenDismissible();
	},
};

bindSessionSidebarResize();

function hasOpenDismissible() {
	if (isPickerOpen() || document.querySelector("dialog[open]")) return true;
	if (document.querySelector('[data-popover][aria-hidden="false"]')) return true;
	return Boolean(document.querySelector('[aria-haspopup][aria-expanded="true"]'));
}

window.addEventListener("DOMContentLoaded", () => {
	focusPromptEnd();
	dialogs.bindDialogs();
	bindPromptInteractions();
	bindPickers();
	bindMessageScroll();
	bindModelSearch();
	bindSessionPerformance();
	bindCodeCopy();
	bindVimScroll();
	bindDisplayRefreshMeasurement();
	bindFileLinks();
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
