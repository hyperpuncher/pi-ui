import { endpoints } from "../server/routes/endpoints.ts";
import type { AppSessionSummary } from "../state/app-store.ts";
import { formatHomePath } from "../utils/workspace.ts";

export function SessionSubtitle(props: {
	session: AppSessionSummary;
	class: string | Array<string | false | undefined>;
}): string {
	const workspace = formatHomePath(props.session.cwd);
	const faviconUrl = `${endpoints.sessionsFavicon}?cwd=${encodeURIComponent(props.session.cwd)}`;
	return (
		<span class={props.class}>
			<span class="flex min-w-0 items-center gap-1.5">
				<img
					class="size-3.5 shrink-0 rounded-[3px]"
					src={faviconUrl}
					alt=""
					aria-hidden="true"
				/>
				<span class="truncate font-mono leading-none" safe>
					{workspace}
				</span>
				<span
					class="mx-0.5 size-1 shrink-0 rounded-full bg-border"
					aria-hidden="true"
				></span>
				<span class="shrink-0 font-mono leading-none" safe>
					{props.session.subtitle}
				</span>
			</span>
		</span>
	) as string;
}
