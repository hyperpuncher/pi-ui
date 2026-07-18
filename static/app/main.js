import { bindBasecoatMorphs, refresh } from "./basecoat.js";
import { bindCodeCopy } from "./code-copy.js";
import * as dialogs from "./dialogs.js";
import { bindDisplayRefreshMeasurement } from "./display-refresh.js";
import * as fileTransfer from "./file-transfer.js";
import {
	bindMessageScroll,
	captureAnchor,
	restoreAnchor,
	scrollBottom,
} from "./message-scroll.js";
import { bindPickers, isFileOpen, isOpen as isPickerOpen } from "./pickers.js";
import { createPromptHistory } from "./prompt-history.js";
import { bindPromptInteractions, focusPromptEnd } from "./prompt.js";
import { bindVimScroll } from "./vim-scroll.js";

const promptHistory = createPromptHistory();

window.piUi = {
	basecoat: { refresh },
	dialogs,
	fileTransfer,
	messageScroll: { captureAnchor, restoreAnchor, scrollBottom },
	pickers: { isFileOpen, isOpen: isPickerOpen },
	promptHistory,
	workspaceReview: {
		isOpen: () => false,
		setOpen: () => {},
		toggle: () => {},
	},
	shouldAbortOnEscape(event) {
		return !event.defaultPrevented && !hasOpenDismissible();
	},
};

function hasOpenDismissible() {
	if (isPickerOpen() || document.querySelector("dialog[open]")) return true;
	if (document.querySelector('[data-popover][aria-hidden="false"]')) return true;
	return Boolean(document.querySelector('[aria-haspopup][aria-expanded="true"]'));
}

window.addEventListener("DOMContentLoaded", () => {
	focusPromptEnd();
	bindPromptInteractions();
	bindPickers();
	bindMessageScroll();
	bindCodeCopy();
	bindVimScroll();
	bindBasecoatMorphs();
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
