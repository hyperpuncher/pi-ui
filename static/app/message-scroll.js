const liveEdgeThresholdPx = 8;
const promptSpacerClearancePx = 48;
const scrollControlThresholdPx = 48;
const state = {
	middleScrolling: false,
	pinnedToBottom: true,
	pointerScrolling: false,
	rearmOnBottom: false,
	scrollTop: 0,
};
const bottomScrollTimers = new Set();
let anchor;
let historyLoading = false;
let observedMessageStack;
let messageResizeObserver;
let pointerStart;

export function bindMessageScroll() {
	document.addEventListener(
		"scroll",
		(event) => {
			const messages = document.getElementById("messages");
			// Ignore captured scroll events from nested tool and code outputs. Layout
			// changes alone never re-arm following; reaching the end during an active
			// downward wheel or scrollbar gesture does.
			if (!(messages instanceof HTMLElement) || event.target !== messages) return;
			if (
				(state.middleScrolling || state.pointerScrolling) &&
				messages.scrollTop < state.scrollTop
			)
				markUnpinned();
			const distance =
				messages.scrollHeight - messages.scrollTop - messages.clientHeight;
			if (
				shouldRearmAfterScroll(
					state.pinnedToBottom,
					state.scrollTop,
					messages.scrollTop,
					distance,
					state.middleScrolling ||
						state.rearmOnBottom ||
						state.pointerScrolling,
				)
			)
				state.pinnedToBottom = true;
			state.scrollTop = messages.scrollTop;
			state.rearmOnBottom = false;
			updateScrollControl();
		},
		true,
	);

	// Release follow mode from explicit reader interactions, never from scroll
	// position changes alone: streamed tables, code, and other blocks can resize.
	const releasePointerScroll = (event) => {
		// Native CEF autoscroll can begin outside the transcript's DOM event path,
		// so middle-button intent is global. Primary drags inside the transcript
		// cover scrollbar movement and text selection without treating clicks as scrolls.
		if (event.button === 1) {
			state.middleScrolling = true;
			markUnpinned();
		} else if (event.button === 0 && isMessageInteraction(event.target)) {
			state.middleScrolling = false;
			state.pointerScrolling = true;
			pointerStart = { x: event.clientX, y: event.clientY };
			const messages = document.getElementById("messages");
			if (messages instanceof HTMLElement) state.scrollTop = messages.scrollTop;
		}
	};
	document.addEventListener("pointerdown", releasePointerScroll, {
		capture: true,
		passive: true,
	});
	document.addEventListener(
		"pointermove",
		(event) => {
			if (
				state.pointerScrolling &&
				pointerStart &&
				hasPointerDragIntent(
					pointerStart.x,
					pointerStart.y,
					event.clientX,
					event.clientY,
				)
			) {
				pointerStart = undefined;
				markUnpinned();
			}
		},
		{ capture: true, passive: true },
	);
	for (const type of ["pointerup", "pointercancel"]) {
		document.addEventListener(
			type,
			() => {
				state.pointerScrolling = false;
				pointerStart = undefined;
			},
			{ capture: true, passive: true },
		);
	}
	for (const type of ["mousedown", "auxclick"]) {
		document.addEventListener(
			type,
			(event) => {
				if (event.button === 1) {
					state.middleScrolling = true;
					markUnpinned();
				}
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
			if (!isMessageInteraction(event.target)) return;
			state.middleScrolling = false;
			if (event.deltaY < 0) markUnpinned();
			else if (event.deltaY > 0) state.rearmOnBottom = true;
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

	bindPromptSpacer();
	bindMessageResize();
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

export function hasPointerDragIntent(startX, startY, currentX, currentY) {
	return Math.hypot(currentX - startX, currentY - startY) >= 8;
}

export function shouldRearmAfterScroll(
	wasPinned,
	previousTop,
	scrollTop,
	distance,
	hasDownwardIntent,
) {
	return (
		!wasPinned &&
		hasDownwardIntent &&
		scrollTop > previousTop &&
		distance <= liveEdgeThresholdPx
	);
}

export function scrollBottom(behavior = "auto") {
	clearBottomScrollTimers();
	anchor = undefined;
	historyLoading = false;
	state.middleScrolling = false;
	state.pinnedToBottom = true;
	state.pointerScrolling = false;
	state.rearmOnBottom = false;
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
	state.rearmOnBottom = false;
	const messages = document.getElementById("messages");
	if (messages instanceof HTMLElement) state.scrollTop = messages.scrollTop;
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

export function bindMessageResize() {
	const stack = document.querySelector("#messages > .messages-stack");
	if (!(stack instanceof HTMLElement) || stack === observedMessageStack) return;
	messageResizeObserver ??= new ResizeObserver(() => {
		requestAnimationFrame(() => {
			const messages = document.getElementById("messages");
			if (messages instanceof HTMLElement && state.pinnedToBottom)
				messages.scrollTop = messages.scrollHeight;
			updateScrollControl();
		});
	});
	if (observedMessageStack) messageResizeObserver.unobserve(observedMessageStack);
	observedMessageStack = stack;
	messageResizeObserver.observe(stack);
}

function bindPromptSpacer() {
	const prompt = document.getElementById("prompt-box");
	if (!(prompt instanceof HTMLElement)) return;
	const sync = () => {
		updatePromptSpacer();
		const messages = document.getElementById("messages");
		if (messages instanceof HTMLElement && state.pinnedToBottom)
			messages.scrollTop = messages.scrollHeight;
		updateScrollControl();
	};
	new ResizeObserver(sync).observe(prompt);
	sync();
}

function updatePromptSpacer() {
	const prompt = document.getElementById("prompt-box");
	const spacer = document.getElementById("messages-prompt-spacer");
	if (!(prompt instanceof HTMLElement) || !(spacer instanceof HTMLElement)) return;
	spacer.style.height = `${prompt.offsetHeight + promptSpacerClearancePx}px`;
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

export function hydratePierreDiff(host) {
	if (!(host instanceof HTMLElement)) return;
	const template = host.querySelector('template[shadowrootmode="open"]');
	if (!(template instanceof HTMLTemplateElement)) return;
	// Pierre may create the shadow root before Datastar inserts its template.
	const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
	shadow.append(template.content.cloneNode(true));
	template.remove();
}
