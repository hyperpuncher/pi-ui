import { endpoints } from "#src/server/routes/endpoints.ts";
import type { AppSessionSummary } from "#src/state/app-store.ts";
import { syncHtml } from "#src/ui/sync-html.ts";
import { formatMessageCount } from "#src/utils/format.ts";
import {
	formatHomePath,
	managedWorktreeParts,
	workspaceDisplayName,
} from "#src/utils/workspace.ts";

export function SessionSubtitle(props: {
	session: AppSessionSummary;
	class: string | Array<string | false | undefined>;
	workspaceNameOnly?: boolean;
	showSubtitle?: boolean;
}): string {
	const managed = managedWorktreeParts(props.session.cwd);
	const workspace = managed
		? `${managed.project} · ${managed.branch}`
		: props.workspaceNameOnly
			? workspaceDisplayName(props.session.cwd)
			: formatHomePath(props.session.cwd);
	const faviconUrl = `${endpoints.sessionsFavicon}?cwd=${encodeURIComponent(props.session.cwd)}`;
	return syncHtml(
		<span class={props.class}>
			<span class="session-subtitle-content">
				<img class="session-favicon" src={faviconUrl} alt="" aria-hidden="true" />
				<span class="session-workspace" safe>
					{workspace}
				</span>
				{props.showSubtitle !== false && (
					<>
						<span class="session-subtitle-separator" aria-hidden="true" />
						<span class="session-subtitle-text" safe>
							{formatMessageCount(props.session.messageCount)}
						</span>
					</>
				)}
			</span>
		</span>,
	);
}
