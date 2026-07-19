import { newSessionAction, openSessionDialogAction } from "../commands/actions.ts";
import type { AppRenderSnapshot } from "../state/app-store.ts";
import { ShortcutTooltip } from "./keyboard.tsx";

type PromptToolbarAction =
	| "commands"
	| "review"
	| "new-chat"
	| "new-temporary-chat"
	| "files"
	| "sessions";

export function renderPromptToolbar(
	state: AppRenderSnapshot,
	reviewAvailable = false,
): string {
	return (
		<div
			id="prompt-toolbar"
			class="flex shrink-0 items-center gap-0.5"
			aria-label="Message tools"
		>
			<PromptToolbarButton label="Commands" action="commands" shortcut="ctrl K">
				<CommandIcon />
			</PromptToolbarButton>
			<PromptToolbarButton label="Files" action="files" shortcut="@">
				<PaperclipIcon />
			</PromptToolbarButton>
			<PromptToolbarButton
				label="Resume session"
				action="sessions"
				shortcut="ctrl R"
			>
				<HistoryIcon />
			</PromptToolbarButton>
			<PromptToolbarButton label="New chat" action="new-chat" shortcut="ctrl O">
				<NewChatIcon />
			</PromptToolbarButton>
			<PromptToolbarButton
				label="New temporary chat"
				action="new-temporary-chat"
				shortcut="ctrl alt O"
				variant={state.isTemporarySession ? "secondary" : "ghost"}
				pressed={state.isTemporarySession}
			>
				<TemporaryChatIcon />
			</PromptToolbarButton>
			<PromptToolbarButton
				label="Git"
				action="review"
				shortcut="ctrl D"
				variant="ghost"
				unavailable={!reviewAvailable}
			>
				<DiffIcon />
			</PromptToolbarButton>
		</div>
	) as string;
}

function PromptToolbarButton(props: {
	label: string;
	action: PromptToolbarAction;
	shortcut?: string;
	variant?: "primary" | "secondary" | "ghost";
	unavailable?: boolean;
	pressed?: boolean;
	children: JSX.Element;
}) {
	return (
		<button
			class="btn leading-none"
			data-variant={props.variant ?? "ghost"}
			data-pi-ui-action={props.action}
			aria-pressed={props.pressed ? "true" : undefined}
			inert={props.unavailable}
			style={props.unavailable ? "visibility: hidden" : undefined}
			data-preserve-attr={
				props.action === "review"
					? "aria-pressed data-variant inert style"
					: undefined
			}
			data-size="icon-sm"
			type="button"
			data-indicator:_session-loading={
				isSessionChangingAction(props.action) ? "" : undefined
			}
			data-attr:disabled={
				isSessionChangingAction(props.action)
					? "$sessionTransitionLoading"
					: undefined
			}
			data-on:click={promptToolbarClickAction(props.action)}
			data-on:keydown__window={promptToolbarKeydownAction(props.action)}
			data-tooltip={props.label}
			aria-label={props.label}
		>
			{props.children}
			{props.shortcut && (
				<ShortcutTooltip label={props.label} shortcut={props.shortcut} />
			)}
		</button>
	);
}

function Icon(props: { children: JSX.Element }) {
	return (
		<svg
			class="size-3.5"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			aria-hidden="true"
		>
			{props.children}
		</svg>
	);
}

function CommandIcon() {
	return (
		<Icon>
			<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
		</Icon>
	);
}

function DiffIcon() {
	return (
		<Icon>
			<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zm3-12h6m-3 3V7M9 17h6" />
		</Icon>
	);
}

function PaperclipIcon() {
	return (
		<Icon>
			<path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />
		</Icon>
	);
}

function HistoryIcon() {
	return (
		<Icon>
			<>
				<path d="M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8" />
				<path d="M3 3v5h5m4-1v5l4 2" />
			</>
		</Icon>
	);
}

function NewChatIcon() {
	return (
		<Icon>
			<>
				<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092a10 10 0 1 0-4.777-4.719" />
				<path d="M8 12h8m-4-4v8" />
			</>
		</Icon>
	);
}

function TemporaryChatIcon() {
	return (
		<Icon>
			<path d="M10.1 2.182a10 10 0 0 1 3.8 0m0 19.636a10 10 0 0 1-3.8 0M17.609 3.72a10 10 0 0 1 2.69 2.7M2.182 13.9a10 10 0 0 1 0-3.8m18.098 7.51a10 10 0 0 1-2.7 2.69m4.238-10.2a10 10 0 0 1 0 3.8M3.721 6.391a10 10 0 0 1 2.7-2.69m-.258 17.416-2.906.85a1 1 0 0 1-1.236-1.169l.965-2.98" />
		</Icon>
	);
}

function isSessionChangingAction(action: PromptToolbarAction): boolean {
	return action === "new-chat" || action === "new-temporary-chat";
}

function promptToolbarClickAction(action: PromptToolbarAction): string | undefined {
	if (action === "commands") return openCommandPaletteAction();
	if (action === "review") return "window.piUi.workspaceReview.toggle()";
	if (action === "new-chat") return newChatAction();
	if (action === "new-temporary-chat") return newTemporaryChatAction();
	if (action === "sessions") return openSessionDialogAction();
	if (action === "files") return "window.piUi.fileTransfer.pick()";
	return undefined;
}

function promptToolbarKeydownAction(action: PromptToolbarAction): string | undefined {
	if (action === "commands") {
		return `if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'k') {
			evt.preventDefault();
			${openCommandPaletteAction()}
		}`;
	}
	if (action === "review") {
		return `if ((evt.ctrlKey || evt.metaKey) && !evt.shiftKey && !evt.altKey && evt.key.toLowerCase() === 'd') {
			evt.preventDefault();
			window.piUi.workspaceReview.toggle();
		}`;
	}
	if (action === "new-chat") {
		return `if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && evt.key.toLowerCase() === 'o') {
			evt.preventDefault();
			${newChatAction()}
		}`;
	}
	if (action === "new-temporary-chat") {
		return `if ((evt.ctrlKey || evt.metaKey) && evt.altKey && evt.key.toLowerCase() === 'o') {
			evt.preventDefault();
			${newTemporaryChatAction()}
		}`;
	}
	if (action === "sessions") {
		return `if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'r') {
			evt.preventDefault();
			${openSessionDialogAction()}
		}`;
	}
	return undefined;
}

function openCommandPaletteAction(): string {
	return "document.getElementById('command-dialog')?.showModal(); requestAnimationFrame(() => document.getElementById('command-input')?.focus())";
}

function newChatAction(): string {
	return newSessionAction();
}

function newTemporaryChatAction(): string {
	return newSessionAction(true);
}
