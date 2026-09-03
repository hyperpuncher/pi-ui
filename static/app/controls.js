const commandSelector = ".command";
const popupSelector = ".dropdown-menu, .popover";
const sidebarSelector = ".sidebar";

export function bindControls() {
	document.addEventListener("input", handleCommandInput);
	document.addEventListener("keydown", handleKeydown);
	document.addEventListener("mousemove", handlePointerMove);
	document.addEventListener("click", handleClick);
	refreshControls();
}

export function refreshControls(root = document) {
	for (const command of controlsIn(root, commandSelector)) refreshCommand(command);
	for (const popup of controlsIn(root, popupSelector)) refreshPopup(popup);
	for (const sidebar of controlsIn(root, sidebarSelector)) refreshSidebar(sidebar);
}

export function togglePopup(triggerId) {
	const trigger = document.getElementById(triggerId);
	if (!(trigger instanceof HTMLButtonElement)) return false;
	const popup = trigger.closest(popupSelector);
	if (!(popup instanceof HTMLElement)) return false;
	const opening = trigger.getAttribute("aria-expanded") !== "true";
	if (opening) openPopup(popup, false);
	else closePopup(popup);
	return opening;
}

export function toggleSidebar(sidebar) {
	if (!(sidebar instanceof HTMLElement) || !sidebar.matches(sidebarSelector)) {
		return false;
	}
	const opening = sidebar.getAttribute("aria-hidden") === "true";
	setSidebarOpen(sidebar, opening);
	return opening;
}

function controlsIn(root, selector) {
	const controls = [];
	if (!root) return controls;
	if (root instanceof Element && root.matches(selector)) controls.push(root);
	for (const element of root.querySelectorAll?.(selector) ?? []) controls.push(element);
	return controls;
}

function commandParts(command) {
	return {
		input: command.querySelector("header input"),
		menu: command.querySelector('[role="menu"]'),
	};
}

function commandItems(menu) {
	return [...menu.querySelectorAll('[role="menuitem"]')].filter(
		(item) => item instanceof HTMLElement && !isDisabled(item),
	);
}

function visibleCommandItems(command) {
	const { menu } = commandParts(command);
	if (!(menu instanceof HTMLElement)) return [];
	return commandItems(menu).filter(
		(item) => item.getAttribute("aria-hidden") !== "true",
	);
}

function refreshSidebar(sidebar) {
	if (sidebar.hasAttribute("aria-hidden")) return;
	const breakpoint = Number.parseInt(sidebar.dataset.breakpoint || "768", 10);
	const desktopOpen = sidebar.dataset.initialOpen !== "false";
	const mobileOpen = sidebar.dataset.initialMobileOpen === "true";
	setSidebarOpen(sidebar, window.innerWidth >= breakpoint ? desktopOpen : mobileOpen);
}

function setSidebarOpen(sidebar, open) {
	sidebar.setAttribute("aria-hidden", String(!open));
	if (open) sidebar.removeAttribute("inert");
	else sidebar.setAttribute("inert", "");
}

function refreshCommand(command) {
	const { input, menu } = commandParts(command);
	if (!(input instanceof HTMLInputElement) || !(menu instanceof HTMLElement)) return;
	if (command.dataset.filter !== "manual") filterCommand(command);
	else {
		menu.scrollTop = 0;
		activateCommandItem(command, visibleCommandItems(command)[0]);
	}
}

function filterCommand(command) {
	const { input, menu } = commandParts(command);
	if (!(input instanceof HTMLInputElement) || !(menu instanceof HTMLElement)) return;
	const query = input.value.trim().toLowerCase();
	for (const item of commandItems(menu)) {
		const text = (item.dataset.filter || item.textContent || "").trim().toLowerCase();
		const keywords = (item.dataset.keywords || "").toLowerCase().split(/[\s,]+/);
		const matches =
			item.hasAttribute("data-force") ||
			text.includes(query) ||
			keywords.some((keyword) => keyword.includes(query));
		item.setAttribute("aria-hidden", String(!matches));
	}
	const first = visibleCommandItems(command)[0];
	activateCommandItem(command, first);
	if (query === "") menu.scrollTop = 0;
	else first?.scrollIntoView({ block: "nearest" });
}

