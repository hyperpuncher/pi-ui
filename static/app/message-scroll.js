const liveEdgeThresholdPx = 8;
const promptSpacerClearancePx = 48;
const scrollControlThresholdPx = 48;
// Space left above a user message after a jump to it.
const userRowOffsetPx = 16;
const followTimeConstantMs = 60;
// A busy main thread delays frames. Count at most one 30 fps frame per step,
// so a stall slows the follow down instead of turning it into a jump.
const maxFollowFrameMs = 1000 / 30;
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
let heldRow;
// A previous-user jump waits for an older page when no user message is loaded above.
let previousUserPending = false;
let followFrame;
let followTarget = 0;
let olderCheckTimer;
let reducedMotion;
// Reading positions of the sessions this page left, by session key.
const sessionPositions = new Map();

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
	// A layout change such as a display mode toggle moves the bottom by more than
	// a viewport. Animating that would scroll through unrelated content.
	if (
		reducedMotion.matches ||
		Math.abs(target - messages.scrollTop) > messages.clientHeight
	) {
		messages.scrollTop = target;
		state.scrollTop = messages.scrollTop;
		trimOldMessages();
		return;
	}
	let previousTime = performance.now();
	// Keep fractional progress even though displayed positions use whole pixels.
	let position = messages.scrollTop;
	const step = (time) => {
		followFrame = undefined;
		if (!state.pinnedToBottom || document.hidden || !messages.isConnected) return;
		const elapsed = Math.min(maxFollowFrameMs, Math.max(0, time - previousTime));
		const amount = 1 - Math.exp(-elapsed / followTimeConstantMs);
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

// Older pages and display modes resize rows around the reader, and changed row
// margins suppress native scroll anchoring. The server calls holdPosition before
// the patch and restorePosition after it. Hold the latest user or assistant text
// that starts above the viewport bottom: display modes never hide it, but they
// can change the summary and padding around it inside the row.
export function holdPosition() {
	const messages = document.getElementById("messages");
	// A pinned view keeps the bottom. Keep the first hold until it is restored.
	if (!(messages instanceof HTMLElement) || state.pinnedToBottom || heldRow) return;
	messages.style.overflowAnchor = "none";
	const bottom = messages.getBoundingClientRect().bottom;
	const row = [
		...messages.querySelectorAll(
			"#message-list > .message-user > .message-user-text, #message-list > .message-assistant > .markdown-content",
		),
	].findLast((element) => element.getBoundingClientRect().top < bottom);
	heldRow = row && { row, top: row.getBoundingClientRect().top };
}

// Restore in the next frame: diffs hydrate after the patch, but before paint.
export function restorePosition() {
	requestAnimationFrame(() => {
		const saved = heldRow;
		heldRow = undefined;
		const messages = document.getElementById("messages");
		if (!(messages instanceof HTMLElement)) return;
		if (state.pinnedToBottom) {
			cancelFollow();
			messages.scrollTop = bottomOffset(messages);
		} else if (saved && messages.contains(saved.row)) {
			messages.scrollTop += saved.row.getBoundingClientRect().top - saved.top;
		}
		// A programmatic restore is not downward reader input.
		state.scrollTop = messages.scrollTop;
		setFollowMode(messages, state.pinnedToBottom);
		checkOlder();
		if (previousUserPending) {
			previousUserPending = false;
			scrollPreviousUser();
		}
	});
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
	if (!state.pinnedToBottom || heldRow) return;
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

// Runs before the next session's transcript replaces this one.
export function leaveSession(key) {
	const messages = document.getElementById("messages");
	sessionPositions.delete(key);
	if (state.pinnedToBottom || !(messages instanceof HTMLElement)) return;
	const top = messages.getBoundingClientRect().top;
	const row = messages
		.querySelectorAll("#message-list > .message[id]")
		.values()
		.find((row) => row.getBoundingClientRect().bottom > top);
	if (row)
		sessionPositions.set(key, {
			id: row.id,
			offset: row.getBoundingClientRect().top - top,
		});
}

// Runs after the patch. Only a restored transcript keeps the saved message ids;
// otherwise the session opens at its latest message. Neither case animates.
export function enterSession(key, restored) {
	const saved = sessionPositions.get(key);
	sessionPositions.delete(key);
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return;
	cancelFollow();
	heldRow = undefined;
	previousUserPending = false;
	state.middleScrolling = false;
	state.pointerScrolling = false;
	const row = restored && saved ? document.getElementById(saved.id) : null;
	state.pinnedToBottom = !(row && messages.contains(row));
	setFollowMode(messages, state.pinnedToBottom);
	if (state.pinnedToBottom) messages.scrollTop = bottomOffset(messages);
	else
		messages.scrollTop +=
			row.getBoundingClientRect().top -
			messages.getBoundingClientRect().top -
			saved.offset;
	state.scrollTop = messages.scrollTop;
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
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return;
	setFollowMode(messages, true);
	// The follow animates up to one viewport and jumps over longer distances.
	followBottom(messages, bottomOffset(messages));
	updateScrollControl();
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
	const latest =
		!state.pinnedToBottom &&
		messages.scrollHeight - messages.scrollTop - messages.clientHeight >=
			scrollControlThresholdPx;
	const previous = previousUserRow(messages) !== undefined || hasOlderPage();
	// Always dispatch: the first update can run before Datastar binds the listener.
	// Signals ignore unchanged values.
	document.dispatchEvent(
		new CustomEvent("pi-ui-scroll-controls-changed", {
			detail: { latest, previous },
		}),
	);
}

function userRows(messages) {
	return messages.querySelectorAll("#message-list > .message-user").values().toArray();
}

// The nearest user message whose top is above the viewport.
function previousUserRow(messages) {
	const top = messages.getBoundingClientRect().top;
	return userRows(messages).findLast((row) => row.getBoundingClientRect().top < top);
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
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return;
	const row = previousUserRow(messages);
	if (row) {
		scrollToUserRow(messages, row);
	} else if (hasOlderPage()) {
		// Load older pages until one has a user message; restorePosition retries.
		previousUserPending = true;
		document
			.getElementById("older-messages-trigger")
			.dispatchEvent(new CustomEvent("pi-ui-older"));
	}
}

// Jumps to the next user message below the one at the top, or to the latest message.
export function scrollNextUser() {
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return;
	const top = messages.getBoundingClientRect().top + userRowOffsetPx + 1;
	const row = userRows(messages).find((row) => row.getBoundingClientRect().top > top);
	if (row) scrollToUserRow(messages, row);
	else scrollBottom();
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
