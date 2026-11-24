const liveEdgeThresholdPx = 8;
const scrollControlThresholdPx = 48;
// Space left above a user message after a jump to it.
const userRowOffsetPx = 16;
const trimmedMessageLimit = 50;
const followTimeConstantMs = 60;
// Count at most one 30 fps frame per step so a main-thread stall slows follow
// down instead of turning it into a jump.
const maxFollowFrameMs = 1000 / 30;

const state = {
	middleScrolling: false,
	pinnedToBottom: true,
	pointerScrolling: false,
	scrollTop: 0,
};

let observedStack;
let observedPrompt;
let resizeObserver;
let pointerStart;
let heldRow;
let previousUserPending = false;
let followFrame;
let followTarget = 0;
let sessionSettling = false;
let sessionSettleFrame;
let scrollControlFrame;
let reducedMotion;
const sessionPositions = new Map();

function messagesEl() {
	const el = document.getElementById("messages");
	return el instanceof HTMLElement ? el : undefined;
}

function bottomOffset(messages) {
	return Math.max(0, messages.scrollHeight - messages.clientHeight);
}

function cancelFollow() {
	if (followFrame !== undefined) cancelAnimationFrame(followFrame);
	followFrame = undefined;
}

function cancelSessionSettle() {
	if (sessionSettleFrame !== undefined) cancelAnimationFrame(sessionSettleFrame);
	sessionSettleFrame = undefined;
	sessionSettling = false;
}

// Follow mode drives scrollTop itself; native anchoring would fight it, so
// overflow-anchor is off while pinned and back on while reading.
function setFollowMode(messages, enabled) {
	if (enabled) messages.style.overflowAnchor = "none";
	else messages.style.removeProperty("overflow-anchor");
}

function snapBottom(messages) {
	cancelFollow();
	messages.scrollTop = bottomOffset(messages);
	state.scrollTop = messages.scrollTop;
}

// The target is measured by the resize observer, not each frame: reading
// scrollHeight after a streamed DOM update would force layout every frame.
function followBottom(messages, target) {
	followTarget = target;
	if (followFrame !== undefined || document.hidden) return;
	reducedMotion ??= window.matchMedia("(prefers-reduced-motion: reduce)");
	const distance = Math.abs(target - messages.scrollTop);
	if (reducedMotion.matches || distance <= 1 || distance > messages.clientHeight) {
		messages.scrollTop = target;
		state.scrollTop = messages.scrollTop;
		trimOldMessages();
		return;
	}
	let previousTime = performance.now();
	let position = messages.scrollTop;
	const step = (time) => {
		followFrame = undefined;
		if (!state.pinnedToBottom || document.hidden || !messages.isConnected) return;
		const elapsed = Math.min(maxFollowFrameMs, Math.max(0, time - previousTime));
		position +=
			(followTarget - position) * (1 - Math.exp(-elapsed / followTimeConstantMs));
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

// Hold the latest visible user or assistant text before older-page or display-mode patches.
export function holdPosition() {
	const messages = messagesEl();
	if (!messages || state.pinnedToBottom || heldRow) return;
	messages.style.overflowAnchor = "none";
	const bottom = messages.getBoundingClientRect().bottom;
	const row = [
		...messages.querySelectorAll(
			"#message-list > .message-user > .message-user-text, #message-list > .message-assistant > .markdown-content",
		),
	].findLast((element) => element.getBoundingClientRect().top < bottom);
	heldRow = row && { row, top: row.getBoundingClientRect().top };
}

// Restore in the next frame: diffs hydrate after the patch, before paint.
export function restorePosition() {
	requestAnimationFrame(() => {
		const saved = heldRow;
		heldRow = undefined;
		const messages = messagesEl();
		if (!messages) return;
		if (state.pinnedToBottom) {
			snapBottom(messages);
		} else if (saved && messages.contains(saved.row)) {
			messages.scrollTop += saved.row.getBoundingClientRect().top - saved.top;
			state.scrollTop = messages.scrollTop;
		}
		setFollowMode(messages, state.pinnedToBottom);
		if (previousUserPending) {
			previousUserPending = false;
			scrollPreviousUser();
		}
	});
}

function trimOldMessages() {
	if (!state.pinnedToBottom || heldRow || followFrame !== undefined || sessionSettling)
		return;
	const messages = messagesEl();
	if (!messages) return;
	const rows = [...messages.querySelectorAll("#message-list > .message[id]")];
	const excess = rows.length - trimmedMessageLimit;
	if (excess <= 0 || messages.scrollTop <= 2 * messages.clientHeight) return;
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
			const messages = messagesEl();
			if (!messages || event.target !== messages) return;
			if (
				(state.middleScrolling || state.pointerScrolling) &&
				messages.scrollTop < state.scrollTop
			) {
				markUnpinned();
			}
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
			}
			state.scrollTop = messages.scrollTop;
			scheduleScrollControlUpdate();
		},
		{ capture: true, passive: true },
	);
	document.addEventListener(
		"scrollend",
		(event) => {
			if (event.target === messagesEl()) trimOldMessages();
		},
		{ capture: true, passive: true },
	);

	// Release follow mode only from explicit reader gestures, never from layout changes.
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (event.button === 1) {
				state.middleScrolling = true;
				markUnpinned();
			} else if (event.button === 0 && isMessageInteraction(event.target)) {
				state.middleScrolling = false;
				state.pointerScrolling = true;
				pointerStart = { x: event.clientX, y: event.clientY };
				const messages = messagesEl();
				if (messages) state.scrollTop = messages.scrollTop;
			}
		},
		{ capture: true, passive: true },
	);
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
		const messages = messagesEl();
		if (!document.hidden && state.pinnedToBottom && messages)
			followBottom(messages, bottomOffset(messages));
	});

	bindMessageResize();
	scrollBottom();
}

