const commandSelector = ".command";
const menuPopoverSelector = "[popover][role='menu']";
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
	for (const sidebar of controlsIn(root, sidebarSelector)) refreshSidebar(sidebar);
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
	return commandItems(menu).filter((item) => !item.hidden);
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
		item.hidden = !matches;
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

function menuPopoverItems(popover) {
	return [...popover.querySelectorAll('[role^="menuitem"]')].filter(
		(item) => item instanceof HTMLElement && !isDisabled(item),
	);
}

function moveInMenuPopover(popover, key) {
	const items = menuPopoverItems(popover);
	if (items.length === 0) return;
	const active = items.indexOf(document.activeElement);
	let index = active;
	if (key === "ArrowDown") index = Math.min(active + 1, items.length - 1);
	if (key === "ArrowUp")
		index = active < 0 ? items.length - 1 : Math.max(active - 1, 0);
	if (key === "Home") index = 0;
	if (key === "End") index = items.length - 1;
	items[index]?.focus({ preventScroll: true });
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

	const menuPopover = event.target.closest(menuPopoverSelector);
	if (menuPopover instanceof HTMLElement) {
		if (event.key === "Tab") menuPopover.hidePopover();
		if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
			event.preventDefault();
			moveInMenuPopover(menuPopover, event.key);
		}
		return;
	}

	if (!(event.target instanceof HTMLButtonElement)) return;
	const target = event.target.popoverTargetElement;
	if (
		target?.matches(menuPopoverSelector) &&
		["ArrowDown", "ArrowUp"].includes(event.key)
	) {
		event.preventDefault();
		event.target.click();
		const items = menuPopoverItems(target);
		const item = event.key === "ArrowUp" ? items.at(-1) : items[0];
		item?.focus({ preventScroll: true });
	}
}

function handlePointerMove(event) {
	if (!(event.target instanceof Element)) return;
	const commandItem = event.target.closest('[role="menuitem"]');
	const command = commandItem?.closest(commandSelector);
	if (
		command instanceof HTMLElement &&
		commandItem instanceof HTMLElement &&
		!commandItem.hidden
	) {
		activateCommandItem(command, commandItem);
	}
}

function handleClick(event) {
	if (!(event.target instanceof Element)) return;
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
