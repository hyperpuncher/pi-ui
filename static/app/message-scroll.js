const liveEdgeThresholdPx = 8;
const promptSpacerClearancePx = 48;
const scrollControlThresholdPx = 48;
const followTimeConstantMs = 60;
const state = {
	middleScrolling: false,
	pinnedToBottom: true,
	pointerScrolling: false,
	scrollTop: 0,
};
let observedMessageStack;
let observedPrompt;
let messageResizeObserver;
let pointerStart;
let olderAnchor;
let followFrame;
let followTarget = 0;
let olderCheckTimer;
let reducedMotion;
let latestVisible = false;

function cancelFollow() {
	if (followFrame !== undefined) cancelAnimationFrame(followFrame);
	followFrame = undefined;
}

function bottomOffset(messages) {
	return Math.max(0, messages.scrollHeight - messages.clientHeight);
}

// The target is measured by the resize observer, not each frame: reading
// scrollHeight after a streamed DOM update would force layout every frame.
function followBottom(messages, target) {
	followTarget = target;
	if (followFrame !== undefined || document.hidden) return;
	reducedMotion ??= window.matchMedia("(prefers-reduced-motion: reduce)");
	if (reducedMotion.matches) {
		messages.scrollTop = target;
		state.scrollTop = messages.scrollTop;
		return;
	}
	let previousTime = performance.now();
	// Keep fractional progress even though displayed positions use whole pixels.
	let position = messages.scrollTop;
	const step = (time) => {
		followFrame = undefined;
		if (!state.pinnedToBottom || document.hidden || !messages.isConnected) return;
		const amount =
			1 - Math.exp(-Math.max(0, time - previousTime) / followTimeConstantMs);
		position += (followTarget - position) * amount;
		if (reducedMotion.matches || followTarget - position <= 1)
			position = followTarget;
		messages.scrollTo({ top: Math.round(position), behavior: "instant" });
		state.scrollTop = messages.scrollTop;
		previousTime = time;
		if (position !== followTarget) followFrame = requestAnimationFrame(step);
		else trimOldMessages();
	};
	followFrame = requestAnimationFrame(step);
}

// Capture immediately before the DOM patch, not when the request starts:
// the reader can keep scrolling while the network request is in flight.
export function beforeOlder() {
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return;
	markUnpinned();
	messages.style.overflowAnchor = "none";
	const viewportTop = messages.getBoundingClientRect().top;
	const row = [...messages.querySelectorAll("#message-list > .message[id]")].find(
		(element) => {
			const rect = element.getBoundingClientRect();
			return rect.height > 0 && rect.bottom > viewportTop;
		},
	);
	olderAnchor = row && { messages, row, top: row.getBoundingClientRect().top };
}

export function afterOlder() {
	const saved = olderAnchor;
	olderAnchor = undefined;
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return;
	if (saved?.messages === messages && messages.contains(saved.row)) {
		messages.scrollTop += saved.row.getBoundingClientRect().top - saved.top;
		// A programmatic restore is not downward reader input.
		state.scrollTop = messages.scrollTop;
	}
	setFollowMode(messages, state.pinnedToBottom);
	checkOlder();
}

// Follow mode drives scrollTop itself; native anchoring would fight it, so
// the platform hold is off while pinned and back on while reading.
function setFollowMode(messages, enabled) {
	if (enabled) messages.style.overflowAnchor = "none";
	else messages.style.removeProperty("overflow-anchor");
}

export function checkOlder() {
	// Follow scrolls are not reader movement toward older history.
	if (followFrame !== undefined || olderCheckTimer !== undefined) return;
	olderCheckTimer = setTimeout(() => {
		olderCheckTimer = undefined;
		const messages = document.getElementById("messages");
		const trigger = document.getElementById("older-messages-trigger");
		if (!(messages instanceof HTMLElement) || !trigger?.hasAttribute("data-active"))
			return;
		if (messages.scrollTop > 2 * messages.clientHeight) return;
		trigger.dispatchEvent(new CustomEvent("pi-ui-older"));
	}, 0);
}

