import type { AppSessionSummary } from "../state/app-store.ts";
import { formatHomePath } from "../utils/workspace.ts";

export function SessionSubtitle(props: {
	session: AppSessionSummary;
	class: string;
}): string {
	const workspace = formatHomePath(props.session.cwd);
	return (
		<span class={props.class}>
			<span class="font-mono" safe>
				{workspace}
			</span>
			<span
				class="bg-border mx-2 inline-block size-1 rounded-full align-[0.125em]"
				aria-hidden="true"
			></span>
			<span class="font-mono" safe>
				{props.session.subtitle}
			</span>
		</span>
	) as string;
}
