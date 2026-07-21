import { collectAddedElementRoots } from "../mutation-roots.js";

const bottomThresholdPx = 120;
const scrollDirectionTolerancePx = 1;
const state = { pinnedToBottom: true, scrollTop: 0 };
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
			state.pinnedToBottom = pinnedAfterScroll(
				state.pinnedToBottom,
				state.scrollTop,
				messages.scrollTop,
				distance,
			);
			state.scrollTop = messages.scrollTop;
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
			if (messages instanceof HTMLElement && state.pinnedToBottom) {
				messages.scrollTop = messages.scrollHeight;
				state.scrollTop = messages.scrollTop;
			}
			updateScrollControl();
		});
	});
	const app = document.getElementById("app");
	if (app)
		observer.observe(app, {
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
	const viewportTop = messages.getBoundingClientRect().top;
	const visibleMessage = [...messages.querySelectorAll("[data-message-id]")].find(
		(message) => message.getBoundingClientRect().bottom > viewportTop,
	);
	historyLoading = true;
	state.pinnedToBottom = false;
	anchor = {
		messageId: visibleMessage?.getAttribute("data-message-id"),
		offset: visibleMessage
			? visibleMessage.getBoundingClientRect().top - viewportTop
			: undefined,
		scrollHeight: messages.scrollHeight,
		scrollTop: messages.scrollTop,
	};
	updateScrollControl();
	return true;
}

export function restoreAnchor() {
	const saved = anchor;
	anchor = undefined;
	historyLoading = false;
	if (!saved) return;

	// Restore against a retained DOM node rather than estimating from scrollHeight.
	// Datastar morphs and deferred message rendering can both change unrelated heights.
	const restore = () => {
		const messages = document.getElementById("messages");
		if (!(messages instanceof HTMLElement)) return;
		const retainedMessage = [...messages.querySelectorAll("[data-message-id]")].find(
			(message) => message.getAttribute("data-message-id") === saved.messageId,
		);
		if (retainedMessage && saved.offset !== undefined) {
			const currentOffset =
				retainedMessage.getBoundingClientRect().top -
				messages.getBoundingClientRect().top;
			messages.scrollTop = retainedAnchorScrollTop(
				messages.scrollTop,
				currentOffset,
				saved.offset,
			);
		} else {
			messages.scrollTop =
				saved.scrollTop + messages.scrollHeight - saved.scrollHeight;
		}
		updateScrollControl();
	};

	// The immediate correction prevents a paint at the morphed position. Follow-up
	// frames absorb layout produced by custom-element hydration and style resolution.
	restore();
	requestAnimationFrame(() => {
		restore();
		requestAnimationFrame(restore);
	});
}

export function retainedAnchorScrollTop(scrollTop, currentOffset, savedOffset) {
	return scrollTop + currentOffset - savedOffset;
}

export function pinnedAfterScroll(wasPinned, previousTop, scrollTop, distance) {
	if (distance < bottomThresholdPx) return true;
	// A queued programmatic scroll event can run after streaming content has made
	// scrollHeight grow. Only upward movement is evidence that the user unpinned.
	return wasPinned && scrollTop >= previousTop - scrollDirectionTolerancePx;
}

export function scrollBottom(behavior = "auto") {
	anchor = undefined;
	historyLoading = false;
	state.pinnedToBottom = true;
	const scroll = () => {
		const messages = document.getElementById("messages");
		if (!(messages instanceof HTMLElement)) return;
		messages.scrollTo({ top: messages.scrollHeight, behavior });
		state.scrollTop = messages.scrollTop;
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
			if (!(host instanceof HTMLElement)) continue;
			const template = host.querySelector('template[shadowrootmode="open"]');
			if (!(template instanceof HTMLTemplateElement)) continue;
			// Pierre may create the shadow root before Datastar inserts its template.
			const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
			shadow.append(template.content.cloneNode(true));
			template.remove();
		}
	}
}