export function leaveSession(key) {
	cancelSessionSettle();
	const messages = messagesEl();
	sessionPositions.delete(key);
	if (state.pinnedToBottom || !messages) return;
	const top = messages.getBoundingClientRect().top;
	const row = messages
		.querySelectorAll("#message-list > .message[id]")
		.values()
		.find((el) => el.getBoundingClientRect().bottom > top);
	if (row)
		sessionPositions.set(key, {
			id: row.id,
			offset: row.getBoundingClientRect().top - top,
		});
}

export function enterSession(key, restored) {
	const saved = sessionPositions.get(key);
	sessionPositions.delete(key);
	const messages = messagesEl();
	if (!messages) return;
	cancelFollow();
	cancelSessionSettle();
	heldRow = undefined;
	previousUserPending = false;
	state.middleScrolling = false;
	state.pointerScrolling = false;
	const row = restored && saved ? document.getElementById(saved.id) : null;
	state.pinnedToBottom = !(row && messages.contains(row));
	setFollowMode(messages, state.pinnedToBottom);
	if (state.pinnedToBottom) {
		snapBottom(messages);
		// Diff hydration and prompt draft/layout updates settle in this frame's
		// ResizeObserver; keep bottom snapping instant until after that paint.
		sessionSettling = true;
		sessionSettleFrame = requestAnimationFrame(() => {
			syncPromptHeight();
			const current = messagesEl();
			if (current && state.pinnedToBottom) snapBottom(current);
			sessionSettleFrame = requestAnimationFrame(() => {
				sessionSettleFrame = undefined;
				sessionSettling = false;
				trimOldMessages();
			});
		});
	} else {
		messages.scrollTop +=
			row.getBoundingClientRect().top -
			messages.getBoundingClientRect().top -
			saved.offset;
		state.scrollTop = messages.scrollTop;
	}
	updateScrollControl();
}

export function hasPointerDragIntent(startX, startY, currentX, currentY) {
	return Math.hypot(currentX - startX, currentY - startY) >= 8;
}

export function shouldRearmAfterScroll(previousTop, scrollTop, distance) {
	return scrollTop > previousTop && distance <= liveEdgeThresholdPx;
}

export function scrollBottom() {
	cancelFollow();
	state.middleScrolling = false;
	state.pinnedToBottom = true;
	state.pointerScrolling = false;
	const messages = messagesEl();
	if (!messages) return;
	setFollowMode(messages, true);
	followBottom(messages, bottomOffset(messages));
	updateScrollControl();
}

