import { markUnpinned, scrollBottom } from "./message-scroll.js";
import { focusPromptEnd } from "./prompt.js";

const stepPx = 100;
const stepDurationMs = 120;
const frameMs = 1000 / 144;
let animation;
let target;
let targetPosition;
let lastFrame = 0;
let direction = 0;
let keyHeld = false;
let delta = 0;
let remainder = 0;

export function bindVimScroll() {
	let pendingG = false;
	document.addEventListener("keydown", (event) => {
		if (event.ctrlKey || event.metaKey || event.altKey || isTextInputFocused())
			return;
		if (document.querySelector("dialog[open]")) return;
		if (pendingG) {
			pendingG = false;
			if (event.key === "g") {
				event.preventDefault();
				scrollTo("top");
				return;
			}
			if (event.key === "i") {
				event.preventDefault();
				focusPromptEnd();
				return;
			}
		}
		if (event.key === "g") {
			event.preventDefault();
			pendingG = true;
		} else if (event.key === "G") {
			event.preventDefault();
			scrollTo("bottom");
		} else if (event.key === "j" || event.key === "k") {
			event.preventDefault();
			scrollBy(event.key === "j" ? 100 : -100);
		}
	});
	document.addEventListener("keyup", (event) => {
		if (event.key === "j" || event.key === "k") keyHeld = false;
	});
}

function isTextInputFocused() {
	const active = document.activeElement;
	return (
		active instanceof HTMLInputElement ||
		active instanceof HTMLTextAreaElement ||
		active instanceof HTMLSelectElement ||
		active?.isContentEditable === true
	);
}

function scrollBy(amount) {
	if (animation && target !== undefined) {
		cancelAnimationFrame(animation);
		animation = undefined;
		target = undefined;
		targetPosition = undefined;
	}
	const nextDirection = Math.sign(amount);
	if (!animation || direction !== nextDirection) {
		direction = nextDirection;
		delta = 0;
		remainder = 0;
		lastFrame = performance.now();
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
	targetPosition = position;
	target = position === "top" ? 0 : messages.scrollHeight - messages.clientHeight;
	startTargetScroll();
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
		const elapsed = Math.min(Math.max(now - lastFrame, 0), frameMs);
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

function startTargetScroll() {
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
	lastFrame = 0;
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
		const currentTarget =
			targetPosition === "bottom"
				? current.scrollHeight - current.clientHeight
				: fixedTarget;
		current.scrollTop = start + (currentTarget - start) * progress;
		if (progress >= 1) {
			if (targetPosition === "bottom") scrollBottom();
			target = undefined;
			targetPosition = undefined;
			animation = undefined;
			return;
		}
		animation = requestAnimationFrame(tick);
	};
	animation = requestAnimationFrame(tick);
}
