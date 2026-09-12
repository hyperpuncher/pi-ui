import type { AvailableUpdate } from "../update-check.ts";
import { Icon } from "./icon.tsx";
import { ArrowUp, Check, Copy } from "./icons.ts";
import { ShortcutTooltip } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

export function renderUpdateBadge(update: AvailableUpdate): string {
	return syncHtml(
		<button
			id="update-badge"
			type="button"
			class="btn prompt-context-button update-badge"
			data-variant="ghost"
			data-size="sm"
			popovertarget="update-popover"
			aria-haspopup="true"
			aria-label={`Update pi-ui to ${update.latestVersion}`}
			data-tooltip="Update available"
			data-tooltip-delay
		>
			<Icon icon={ArrowUp} class="update-badge-icon" />
			<span class="prompt-context-label">Update</span>
			<ShortcutTooltip label="Update available" />
		</button>,
	);
}

export function renderUpdatePopover(update: AvailableUpdate): string {
	return syncHtml(
		<div
			id="update-popover"
			popover="auto"
			data-popover
			data-side="top"
			data-align="start"
			class="update-popover"
			role="dialog"
			aria-label="Update available"
		>
			<div class="update-popover-heading">
				<strong class="update-popover-title">Update available</strong>
				<span class="update-popover-versions">
					<span>{update.currentVersion}</span>
					<span aria-hidden="true">→</span>
					<strong>{update.latestVersion}</strong>
				</span>
			</div>
			<div
				class="update-command"
				data-code-block
				data-code-source={update.upgradeCommand}
			>
				<code>{update.upgradeCommand}</code>
				<button
					class="btn code-copy-button"
					data-variant="ghost"
					data-size="icon-xs"
					type="button"
					data-copy-code
					aria-label="Copy upgrade command"
				>
					<Icon icon={Copy} class="code-copy-icon code-copy-icon-idle" />
					<Icon icon={Check} class="code-copy-icon code-copy-icon-done" />
				</button>
			</div>
			<a
				class="update-release-link"
				href={update.releaseUrl}
				target="_blank"
				rel="noreferrer noopener"
			>
				Release notes
			</a>
		</div>,
	);
}
