import { endpoints } from "../server/routes/endpoints.ts";
import type { AppSessionSummary } from "../state/app-store.ts";
import { formatMessageCount } from "../utils/format.ts";
import { formatHomePath, workspaceDisplayName } from "../utils/workspace.ts";
import { syncHtml } from "./sync-html.ts";

export function SessionSubtitle(props: {
	session: AppSessionSummary;
	class: string | Array<string | false | undefined>;
	workspaceNameOnly?: boolean;
	showSubtitle?: boolean;
}): string {
	const workspace = props.workspaceNameOnly
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
