import {
	newSessionAction,
	toggleDialogAction,
	toggleWorkspaceReviewAction,
} from "../commands/actions.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { primaryModifierExpression } from "../utils/keyboard.ts";
import { Icon } from "./icon.tsx";
import {
	Command,
	FileDiff,
	type IconData,
	MessageCircleDashed,
	MessageCirclePlus,
	RotateCcw,
} from "./icons.ts";
import { ShortcutTooltip } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

type PromptToolbarAction =
	| "commands"
	| "review"
	| "new-chat"
	| "new-temporary-chat"
	| "sessions";

const toolbarDialogTargets: Partial<Record<PromptToolbarAction, string>> = {
	commands: "command-dialog",
	sessions: "session-dialog",
};

type PromptToolbarItem = {
	action: PromptToolbarAction;
	icon: IconData;
	label: string;
	shortcut?: string;
	tooltipAlign?: "start" | "center" | "end";
};

const reviewToolbarItem: PromptToolbarItem = {
	action: "review",
	icon: FileDiff,
	label: "Review workspace",
	shortcut: "ctrl G",
};

const promptToolbarItems: readonly PromptToolbarItem[] = [
	{
		action: "commands",
		icon: Command,
		label: "Commands",
		shortcut: "ctrl K",
		tooltipAlign: "start",
	},
	{
		action: "sessions",
		icon: RotateCcw,
		label: "Resume session",
		shortcut: "ctrl R",
	},
	{
		action: "new-chat",
		icon: MessageCirclePlus,
		label: "New chat",
		shortcut: "ctrl O",
	},
	{
		action: "new-temporary-chat",
		icon: MessageCircleDashed,
		label: "New temporary chat",
		shortcut: "ctrl alt O",
	},
];

export function renderPromptToolbar(
	state: AppStateSnapshot,
	reviewAvailable = false,
): string {
	return syncHtml(
		<div id="prompt-toolbar" class="prompt-toolbar" aria-label="Message tools">
			<div class="prompt-toolbar-review">
				<PromptToolbarItemButton
					item={reviewToolbarItem}
					state={state}
					unavailable={!reviewAvailable}
				/>
			</div>
			<div class="prompt-toolbar-actions">
				{promptToolbarItems.map((item) => (
					<PromptToolbarItemButton item={item} state={state} />
				))}
			</div>
		</div>,
	);
}

function PromptToolbarItemButton(props: {
	item: PromptToolbarItem;
	state: AppStateSnapshot;
	unavailable?: boolean;
}) {
	const temporary = props.item.action === "new-temporary-chat";
	return (
		<PromptToolbarButton
			label={props.item.label}
			action={props.item.action}
			shortcut={props.item.shortcut}
			tooltipAlign={props.item.tooltipAlign}
			variant={temporary && props.state.isTemporarySession ? "secondary" : "ghost"}
			pressed={temporary && props.state.isTemporarySession}
			unavailable={props.unavailable}
		>
			<Icon icon={props.item.icon} />
		</PromptToolbarButton>
	);
}

function PromptToolbarButton(props: {
	label: string;
	action: PromptToolbarAction;
	shortcut?: string;
	variant?: "primary" | "secondary" | "ghost";
	unavailable?: boolean;
	pressed?: boolean;
	tooltipAlign?: "start" | "center" | "end";
	children: JSX.Element;
}) {
	return (
		<button
			class="btn prompt-toolbar-button"
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
			style={props.unavailable ? "visibility: hidden" : undefined}
			data-preserve-attr={
				props.action === "review"
					? "aria-pressed data-variant inert style"
					: undefined
			}
			data-size="icon-sm"
			type="button"
			data-indicator:_new-session-pending={isSessionChangingAction(props.action)}
			data-attr:disabled={
				isSessionChangingAction(props.action)
					? "$_newSessionPending || $_sessionTransitionLoading"
					: undefined
			}
			data-on:click={promptToolbarClickAction(props.action)}
			data-on:keydown__window={promptToolbarKeydownAction(props.action)}
			data-tooltip={props.label}
			data-tooltip-delay
			data-align={props.tooltipAlign}
			aria-label={props.label}
		>
			{props.children}
			{props.shortcut && (
				<ShortcutTooltip label={props.label} shortcut={props.shortcut} />
			)}
		</button>
	);
}

function isSessionChangingAction(action: PromptToolbarAction): boolean {
	return action === "new-chat" || action === "new-temporary-chat";
}

function promptToolbarClickAction(action: PromptToolbarAction): string | undefined {
	if (action === "review") return toggleWorkspaceReviewAction();
	if (action === "new-chat") return newSessionAction();
	if (action === "new-temporary-chat") return newSessionAction(true);
	return undefined;
}

function promptToolbarKeydownAction(action: PromptToolbarAction): string | undefined {
	const primaryModifier = primaryModifierExpression();
	if (action === "commands") {
		return `if (${primaryModifier} && evt.code === 'KeyK') {
			evt.preventDefault();
			${toggleDialogAction()}
		}`;
	}
	if (action === "review") {
		return `if (${primaryModifier} && !evt.shiftKey && !evt.altKey && evt.code === 'KeyG') {
			evt.preventDefault();
			${toggleWorkspaceReviewAction()};
		}`;
	}
	if (action === "new-chat") {
		return `if (${primaryModifier} && !evt.altKey && evt.code === 'KeyO') {
			evt.preventDefault();
			${newSessionAction()}
		}`;
	}
	if (action === "new-temporary-chat") {
		return `if (${primaryModifier} && evt.altKey && evt.code === 'KeyO') {
			evt.preventDefault();
			${newSessionAction(true)}
		}`;
	}
	if (action === "sessions") {
		return `if (${primaryModifier} && evt.code === 'KeyR') {
			evt.preventDefault();
			${toggleDialogAction()}
		}`;
	}
	return undefined;
}
