import type { TranscriptMessage } from "#src/state/transcript-state.ts";

/** Domain message combined with renderer-owned presentation metadata. */
export type AppMessage = TranscriptMessage & {
	activitySummary?: { duration: string; stepCount: number };
	renderedHtml?: string;
	pageUrl?: string;
};
