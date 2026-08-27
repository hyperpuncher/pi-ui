import {
	newSessionAction,
	openSessionDialogAction,
	toggleWorkspaceReviewAction,
} from "../commands/actions.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { primaryModifierExpression } from "../utils/keyboard.ts";
import { Icon } from "./icon.tsx";
import {
	Command,
	Ellipsis,
	FileDiff,
	type IconData,
	MessageCircleDashed,
	MessageCirclePlus,
	Paperclip,
	RotateCcw,
} from "./icons.ts";
import { ShortcutTooltip } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

type PromptToolbarAction =
	| "commands"
	| "review"
	| "new-chat"
	| "new-temporary-chat"
	| "files"
	| "sessions";

type PromptToolbarItem = {
	action: PromptToolbarAction;
	icon: IconData;
	label: string;
	menuLabel?: string;
	shortcut?: string;
	tooltipAlign?: "start" | "center" | "end";
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
		action: "files",
		icon: Paperclip,
		label: "Files",
		menuLabel: "Attach files",
		shortcut: "@",
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
	{
		action: "review",
		icon: FileDiff,
		label: "Review workspace",
		shortcut: "ctrl G",
	},
];

export function renderPromptToolbar(
	state: AppStateSnapshot,
	reviewAvailable = false,
): string {
	return syncHtml(
		<div
			id="prompt-toolbar"
			class="shrink-0 group-data-[measuring]/prompt-footer:flex-none"
			aria-label="Message tools"
		>
			<div class="flex items-center gap-0.5 group-data-[toolbar-compact]/prompt-footer:hidden">
				{promptToolbarItems.map((item) => {
					const temporary = item.action === "new-temporary-chat";
					return (
						<PromptToolbarButton
							label={item.label}
							action={item.action}
							shortcut={item.shortcut}
							tooltipAlign={item.tooltipAlign}
							variant={
								temporary && state.isTemporarySession
									? "secondary"
									: "ghost"
							}
							pressed={temporary && state.isTemporarySession}
							unavailable={item.action === "review" && !reviewAvailable}
						>
							<Icon icon={item.icon} />
						</PromptToolbarButton>
					);
				})}
			</div>
			<div
				class="dropdown-menu hidden group-data-[toolbar-compact]/prompt-footer:block"
				data-preserve-attr="data-dropdown-menu-initialized data-basecoat-component"
			>
				<button
					type="button"
					class="btn leading-none"
					data-variant="ghost"
					data-size="icon-sm"
					aria-label="Message tools"
					aria-haspopup="menu"
					aria-expanded="false"
					aria-controls="prompt-toolbar-menu"
					data-preserve-attr="aria-expanded aria-activedescendant"
				>
					<Icon icon={Ellipsis} />
				</button>
				<div
					data-popover
					data-side="top"
					data-align="start"
					aria-hidden="true"
					data-preserve-attr="aria-hidden"
					class="w-max max-w-[calc(100vw-2rem)]"
				>
					<div id="prompt-toolbar-menu" role="menu" aria-label="Message tools">
						{promptToolbarItems
							.filter((item) => item.action !== "review" || reviewAvailable)
							.map((item) => {
								return (
									<MobilePromptToolbarItem
										label={item.menuLabel ?? item.label}
										action={item.action}
										active={
											item.action === "new-temporary-chat" &&
											state.isTemporarySession
										}
									>
										<Icon icon={item.icon} />
									</MobilePromptToolbarItem>
								);
							})}
					</div>
				</div>
			</div>
		</div>,
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
			class="btn leading-none"
			data-variant={props.variant ?? "ghost"}
			data-pi-ui-action={props.action}
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

function MobilePromptToolbarItem(props: {
	label: string;
	action: PromptToolbarAction;
	active?: boolean;
	children: JSX.Element;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			aria-current={props.active ? "true" : undefined}
			data-indicator:_new-session-pending={isSessionChangingAction(props.action)}
			data-attr:disabled={
				isSessionChangingAction(props.action)
					? "$_newSessionPending || $_sessionTransitionLoading"
					: undefined
			}
			data-on:click={promptToolbarClickAction(props.action)}
		>
			{props.children}
			<span class="min-w-0 truncate text-left">{props.label}</span>
			{props.active && <span class="ml-auto text-muted-foreground">•</span>}
		</button>
	);
}

function isSessionChangingAction(action: PromptToolbarAction): boolean {
	return action === "new-chat" || action === "new-temporary-chat";
}

function promptToolbarClickAction(action: PromptToolbarAction): string | undefined {
	if (action === "commands") return openCommandPaletteAction();
	if (action === "review") return toggleWorkspaceReviewAction();
	if (action === "new-chat") return newChatAction();
	if (action === "new-temporary-chat") return newTemporaryChatAction();
	if (action === "sessions") return openSessionDialogAction();
	if (action === "files") return "window.piUi.fileTransfer.pick()";
	return undefined;
}

function promptToolbarKeydownAction(action: PromptToolbarAction): string | undefined {
	const primaryModifier = primaryModifierExpression();
	if (action === "commands") {
		return `if (${primaryModifier} && evt.code === 'KeyK') {
			evt.preventDefault();
			${toggleCommandPaletteAction()}
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
			${newChatAction()}
		}`;
	}
	if (action === "new-temporary-chat") {
		return `if (${primaryModifier} && evt.altKey && evt.code === 'KeyO') {
			evt.preventDefault();
			${newTemporaryChatAction()}
		}`;
	}
	if (action === "sessions") {
		return `if (${primaryModifier} && evt.code === 'KeyR') {
			evt.preventDefault();
			${openSessionDialogAction()}
		}`;
	}
	return undefined;
}

function openCommandPaletteAction(): string {
	return "window.piUi.dialogs.openCommand()";
}

function toggleCommandPaletteAction(): string {
	return "window.piUi.dialogs.toggleCommand()";
}

function newChatAction(): string {
	return newSessionAction();
}

function newTemporaryChatAction(): string {
	return newSessionAction(true);
}
