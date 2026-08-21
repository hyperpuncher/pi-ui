export const sessionSidebarWidthDefault = 288;
export const sessionSidebarWidthMin = 224;
export const sessionSidebarWidthMax = 480;

const storageKey = "pi-ui-session-sidebar-width";
const guardedSeparators = new WeakSet();
let resizeBound = false;

export function clampSessionSidebarWidth(width, viewportWidth = innerWidth) {
	const maximum = Math.max(
		sessionSidebarWidthMin,
		Math.min(sessionSidebarWidthMax, viewportWidth * 0.5),
	);
	return Math.round(Math.min(maximum, Math.max(sessionSidebarWidthMin, width)));
}

export function isSessionSidebarToggleShortcut(event, mac = isMac()) {
	if (event.code !== "KeyB" || event.altKey || event.shiftKey) return false;
	return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

export function promoteSessionRow(rowId) {
	const row = document.getElementById(rowId);
	const content = document.getElementById("session-sidebar-content");
	const section = content?.closest("section");
	if (
		!(row instanceof HTMLLIElement) ||
		!(content instanceof HTMLElement) ||
		!(section instanceof HTMLElement)
	)
		return;

	let target = content.querySelector("[data-session-promotions] > ul");
	if (!(target instanceof HTMLUListElement)) {
		const group = document.createElement("div");
		group.dataset.sessionPromotions = "";
		target = document.createElement("ul");
		group.append(target);
		content.prepend(group);
	}
	if (target.firstElementChild === row) return;

	const previousList = row.parentElement;
	const previousGroup = previousList?.parentElement;
	const sectionTop = section.getBoundingClientRect().top;
	const anchor = [...content.querySelectorAll("li[id]")].find(
		(candidate) =>
			candidate !== row && candidate.getBoundingClientRect().bottom > sectionTop,
	);
	const anchorTop = anchor?.getBoundingClientRect().top;
	target.prepend(row);
	if (previousList?.childElementCount === 0) previousGroup?.remove();
	if (section.scrollTop > 0 && anchorTop !== undefined && anchor) {
		section.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
	}
}

export function bindSessionSidebarResize() {
	if (resizeBound) return;
	resizeBound = true;

	let width = clampSessionSidebarWidth(readStoredWidth());
	let pointerId;
	let capturedSeparator;
	let startX = 0;
	let startWidth = width;
	const desktop = matchMedia("(min-width: 48rem)");

	const apply = (next) => {
		width = clampSessionSidebarWidth(next);
		const elements = sessionSidebarElements();
		if (!elements) return;
		const { nav, separator, sidebar, workspaceShell } = elements;
		separator.dataset.resizeInitialized = "true";
		if (!guardedSeparators.has(separator)) {
			guardedSeparators.add(separator);
			separator.addEventListener("click", (event) => event.stopPropagation());
		}
		separator.setAttribute("aria-valuenow", String(width));
		const open = sidebar.getAttribute("aria-hidden") !== "true";
		separator.hidden = !open;
		if (!desktop.matches || !open) {
			workspaceShell.style.removeProperty("margin-right");
			if (!desktop.matches) {
				nav.style.removeProperty("width");
				separator.style.removeProperty("right");
			}
			return;
		}
		const gap = separator.getBoundingClientRect().width || 12;
		const rightInset = innerWidth - nav.getBoundingClientRect().right;
		nav.style.width = `${width - gap}px`;
		workspaceShell.style.marginRight = `${width}px`;
		separator.style.right = `${rightInset + width - gap}px`;
	};
	const commit = () => localStorage.setItem(storageKey, String(width));
	const finish = (event) => {
		if (pointerId === undefined || event.pointerId !== pointerId) return;
		capturedSeparator?.releasePointerCapture?.(pointerId);
		pointerId = undefined;
		capturedSeparator = undefined;
		document.documentElement.classList.remove("pi-resizing");
		commit();
	};

	apply(width);
	document.addEventListener("pointerdown", (event) => {
		const separator = eventSeparator(event);
		if (!separator || event.button !== 0) return;
		pointerId = event.pointerId;
		capturedSeparator = separator;
		startX = event.clientX;
		startWidth = width;
		separator.setPointerCapture(pointerId);
		document.documentElement.classList.add("pi-resizing");
		event.preventDefault();
	});
	document.addEventListener("pointermove", (event) => {
		if (event.pointerId !== pointerId) return;
		apply(startWidth + startX - event.clientX);
	});
	document.addEventListener("pointerup", finish);
	document.addEventListener("pointercancel", finish);
	document.addEventListener("dblclick", (event) => {
		if (!eventSeparator(event)) return;
		apply(sessionSidebarWidthDefault);
		commit();
	});
	document.addEventListener("keydown", (event) => {
		if (eventSeparator(event)) {
			const step = event.shiftKey ? 48 : 16;
			if (event.key === "ArrowLeft") apply(width + step);
			else if (event.key === "ArrowRight") apply(width - step);
			else if (event.key === "Home") apply(sessionSidebarWidthMin);
			else if (event.key === "End") apply(sessionSidebarWidthMax);
			else return;
			event.preventDefault();
			commit();
			return;
		}
		if (!isSessionSidebarToggleShortcut(event)) return;
		event.preventDefault();
		document.getElementById("session-sidebar")?.toggle?.();
	});
	const app = document.getElementById("app");
	if (app) {
		new MutationObserver(() => apply(width)).observe(app, {
			attributeFilter: ["aria-hidden"],
			attributes: true,
			childList: true,
			subtree: true,
		});
	}
	addEventListener("resize", () => apply(width), { passive: true });
}

function eventSeparator(event) {
	return event.target instanceof Element
		? event.target.closest("#session-sidebar-separator")
		: null;
}

function sessionSidebarElements() {
	const sidebar = document.getElementById("session-sidebar");
	const nav = document.querySelector("#session-sidebar nav");
	const separator = document.getElementById("session-sidebar-separator");
	const workspaceShell = document.getElementById("workspace-shell");
	return sidebar instanceof HTMLElement &&
		nav instanceof HTMLElement &&
		separator instanceof HTMLElement &&
		workspaceShell instanceof HTMLElement
		? { nav, separator, sidebar, workspaceShell }
		: undefined;
}

function isMac() {
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function readStoredWidth() {
	const stored = Number(localStorage.getItem(storageKey));
	return Number.isFinite(stored) && stored > 0 ? stored : sessionSidebarWidthDefault;
}
