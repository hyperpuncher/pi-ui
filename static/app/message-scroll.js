const liveEdgeThresholdPx = 8;
const promptSpacerClearancePx = 48;
const scrollControlThresholdPx = 48;
const state = {
	middleScrolling: false,
	pinnedToBottom: true,
	pointerScrolling: false,
	scrollTop: 0,
};
const bottomScrollTimers = new Set();
// Timestamp of the last older-history request. Trim gives a freshly prepended
// page a grace period so jumping straight to the live edge cannot eat it back.
// A timestamp cannot stick like a flag: the worst case is one skipped trim.
const trimLoadGraceMs = 1500;
let lastOlderLoadAt = 0;
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
			// changes alone never re-arm following; any downward scroll that reaches
			// the live edge does, whatever gesture produced it.
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
				)
			) {
				state.pinnedToBottom = true;
				// Follow mode drives scrollTop itself; native anchoring would fight it.
				messages.style.overflowAnchor = "none";
				messages.scrollTop = messages.scrollHeight;
				trimOldMessages();
			}
			state.scrollTop = messages.scrollTop;
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
				// Middle-button intent is global (autoscroll, X11 paste), so releasing
				// the button must drop it. Otherwise a later layout clamp during
				// streaming reads as an upward scroll and silently unpins follow mode.
				state.middleScrolling = false;
				state.pointerScrolling = false;
				pointerStart = undefined;
			},
			{ capture: true, passive: true },
		);
	}
	document.addEventListener(
		"wheel",
		(event) => {
			if (!isMessageInteraction(event.target)) return;
			state.middleScrolling = false;
			if (event.deltaY < 0) markUnpinned();
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

// Prepended history is above the viewport by construction, so native scroll
// anchoring holds the reader's position with no manual math. Trim only needs
// a grace period after a load starts so jumping straight to the live edge
// cannot eat the incoming page back.
export function noteOlderLoad() {
	lastOlderLoadAt = performance.now();
	return lastOlderLoadAt;
}

export function trimOldMessages() {
	if (!state.pinnedToBottom) return;
	if (performance.now() - lastOlderLoadAt < trimLoadGraceMs) return;
	const messages = document.getElementById("messages");
	const trigger = document.getElementById("messages-trim");
	if (!(messages instanceof HTMLElement) || !(trigger instanceof HTMLButtonElement))
		return;
	const messageElements = document.querySelectorAll(
		"#message-list > [data-message-id]",
	);
	const excess = messageElements.length - 100;
	const lastCandidate = messageElements[excess - 1];
	if (
		!lastCandidate ||
		!shouldTrimOldMessages(
			excess,
			lastCandidate.getBoundingClientRect().bottom,
			messages.getBoundingClientRect().top,
		)
	)
		return;
	trigger.click();
}

export function shouldTrimOldMessages(excess, candidateBottom, viewportTop) {
	return excess > 0 && candidateBottom <= viewportTop;
}

export function hasPointerDragIntent(startX, startY, currentX, currentY) {
	return Math.hypot(currentX - startX, currentY - startY) >= 8;
}

export function shouldRearmAfterScroll(wasPinned, previousTop, scrollTop, distance) {
	return !wasPinned && scrollTop > previousTop && distance <= liveEdgeThresholdPx;
}

export function scrollBottom(behavior = "auto") {
	clearBottomScrollTimers();
	state.middleScrolling = false;
	state.pinnedToBottom = true;
	state.pointerScrolling = false;
	const scroll = () => {
		const messages = document.getElementById("messages");
		if (!(messages instanceof HTMLElement) || !state.pinnedToBottom) return;
		// Follow mode drives scrollTop itself; native anchoring would fight it.
		messages.style.overflowAnchor = "none";
		messages.scrollTo({ top: messages.scrollHeight, behavior });
		updateScrollControl();
	};
	scroll();
	trimOldMessages();
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
	const messages = document.getElementById("messages");
	if (messages instanceof HTMLElement) {
		// Reading mode lets native anchoring hold the viewport across content
		// shifts above it. History restores manage their own window.
		messages.style.removeProperty("overflow-anchor");
		state.scrollTop = messages.scrollTop;
	}
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
		if (messages instanceof HTMLElement && state.pinnedToBottom) {
			messages.style.overflowAnchor = "none";
			messages.scrollTop = messages.scrollHeight;
		}
		updateScrollControl();
		trimOldMessages();
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
	// Replace so a repeated hydrate (double insert, declarative shadow race)
	// never duplicates the diff content.
	const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
	shadow.replaceChildren(template.content.cloneNode(true));
	template.remove();
}