function activateCommandItem(command, active) {
	const { input, menu } = commandParts(command);
	if (!(input instanceof HTMLInputElement) || !(menu instanceof HTMLElement)) return;
	for (const item of menu.querySelectorAll('[role="menuitem"].active')) {
		item.classList.remove("active");
	}
	if (active instanceof HTMLElement) {
		active.classList.add("active");
		if (active.id) input.setAttribute("aria-activedescendant", active.id);
		else input.removeAttribute("aria-activedescendant");
	} else {
		input.removeAttribute("aria-activedescendant");
	}
}

function moveCommand(command, key) {
	const items = visibleCommandItems(command);
	if (items.length === 0) return;
	const active = items.findIndex((item) => item.classList.contains("active"));
	let index = active;
	if (key === "ArrowDown") index = Math.min(active + 1, items.length - 1);
	if (key === "ArrowUp") index = Math.max(active < 0 ? 0 : active - 1, 0);
	if (key === "Home") index = 0;
	if (key === "End") index = items.length - 1;
	const item = items[index];
	activateCommandItem(command, item);
	item?.scrollIntoView({ block: "nearest" });
}

function popupParts(root) {
	const trigger = root.querySelector(":scope > button");
	const content = root.querySelector(":scope > [data-popover]");
	const menu = content?.querySelector('[role="menu"]');
	return { trigger, content, menu };
}

function refreshPopup(root) {
	const { trigger, content } = popupParts(root);
	if (!(trigger instanceof HTMLButtonElement) || !(content instanceof HTMLElement))
		return;
	const expanded = trigger.getAttribute("aria-expanded") === "true";
	trigger.setAttribute("aria-expanded", String(expanded));
	content.setAttribute("aria-hidden", String(!expanded));
}

function openPopup(root, selection = false) {
	closeAllPopups(root);
	refreshPopup(root);
	const { trigger, content, menu } = popupParts(root);
	if (!(trigger instanceof HTMLButtonElement) || !(content instanceof HTMLElement))
		return;
	trigger.setAttribute("aria-expanded", "true");
	content.setAttribute("aria-hidden", "false");
	if (root.matches(".dropdown-menu") && menu instanceof HTMLElement && selection) {
		const items = popupItems(menu);
		activatePopupItem(root, selection === "last" ? items.at(-1) : items[0]);
	}
	requestAnimationFrame(() => content.querySelector("[autofocus]")?.focus());
}

function closePopup(root, restoreFocus = true) {
	const { trigger, content } = popupParts(root);
	if (!(trigger instanceof HTMLButtonElement) || !(content instanceof HTMLElement))
		return;
	if (trigger.getAttribute("aria-expanded") !== "true") return;
	trigger.setAttribute("aria-expanded", "false");
	trigger.removeAttribute("aria-activedescendant");
	content.setAttribute("aria-hidden", "true");
	activatePopupItem(root);
	if (restoreFocus) trigger.focus({ preventScroll: true });
}

function closeAllPopups(except) {
	for (const popup of document.querySelectorAll(popupSelector)) {
		if (popup !== except) closePopup(popup, false);
	}
}

function popupItems(menu) {
	return [...menu.querySelectorAll('[role^="menuitem"]')].filter(
		(item) => item instanceof HTMLElement && !isDisabled(item),
	);
}

function activatePopupItem(root, active) {
	const { trigger, menu } = popupParts(root);
	if (!(trigger instanceof HTMLButtonElement) || !(menu instanceof HTMLElement)) return;
	for (const item of menu.querySelectorAll(".active")) item.classList.remove("active");
	if (active instanceof HTMLElement) {
		active.classList.add("active");
		if (active.id) trigger.setAttribute("aria-activedescendant", active.id);
	} else {
		trigger.removeAttribute("aria-activedescendant");
	}
}