export function markUnpinned() {
	cancelFollow();
	cancelSessionSettle();
	state.pinnedToBottom = false;
	const messages = messagesEl();
	if (messages) {
		messages.scrollTo({ top: messages.scrollTop, behavior: "instant" });
		setFollowMode(messages, false);
	}
	updateScrollControl();
}

function isMessageInteraction(target) {
	const messages = messagesEl();
	return Boolean(messages && target instanceof Node && messages.contains(target));
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
	const messages = messagesEl();
	if (!stack || !prompt || !messages) return;
	if (stack === observedStack && prompt === observedPrompt) return;
	resizeObserver ??= new ResizeObserver(() => {
		syncPromptHeight();
		const current = messagesEl();
		if (current && state.pinnedToBottom) {
			setFollowMode(current, true);
			if (sessionSettling) snapBottom(current);
			else followBottom(current, bottomOffset(current));
		}
		scheduleScrollControlUpdate();
	});
	resizeObserver.disconnect();
	observedStack = stack;
	observedPrompt = prompt;
	resizeObserver.observe(stack);
	resizeObserver.observe(prompt);
	resizeObserver.observe(messages);
}

function syncPromptHeight() {
	const prompt = document.getElementById("prompt-box");
	const spacer = document.getElementById("messages-prompt-spacer");
	if (!(prompt instanceof HTMLElement) || !(spacer instanceof HTMLElement)) return;
	const value = `${prompt.offsetHeight}px`;
	if (spacer.style.getPropertyValue("--prompt-height") !== value)
		spacer.style.setProperty("--prompt-height", value);
}

function scheduleScrollControlUpdate() {
	if (scrollControlFrame !== undefined) return;
	scrollControlFrame = requestAnimationFrame(() => {
		scrollControlFrame = undefined;
		updateScrollControl();
	});
}

function updateScrollControl() {
	const messages = messagesEl();
	if (!messages) return;
	const latest =
		!state.pinnedToBottom &&
		messages.scrollHeight - messages.scrollTop - messages.clientHeight >=
			scrollControlThresholdPx;
	const previous = hasOlderPage() || previousUserRow(messages) !== undefined;
	const latestButton = document.getElementById("messages-latest");
	const previousButton = document.getElementById("messages-previous-user");
	if (latestButton instanceof HTMLElement && latestButton.inert === latest)
		latestButton.inert = !latest;
	if (previousButton instanceof HTMLElement && previousButton.inert === previous)
		previousButton.inert = !previous;
}

function previousUserRow(messages) {
	const top = messages.getBoundingClientRect().top;
	const rows = messages.querySelectorAll("#message-list > .message-user");
	for (let index = rows.length - 1; index >= 0; index -= 1) {
		if (rows[index].getBoundingClientRect().top < top) return rows[index];
	}
	return undefined;
}

function scrollToUserRow(messages, row) {
	markUnpinned();
	messages.scrollTop +=
		row.getBoundingClientRect().top -
		messages.getBoundingClientRect().top -
		userRowOffsetPx;
}

function hasOlderPage() {
	return (
		document.getElementById("older-messages-trigger")?.hasAttribute("data-active") ??
		false
	);
}

export function scrollPreviousUser() {
	const messages = messagesEl();
	if (!messages) return;
	const row = previousUserRow(messages);
	if (row) {
		scrollToUserRow(messages, row);
	} else if (hasOlderPage()) {
		previousUserPending = true;
		document
			.getElementById("older-messages-trigger")
			?.dispatchEvent(new CustomEvent("pi-ui-older"));
	}
}

export function scrollNextUser() {
	const messages = messagesEl();
	if (!messages) return;
	const top = messages.getBoundingClientRect().top + userRowOffsetPx + 1;
	for (const row of messages.querySelectorAll("#message-list > .message-user")) {
		if (row.getBoundingClientRect().top > top) {
			scrollToUserRow(messages, row);
			return;
		}
	}
	scrollBottom();
}
