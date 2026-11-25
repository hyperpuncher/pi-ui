import type { TranscriptMessage } from "#src/state/transcript-state.ts";

export type AppActivitySummary = {
	duration?: string;
	stepCount: number;
	thoughtCount: number;
	expanded: boolean;
};

/** Domain message combined with renderer-owned presentation metadata. */
export type AppMessage = TranscriptMessage & {
	activitySummary?: AppActivitySummary;
	/** Running tool step index for live minimal-mode progress. */
	activityStep?: number;
	/** True when this thought is actively streaming. */
	streaming?: boolean;
	/** Elapsed duration for a completed thought when measurable. */
	thoughtDuration?: string;
	/** True when this thought or tool is shown via an expanded minimal-mode turn. */
	minimalExpanded?: boolean;
	/** True when an individual tool is expanded while compact tool mode is active. */
	toolExpanded?: boolean;
	/** Synthetic IDs (`${message.id}-${call.id}`) of expanded nested tool calls. */
	expandedNestedCallIds?: readonly string[];
	/** Compact summary badge text for collapsed tools (e.g. "+12 -3 · 2 calls"). */
	compactMeta?: string;
	renderedHtml?: string;
	pageUrl?: string;
};
