import { collectAddedElementRoots } from "../mutation-roots.js";

const state = { wasPinnedToBottom: true };
let anchor;
let historyLoading = false;

export function bindMessageScroll() {
	document.addEventListener(
		"scroll",
		() => {
			const messages = document.getElementById("messages");
			if (!messages) return;
			const distance =
				messages.scrollHeight - messages.scrollTop - messages.clientHeight;
			state.wasPinnedToBottom = distance < 120;
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
			if (messages && state.wasPinnedToBottom)
				messages.scrollTop = messages.scrollHeight;
		});
	});
	const messages = document.getElementById("messages");
	if (messages) observer.observe(messages, { childList: true, subtree: true });
	hydratePierreDiffs([document]);
	pinToolOutputs([document]);
	scrollBottom();
}

export function captureAnchor() {
	if (historyLoading) return false;
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return false;
	historyLoading = true;
	state.wasPinnedToBottom = false;
	anchor = { scrollHeight: messages.scrollHeight, scrollTop: messages.scrollTop };
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
	});
}

export function scrollBottom() {
	state.wasPinnedToBottom = true;
	for (const delay of [0, 16, 80, 180]) {
		setTimeout(() => {
			const messages = document.getElementById("messages");
			if (messages instanceof HTMLElement)
				messages.scrollTop = messages.scrollHeight;
		}, delay);
	}
}

export function markUnpinned() {
	state.wasPinnedToBottom = false;
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
