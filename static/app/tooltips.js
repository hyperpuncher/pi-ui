const triggerSelector = "[data-tooltip]";
const contentSelector = '[data-slot="tooltip-content"]';

/** Shows tooltips as top-layer popovers so they stay above panels and inside the viewport. */
export function bindTooltips() {
	if (!("popover" in HTMLElement.prototype)) return;
	document.addEventListener("pointerover", (event) => {
		if (event.pointerType === "touch") return;
		showTooltip(event.target);
	});
	document.addEventListener("pointerout", (event) => {
		hideTooltip(event.target, event.relatedTarget);
	});
	document.addEventListener("focusin", (event) => {
		const trigger = tooltipTrigger(event.target);
		if (!trigger) return;
		// Keyboard focus shows every tooltip; usage indicators also reveal on tap.
		if (!trigger.matches(":focus-visible") && !isUsageTrigger(trigger)) return;
		showTooltip(trigger);
	});
	document.addEventListener("focusout", (event) => {
		hideTooltip(event.target, event.relatedTarget);
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") hideTooltips();
	});
}

function tooltipTrigger(target) {
	return target instanceof Element
		? (target.closest(triggerSelector) ?? undefined)
		: undefined;
}

function tooltipContent(trigger) {
	const content = trigger?.querySelector(contentSelector);
	return content instanceof HTMLElement ? content : undefined;
}

function isUsageTrigger(trigger) {
	return tooltipContent(trigger)?.classList.contains("usage-tooltip") === true;
}

function showTooltip(target) {
	const trigger = tooltipTrigger(target);
	const content = tooltipContent(trigger);
	if (!content || content.matches(":popover-open")) return;
	content.showPopover();
}

function hideTooltip(target, related) {
	const content = tooltipContent(tooltipTrigger(target));
	if (!content?.matches(":popover-open")) return;
	if (related instanceof Node && content.contains(related)) return;
	content.hidePopover();
}

function hideTooltips() {
	for (const content of document.querySelectorAll(`${contentSelector}:popover-open`)) {
		if (content instanceof HTMLElement) content.hidePopover();
	}
}
