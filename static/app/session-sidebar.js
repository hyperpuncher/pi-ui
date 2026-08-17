export const sessionSidebarWidthDefault = 288;
export const sessionSidebarWidthMin = 224;
export const sessionSidebarWidthMax = 480;

const storageKey = "pi-ui-session-sidebar-width";

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
	const sidebar = document.getElementById("session-sidebar");
	const nav = document.querySelector("#session-sidebar nav");
	const separator = document.getElementById("session-sidebar-separator");
	const workspaceShell = document.getElementById("workspace-shell");
	if (
		!(sidebar instanceof HTMLElement) ||
		!(nav instanceof HTMLElement) ||
		!(separator instanceof HTMLElement) ||
		!(workspaceShell instanceof HTMLElement)
	) {
		return;
	}
	if (separator.dataset.resizeInitialized === "true") return;
	separator.dataset.resizeInitialized = "true";

	let width = clampSessionSidebarWidth(readStoredWidth());
	let pointerId;
	let startX = 0;
	let startWidth = width;
	const gap = separator.getBoundingClientRect().width || 12;
	const desktop = matchMedia("(min-width: 48rem)");
	let rightInset;

	const apply = (next) => {
		width = clampSessionSidebarWidth(next);
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
		rightInset ??= innerWidth - nav.getBoundingClientRect().right;
		nav.style.width = `${width - gap}px`;
		workspaceShell.style.marginRight = `${width}px`;
		separator.style.right = `${rightInset + width - gap}px`;
	};
	const commit = () => localStorage.setItem(storageKey, String(width));
	const finish = (event) => {
		if (pointerId === undefined || event.pointerId !== pointerId) return;
		separator.releasePointerCapture?.(pointerId);
		pointerId = undefined;
		document.documentElement.classList.remove("pi-resizing");
		commit();
	};

	apply(width);
	separator.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		pointerId = event.pointerId;
		startX = event.clientX;
		startWidth = width;
		separator.setPointerCapture(pointerId);
		document.documentElement.classList.add("pi-resizing");
		event.preventDefault();
	});
	separator.addEventListener("pointermove", (event) => {
		if (event.pointerId !== pointerId) return;
		apply(startWidth + startX - event.clientX);
	});
	separator.addEventListener("pointerup", finish);
	separator.addEventListener("pointercancel", finish);
	separator.addEventListener("click", (event) => event.stopPropagation());
	separator.addEventListener("dblclick", () => {
		apply(sessionSidebarWidthDefault);
		commit();
	});
	separator.addEventListener("keydown", (event) => {
		const step = event.shiftKey ? 48 : 16;
		if (event.key === "ArrowLeft") apply(width + step);
		else if (event.key === "ArrowRight") apply(width - step);
		else if (event.key === "Home") apply(sessionSidebarWidthMin);
		else if (event.key === "End") apply(sessionSidebarWidthMax);
		else return;
		event.preventDefault();
		commit();
	});
	addEventListener("keydown", (event) => {
		if (!isSessionSidebarToggleShortcut(event)) return;
		event.preventDefault();
		sidebar.toggle?.();
	});
	new MutationObserver(() => apply(width)).observe(sidebar, {
		attributeFilter: ["aria-hidden"],
	});
	addEventListener("resize", () => apply(width), { passive: true });
}

function isMac() {
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function readStoredWidth() {
	const stored = Number(localStorage.getItem(storageKey));
	return Number.isFinite(stored) && stored > 0 ? stored : sessionSidebarWidthDefault;
}