function trimOldMessages() {
	if (!state.pinnedToBottom || olderAnchor) return;
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return;
	const rows = [...messages.querySelectorAll("#message-list > .message[id]")];
	const excess = rows.length - 100;
	if (excess <= 0 || messages.scrollTop <= 2 * messages.clientHeight) return;
	// Keep the preload area as well as the viewport. Otherwise cleanup would
	// immediately load the removed page again.
	const cutoff = messages.getBoundingClientRect().top - 2 * messages.clientHeight;
	for (const row of rows.slice(0, excess)) {
		const rect = row.getBoundingClientRect();
		if (rect.height > 0 && rect.bottom >= cutoff) return;
	}
	messages.dispatchEvent(
		new CustomEvent("pi-ui-trim", {
			detail: {
				firstId: rows[0].id.slice("message-".length),
				throughId: rows[excess - 1].id.slice("message-".length),
			},
		}),
	);
}

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
			if (
				!state.pinnedToBottom &&
				shouldRearmAfterScroll(
					state.scrollTop,
					messages.scrollTop,
					messages.scrollHeight - messages.scrollTop - messages.clientHeight,
				)
			) {
				state.pinnedToBottom = true;
				setFollowMode(messages, true);
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

	document.addEventListener("visibilitychange", () => {
		cancelFollow();
		const messages = document.getElementById("messages");
		if (!document.hidden && state.pinnedToBottom && messages instanceof HTMLElement)
			followBottom(messages, bottomOffset(messages));
	});

	bindMessageResize();
	scrollBottom();
}

export function hasPointerDragIntent(startX, startY, currentX, currentY) {
	return Math.hypot(currentX - startX, currentY - startY) >= 8;
}

export function shouldRearmAfterScroll(previousTop, scrollTop, distance) {
	return scrollTop > previousTop && distance <= liveEdgeThresholdPx;
}

export function scrollBottom(behavior = "auto") {
	cancelFollow();
	state.middleScrolling = false;
	state.pinnedToBottom = true;
	state.pointerScrolling = false;
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return;
	setFollowMode(messages, true);
	reducedMotion ??= window.matchMedia("(prefers-reduced-motion: reduce)");
	messages.scrollTo({
		top: messages.scrollHeight,
		behavior: reducedMotion.matches ? "instant" : behavior,
	});
	updateScrollControl();
	trimOldMessages();
}

export function markUnpinned() {
	cancelFollow();
	state.pinnedToBottom = false;
	const messages = document.getElementById("messages");
	if (messages instanceof HTMLElement) {
		// Stop any native follow animation before returning control to the reader.
		messages.scrollTo({ top: messages.scrollTop, behavior: "instant" });
		setFollowMode(messages, false);
	}
	updateScrollControl();
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
	const messages = document.getElementById("messages");
	if (!stack || !prompt || !messages) return;
	if (stack === observedMessageStack && prompt === observedPrompt) return;
	messageResizeObserver ??= new ResizeObserver(() => {
		updatePromptSpacer();
		const messages = document.getElementById("messages");
		if (messages instanceof HTMLElement && state.pinnedToBottom) {
			setFollowMode(messages, true);
			followBottom(messages, bottomOffset(messages));
		}
		updateScrollControl();
		trimOldMessages();
	});
	messageResizeObserver.disconnect();
	observedMessageStack = stack;
	observedPrompt = prompt;
	messageResizeObserver.observe(stack);
	messageResizeObserver.observe(prompt);
	messageResizeObserver.observe(messages);
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
	if (!(messages instanceof HTMLElement)) return;
	const active =
		!state.pinnedToBottom &&
		messages.scrollHeight - messages.scrollTop - messages.clientHeight >=
			scrollControlThresholdPx;
	if (active === latestVisible) return;
	latestVisible = active;
	document.dispatchEvent(new CustomEvent("pi-ui-latest-changed", { detail: active }));
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
