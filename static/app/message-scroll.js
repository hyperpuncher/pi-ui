import { collectAddedElementRoots } from "../mutation-roots.js";

const bottomThresholdPx = 120;
const state = { pinnedToBottom: true };
let anchor;
let historyLoading = false;

export function bindMessageScroll() {
	document.addEventListener(
		"scroll",
		(event) => {
			const messages = document.getElementById("messages");
			// Ignore captured scroll events from nested tool and code outputs.
			if (!(messages instanceof HTMLElement) || event.target !== messages) return;
			const distance =
				messages.scrollHeight - messages.scrollTop - messages.clientHeight;
			state.pinnedToBottom = distance < bottomThresholdPx;
			updateScrollControl();
		},
		true,
	);

	let frame;
	const affectedRoots = new Set();
	const observer = new MutationObserver((records) => {
		for (const root of collectAddedElementRoots(records)) affectedRoots.add(root);
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = undefined;
			hydratePierreDiffs(affectedRoots);
			pinToolOutputs(affectedRoots);
			affectedRoots.clear();
			const messages = document.getElementById("messages");
			if (messages instanceof HTMLElement && state.pinnedToBottom)
				messages.scrollTop = messages.scrollHeight;
			updateScrollControl();
		});
	});
	const messages = document.getElementById("messages");
	if (messages)
		observer.observe(messages, {
			characterData: true,
			childList: true,
			subtree: true,
		});
	hydratePierreDiffs([document]);
	pinToolOutputs([document]);
	scrollBottom();
}

export function captureAnchor() {
	if (historyLoading) return false;
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return false;
	historyLoading = true;
	state.pinnedToBottom = false;
	anchor = { scrollHeight: messages.scrollHeight, scrollTop: messages.scrollTop };
	updateScrollControl();
	return true;
}

export function restoreAnchor() {
	const saved = anchor;
	anchor = undefined;
	historyLoading = false;
	if (!saved) return;
	requestAnimationFrame(() => {
		const messages = document.getElementById("messages");
		if (messages instanceof HTMLElement) {
			messages.scrollTop =
				saved.scrollTop + messages.scrollHeight - saved.scrollHeight;
		}
		updateScrollControl();
	});
}

export function scrollBottom(behavior = "auto") {
	anchor = undefined;
	historyLoading = false;
	state.pinnedToBottom = true;
	const scroll = () => {
		const messages = document.getElementById("messages");
		if (!(messages instanceof HTMLElement)) return;
		messages.scrollTo({ top: messages.scrollHeight, behavior });
		updateScrollControl();
	};
	scroll();
	if (behavior === "auto") {
		for (const delay of [16, 80, 180]) setTimeout(scroll, delay);
	}
}

export function markUnpinned() {
	state.pinnedToBottom = false;
	updateScrollControl();
}

function updateScrollControl() {
	const messages = document.getElementById("messages");
	const button = document.getElementById("messages-latest");
	if (!(messages instanceof HTMLElement) || !(button instanceof HTMLButtonElement))
		return;
	const distance = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
	const active = !state.pinnedToBottom && distance >= bottomThresholdPx;
	button.hidden = !active;
	button.inert = !active;
	button.tabIndex = active ? 0 : -1;
}

function pinToolOutputs(roots) {
	const outputs = new Set();
	for (const root of roots) {
		if (root instanceof HTMLElement) {
			const output = root.closest(".tool-output");
			if (output) outputs.add(output);
		}
		for (const output of root.querySelectorAll?.(".tool-output") ?? [])
			outputs.add(output);
	}
	for (const output of outputs) output.scrollTop = output.scrollHeight;
}

function hydratePierreDiffs(roots) {
	for (const root of roots) {
		const hosts = [
			...(root instanceof HTMLElement && root.matches("[data-pierre-diff]")
				? [root]
				: []),
			...(root.querySelectorAll?.("[data-pierre-diff]") ?? []),
		];
		for (const host of hosts) {
			if (!(host instanceof HTMLElement) || host.shadowRoot) continue;
			const template = host.querySelector('template[shadowrootmode="open"]');
			if (!(template instanceof HTMLTemplateElement)) continue;
			host.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
			template.remove();
		}
	}
}
