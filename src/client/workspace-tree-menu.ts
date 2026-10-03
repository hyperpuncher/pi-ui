import type { ContextMenuOpenContext } from "@pierre/trees";

export function workspaceMenuButton(
	context: ContextMenuOpenContext,
	label: string,
	action: () => void | Promise<void>,
	destructive = false,
): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = `workspace-tree-context-menu-item${
		destructive ? " workspace-tree-context-menu-item-destructive" : ""
	}`;
	button.setAttribute("role", "menuitem");
	button.textContent = label;
	button.addEventListener("click", () => {
		context.close({ restoreFocus: false });
		void action();
	});
	return button;
}
