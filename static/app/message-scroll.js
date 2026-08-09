import { collectAddedElementRoots } from "../mutation-roots.js";

const scrollControlThresholdPx = 48;
const state = { pinnedToBottom: true };
const bottomScrollTimers = new Set();
let anchor;
let historyLoading = false;

export function bindMessageScroll() {
	document.addEventListener(
		"scroll",
		(event) => {
			const messages = document.getElementById("messages");
			// Ignore captured scroll events from nested tool and code outputs. Scroll
			// position alone is not intent: streaming layout can also move scrollTop.
			if (!(messages instanceof HTMLElement) || event.target !== messages) return;
			updateScrollControl();
		},
		true,
	);

	// Release follow mode from explicit reader interactions, never from scroll
	// position changes alone: streamed tables, code, and other blocks can resize.
	const releasePointerScroll = (event) => {
		// Native CEF autoscroll can begin outside the transcript's DOM event path,
		// so middle-button intent is global. Primary presses inside the transcript
		// cover scrollbar drags, selection, links, and expanding interactive rows.
		if (
			event.button === 1 ||
			(event.button === 0 && isMessageInteraction(event.target))
		)
			markUnpinned();
	};
	document.addEventListener("pointerdown", releasePointerScroll, {
		capture: true,
		passive: true,
	});
	for (const type of ["mousedown", "auxclick"]) {
		document.addEventListener(
			type,
			(event) => {
				if (event.button === 1) markUnpinned();
			},
			{
				capture: true,
				passive: true,
			},
		);
	}
	document.addEventListener(
		"wheel",
		(event) => {
			if (event.deltaY < 0 && isMessageInteraction(event.target)) markUnpinned();
		},
		{ capture: true, passive: true },
	);
	document.addEventListener(
		"touchmove",
		(event) => {
			if (isMessageInteraction(event.target)) markUnpinned();
		},
		{ capture: true, passive: true },
	);
	document.addEventListener(
		"keydown",
		(event) => {
			if (isUpwardScrollKey(event) && isMessageInteraction(event.target))
				markUnpinned();
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
	anchor = {
		pinnedToBottom: state.pinnedToBottom,
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
	if (saved.pinnedToBottom) {
		scrollBottom();
		return;
	}

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

export function scrollBottom(behavior = "auto") {
	clearBottomScrollTimers();
	anchor = undefined;
	historyLoading = false;
	state.pinnedToBottom = true;
	const scroll = () => {
		const messages = document.getElementById("messages");
		if (!(messages instanceof HTMLElement) || !state.pinnedToBottom) return;
		messages.scrollTo({ top: messages.scrollHeight, behavior });
		updateScrollControl();
	};
	scroll();
	if (behavior === "auto") {
		for (const delay of [16, 80, 180]) {
			const timer = setTimeout(() => {
				bottomScrollTimers.delete(timer);
				scroll();
			}, delay);
			bottomScrollTimers.add(timer);
		}
	}
}

export function markUnpinned() {
	clearBottomScrollTimers();
	state.pinnedToBottom = false;
	updateScrollControl();
}

function clearBottomScrollTimers() {
	for (const timer of bottomScrollTimers) clearTimeout(timer);
	bottomScrollTimers.clear();
}

function isMessageInteraction(target) {
	const messages = document.getElementById("messages");
	return (
		messages instanceof HTMLElement &&
		target instanceof Node &&
		messages.contains(target)
	);
}

function isUpwardScrollKey(event) {
	return (
		event.key === "ArrowUp" ||
		event.key === "PageUp" ||
		event.key === "Home" ||
		(event.key === " " && event.shiftKey)
	);
}

function updateScrollControl() {
	const messages = document.getElementById("messages");
	const button = document.getElementById("messages-latest");
	if (!(messages instanceof HTMLElement) || !(button instanceof HTMLButtonElement))
		return;
	const distance = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
	const active = !state.pinnedToBottom && distance >= scrollControlThresholdPx;
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