function movePopup(root, key) {
	const { menu } = popupParts(root);
	if (!(menu instanceof HTMLElement)) return;
	const items = popupItems(menu);
	if (items.length === 0) return;
	const active = items.findIndex((item) => item.classList.contains("active"));
	let index = active;
	if (key === "ArrowDown") index = Math.min(active + 1, items.length - 1);
	if (key === "ArrowUp")
		index = active < 0 ? items.length - 1 : Math.max(active - 1, 0);
	if (key === "Home") index = 0;
	if (key === "End") index = items.length - 1;
	activatePopupItem(root, items[index]);
}

function handleCommandInput(event) {
	if (!(event.target instanceof HTMLInputElement)) return;
	const command = event.target.closest(commandSelector);
	if (command instanceof HTMLElement && command.dataset.filter !== "manual") {
		filterCommand(command);
	}
}

function handleKeydown(event) {
	if (!(event.target instanceof Element)) return;
	const command = event.target.closest(commandSelector);
	if (command instanceof HTMLElement && event.target.matches("header input")) {
		if (event.key === "Enter") {
			const active = visibleCommandItems(command).find((item) =>
				item.classList.contains("active"),
			);
			if (active) {
				event.preventDefault();
				active.click();
			}
			return;
		}
		if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
			event.preventDefault();
			moveCommand(command, event.key);
			return;
		}
	}

	const popup = event.target.closest(popupSelector);
	if (!(popup instanceof HTMLElement)) return;
	const { trigger } = popupParts(popup);
	const expanded = trigger?.getAttribute("aria-expanded") === "true";
	if (event.key === "Escape" && expanded) {
		event.preventDefault();
		closePopup(popup);
		return;
	}
	if (!popup.matches(".dropdown-menu")) return;
	if (!expanded && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
		event.preventDefault();
		openPopup(
			popup,
			event.key === "ArrowUp"
				? "last"
				: event.key === "ArrowDown"
					? "first"
					: false,
		);
		return;
	}
	if (expanded && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
		event.preventDefault();
		movePopup(popup, event.key);
		return;
	}
	if (expanded && ["Enter", " "].includes(event.key)) {
		const { menu } = popupParts(popup);
		const active = menu?.querySelector(".active");
		if (active instanceof HTMLElement) {
			event.preventDefault();
			active.click();
		}
	}
}

function handlePointerMove(event) {
	if (!(event.target instanceof Element)) return;
	const commandItem = event.target.closest('[role="menuitem"]');
	const command = commandItem?.closest(commandSelector);
	if (
		command instanceof HTMLElement &&
		commandItem instanceof HTMLElement &&
		commandItem.getAttribute("aria-hidden") !== "true"
	) {
		activateCommandItem(command, commandItem);
		return;
	}
	const popupItem = event.target.closest('[role^="menuitem"]');
	const popup = popupItem?.closest(".dropdown-menu");
	if (
		popup instanceof HTMLElement &&
		popupItem instanceof HTMLElement &&
		!isDisabled(popupItem)
	) {
		activatePopupItem(popup, popupItem);
	}
}

function handleClick(event) {
	if (!(event.target instanceof Element)) return;
	const popup = event.target.closest(popupSelector);
	if (popup instanceof HTMLElement) {
		const { trigger } = popupParts(popup);
		if (trigger?.contains(event.target)) {
			if (trigger?.getAttribute("aria-expanded") === "true") closePopup(popup);
			else openPopup(popup);
			return;
		}
		const item = event.target.closest('[role^="menuitem"]');
		if (item instanceof HTMLElement && !isDisabled(item)) closePopup(popup);
	} else {
		closeAllPopups();
	}

	const commandItem = event.target.closest('.command [role="menuitem"]');
	if (
		commandItem instanceof HTMLElement &&
		!commandItem.hasAttribute("data-keep-command-open")
	) {
		commandItem.closest("dialog")?.close();
	}
}

function isDisabled(element) {
	return (
		element.hasAttribute("disabled") ||
		element.getAttribute("aria-disabled") === "true" ||
		element.getAttribute("data-disabled") === "true"
	);
}
