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
let observedPrompt;
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
			if (historyLoading && anchor) {
				anchor.userScrollDelta += messages.scrollTop - anchor.lastScrollTop;
				anchor.lastScrollTop = messages.scrollTop;
			}
			state.scrollTop = messages.scrollTop;
			state.rearmOnBottom = false;
			updateScrollControl();
		},
		true,
	);

	// Release follow mode from explicit reader interactions, never from scroll
	// position changes alone: streamed tables, code, and other blocks can resize.
	const releasePointerScroll = (event) => {
		// Browser autoscroll can begin outside the transcript's DOM event path,
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

	bindMessageResize();
	scrollBottom();
}

export function captureAnchor() {
	if (historyLoading) return false;
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return false;
	const viewport = messages.getBoundingClientRect();
	const visibleMessage = messageAtViewportTop(messages, viewport);
	anchor = {
		lastScrollTop: messages.scrollTop,
		messageId: visibleMessage?.getAttribute("data-message-id"),
		offset: visibleMessage
			? visibleMessage.getBoundingClientRect().top - viewport.top
			: undefined,
		pinnedToBottom: state.pinnedToBottom,
		scrollHeight: messages.scrollHeight,
		scrollTop: messages.scrollTop,
		userScrollDelta: 0,
	};
	historyLoading = true;
	messages.style.overflowAnchor = "none";
	updateScrollControl();
	return true;
}

export function restoreAnchor() {
	const saved = anchor;
	anchor = undefined;
	historyLoading = false;
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return;
	if (!saved) {
		messages.style.removeProperty("overflow-anchor");
		return;
	}
	if (saved.pinnedToBottom) {
		messages.style.removeProperty("overflow-anchor");
		scrollBottom();
		return;
	}
	const retainedMessage = [...messages.querySelectorAll("[data-message-id]")].find(
		(message) => message.getAttribute("data-message-id") === saved.messageId,
	);
	if (retainedMessage && saved.offset !== undefined) {
		const currentOffset =
			retainedMessage.getBoundingClientRect().top -
			messages.getBoundingClientRect().top;
		const targetOffset = saved.offset - saved.userScrollDelta;
		messages.scrollTop = retainedAnchorScrollTop(
			messages.scrollTop,
			currentOffset,
			targetOffset,
		);
	} else {
		messages.scrollTop =
			saved.scrollTop +
			saved.userScrollDelta +
			messages.scrollHeight -
			saved.scrollHeight;
	}
	messages.style.removeProperty("overflow-anchor");
	state.scrollTop = messages.scrollTop;
	updateScrollControl();
}

export function trimOldMessages() {
	if (!state.pinnedToBottom) return;
	const messages = document.getElementById("messages");
	const trigger = document.getElementById("messages-trim");
	if (!(messages instanceof HTMLElement) || !(trigger instanceof HTMLButtonElement))
		return;
	const messageElements = [
		...document.querySelectorAll("#message-list > [data-message-id]"),
	];
	const excess = messageElements.length - 100;
	const lastCandidate = messageElements[excess - 1];
	if (
		!lastCandidate ||
		!shouldTrimOldMessages(
			state.pinnedToBottom,
			excess,
			lastCandidate.getBoundingClientRect().bottom,
			messages.getBoundingClientRect().top,
		)
	)
		return;
	trigger.click();
}

export function retainedAnchorScrollTop(scrollTop, currentOffset, targetOffset) {
	return scrollTop + currentOffset - targetOffset;
}

export function shouldTrimOldMessages(
	pinnedToBottom,
	excess,
	candidateBottom,
	viewportTop,
) {
	return pinnedToBottom && excess > 0 && candidateBottom <= viewportTop;
}

function messageAtViewportTop(messages, viewport) {
	for (const yOffset of [8, 32, 64, 128]) {
		for (const xRatio of [0.25, 0.5, 0.75]) {
			const message = document
				.elementFromPoint(
					viewport.left + viewport.width * xRatio,
					viewport.top + yOffset,
				)
				?.closest("[data-message-id]");
			if (message instanceof HTMLElement && messages.contains(message))
				return message;
		}
	}
	return [...messages.querySelectorAll("[data-message-id]")].find(
		(message) => message.getBoundingClientRect().bottom > viewport.top,
	);
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
		messages.style.removeProperty("overflow-anchor");
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
	const prompt = document.getElementById("prompt-box");
	if (!(stack instanceof HTMLElement) || !(prompt instanceof HTMLElement)) return;
	if (stack === observedMessageStack && prompt === observedPrompt) return;
	messageResizeObserver ??= new ResizeObserver(() => {
		updatePromptSpacer();
		const messages = document.getElementById("messages");
		if (messages instanceof HTMLElement && state.pinnedToBottom)
			messages.scrollTop = messages.scrollHeight;
		updateScrollControl();
	});
	if (observedMessageStack) messageResizeObserver.unobserve(observedMessageStack);
	if (observedPrompt) messageResizeObserver.unobserve(observedPrompt);
	observedMessageStack = stack;
	observedPrompt = prompt;
	messageResizeObserver.observe(stack);
	messageResizeObserver.observe(prompt);
}

function updatePromptSpacer() {
	const prompt = document.getElementById("prompt-box");
	const spacer = document.getElementById("messages-prompt-spacer");
	if (!(prompt instanceof HTMLElement) || !(spacer instanceof HTMLElement)) return;
	const height = `${prompt.offsetHeight + promptSpacerClearancePx}px`;
	if (spacer.style.height !== height) spacer.style.height = height;
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
