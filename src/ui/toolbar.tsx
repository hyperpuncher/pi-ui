import {
	newSessionAction,
	toggleDialogAction,
	toggleWorkspaceReviewAction,
} from "../commands/actions.ts";
import {
	activeKeybind,
	keybindAction,
	keybindAria,
	type KeybindId,
} from "../keybinds.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { Icon, type IconName } from "./icon.tsx";
import { ShortcutTooltip } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

type ToolbarAction =
	| "commands"
	| "review"
	| "new-chat"
	| "new-temporary-chat"
	| "sessions";

const toolbarDialogTargets: Partial<Record<ToolbarAction, string>> = {
	commands: "command-dialog",
	sessions: "session-dialog",
};

type ToolbarItem = {
	action: ToolbarAction;
	name: IconName;
	label: string;
	keybind: KeybindId;
	tooltipAlign?: "start" | "center" | "end";
};

const reviewToolbarItem: ToolbarItem = {
	action: "review",
	name: "file-diff",
	label: "Review workspace",
	keybind: "toggle-review",
	tooltipAlign: "start",
};

const toolbarItems: readonly ToolbarItem[] = [
	{
		action: "commands",
		name: "command",
		label: "Commands",
		keybind: "command-palette",
		tooltipAlign: "start",
	},
	{
		action: "sessions",
		name: "rotate-ccw",
		label: "Resume session",
		keybind: "resume-session",
	},
	{
		action: "new-chat",
		name: "message-circle-plus",
		label: "New chat",
		keybind: "new-chat",
	},
	{
		action: "new-temporary-chat",
		name: "message-circle-dashed",
		label: "New temporary chat",
		keybind: "new-temporary-chat",
	},
];

export function renderToolbar(state: AppStateSnapshot, reviewAvailable = false): string {
	return syncHtml(
		<div id="toolbar" aria-label="Message tools">
			<div class="toolbar-review">
				<ToolbarItemButton
					item={reviewToolbarItem}
					state={state}
					unavailable={!reviewAvailable}
				/>
			</div>
			<div class="toolbar-actions">
				{toolbarItems.map((item) => (
					<ToolbarItemButton item={item} state={state} />
				))}
			</div>
		</div>,
	);
}

function ToolbarItemButton(props: {
	item: ToolbarItem;
	state: AppStateSnapshot;
	unavailable?: boolean;
}) {
	const temporary = props.item.action === "new-temporary-chat";
	return (
		<ToolbarButton
			label={props.item.label}
			action={props.item.action}
			keybind={props.item.keybind}
			tooltipAlign={props.item.tooltipAlign}
			variant={temporary && props.state.isTemporarySession ? "secondary" : "ghost"}
			pressed={temporary && props.state.isTemporarySession}
			unavailable={props.unavailable}
		>
			<Icon name={props.item.name} />
		</ToolbarButton>
	);
}

function ToolbarButton(props: {
	label: string;
	action: ToolbarAction;
	keybind: KeybindId;
	variant?: "primary" | "secondary" | "ghost";
	unavailable?: boolean;
	pressed?: boolean;
	tooltipAlign?: "start" | "center" | "end";
	children: JSX.Element;
}) {
	return (
		<button
			class="btn toolbar-button"
			data-variant={props.variant ?? "ghost"}
			data-pi-ui-action={props.action}
			commandfor={toolbarDialogTargets[props.action]}
			command={toolbarDialogTargets[props.action] ? "show-modal" : undefined}
			aria-pressed={props.pressed ? "true" : undefined}
			data-attr:aria-pressed={
				props.action === "review"
					? "$_workspaceReviewOpen ? 'true' : 'false'"
					: undefined
			}
			data-attr:data-variant={
				props.action === "review"
					? "$_workspaceReviewOpen ? 'secondary' : 'ghost'"
					: undefined
			}
			inert={props.unavailable}
			data-preserve-attr={
				props.action === "review" ? "aria-pressed data-variant inert" : undefined
			}
			data-size="icon-sm"
			type="button"
			data-indicator:_new-session-pending={isSessionChangingAction(props.action)}
			data-attr:disabled={
				isSessionChangingAction(props.action)
					? "$_newSessionPending || $_sessionTransitionStatus === 'loading'"
					: undefined
			}
			data-on:click={toolbarClickAction(props.action)}
			data-on:keydown__window={keybindAction(
				props.keybind,
				toolbarClickAction(props.action) ?? toggleDialogAction(),
			)}
			data-tooltip={props.label}
			data-tooltip-delay
			data-align={props.tooltipAlign}
			aria-label={props.label}
			aria-keyshortcuts={keybindAria(props.keybind)}
		>
			{props.children}
			<ShortcutTooltip
				label={props.label}
				shortcut={activeKeybind(props.keybind)}
			/>
		</button>
	);
}

function isSessionChangingAction(action: ToolbarAction): boolean {
	return action === "new-chat" || action === "new-temporary-chat";
}

function toolbarClickAction(action: ToolbarAction): string | undefined {
	if (action === "review") return toggleWorkspaceReviewAction();
	if (action === "new-chat") return newSessionAction();
	if (action === "new-temporary-chat") return newSessionAction(true);
	return undefined;
}
