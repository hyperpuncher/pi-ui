import { markUnpinned, scrollBottom } from "./message-scroll.js";

const stepPx = 100;
const stepDurationMs = 120;
const firstFrameMs = 17;
const maxFrameElapsedMs = 1000 / 30;
let animation;
let target;
let lastFrame = 0;
let direction = 0;
let keyHeld = false;
let delta = 0;
let remainder = 0;

export function bindVimScroll() {
	let pendingG = false;
	document.addEventListener("keydown", (event) => {
		if (
			event.defaultPrevented ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			isTextInputEvent(event)
		) {
			pendingG = false;
			return;
		}
		if (document.querySelector("dialog[open]")) return;
		if (pendingG) {
			pendingG = false;
			if (event.code === "KeyG" && !event.shiftKey) {
				event.preventDefault();
				scrollTo("top");
				return;
			}
		}
		if (event.code === "KeyG" && !event.shiftKey) {
			event.preventDefault();
			pendingG = true;
		} else if (event.code === "KeyG" && event.shiftKey) {
			event.preventDefault();
			scrollTo("bottom");
		} else if (event.code === "KeyJ" || event.code === "KeyK") {
			event.preventDefault();
			scrollBy(event.code === "KeyJ" ? stepPx : -stepPx);
		}
	});
	document.addEventListener("keyup", (event) => {
		if (event.code === "KeyJ" || event.code === "KeyK") keyHeld = false;
	});
}

function isTextInputEvent(event) {
	return isTextInput(event.composedPath()[0]);
}

function isTextInput(target) {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	);
}

function scrollBy(amount) {
	if (animation && target !== undefined) {
		cancelAnimationFrame(animation);
		animation = undefined;
		target = undefined;
	}
	const nextDirection = Math.sign(amount);
	if (!animation || direction !== nextDirection) {
		direction = nextDirection;
		delta = 0;
		remainder = 0;
		lastFrame = 0;
	}
	keyHeld = true;
	startLineScroll();
	markUnpinned();
}

function scrollTo(position) {
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement)) return;
	direction = 0;
	keyHeld = false;
	target = position === "top" ? 0 : messages.scrollHeight - messages.clientHeight;
	startTargetScroll(position);
	if (position === "top") markUnpinned();
}

function startLineScroll() {
	if (animation) return;
	const tick = (now) => {
		const messages = document.getElementById("messages");
		if (!(messages instanceof HTMLElement) || !direction) {
			animation = undefined;
			return;
		}
		const elapsed = lastFrame
			? Math.min(Math.max(now - lastFrame, 0), maxFrameElapsedMs)
			: firstFrameMs;
		lastFrame = now;
		const max = messages.scrollHeight - messages.clientHeight;
		const wanted = direction * ((stepPx * elapsed) / stepDurationMs) + remainder;
		const before = messages.scrollTop;
		const next = Math.max(0, Math.min(before + wanted, max));
		messages.scrollTop = next;
		const actual = next - before;
		remainder = wanted - actual;
		delta += Math.abs(actual);
		if (next === 0 || next === max || (!keyHeld && delta >= stepPx)) {
			direction = 0;
			delta = 0;
			remainder = 0;
			animation = undefined;
			return;
		}
		animation = requestAnimationFrame(tick);
	};
	animation = requestAnimationFrame(tick);
}

function startTargetScroll(position) {
	if (animation) cancelAnimationFrame(animation);
	const messages = document.getElementById("messages");
	if (!(messages instanceof HTMLElement) || target === undefined) return;
	const start = messages.scrollTop;
	const fixedTarget = Math.max(
		0,
		Math.min(target, messages.scrollHeight - messages.clientHeight),
	);
	const duration = Math.max(
		stepDurationMs,
		20 * Math.log(Math.max(Math.abs(fixedTarget - start), 1)),
	);
	let elapsedTotal = 0;
	let lastFrame = 0;
	const tick = (now) => {
		const current = document.getElementById("messages");
		if (!(current instanceof HTMLElement) || target === undefined) {
			animation = undefined;
			return;
		}
		const elapsed = lastFrame ? now - lastFrame : 16.7;
		lastFrame = now;
		elapsedTotal += elapsed;
		const progress = Math.min(1, elapsedTotal / duration);
		current.scrollTop = start + (fixedTarget - start) * progress;
		if (progress >= 1) {
			target = undefined;
			animation = undefined;
			if (position === "bottom") scrollBottom();
			return;
		}
		animation = requestAnimationFrame(tick);
	};
	animation = requestAnimationFrame(tick);
}
