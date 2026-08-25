import type { AppStateSnapshot } from "../state/app-store.ts";
import type { TranscriptMessage } from "../state/transcript-state.ts";

/** Domain message combined with renderer-owned presentation metadata. */
export type AppMessage = TranscriptMessage & {
	activitySummary?: { duration: string; stepCount: number };
	renderedHtml?: string;
	presentationState: "plain" | "streaming" | "deferred" | "enhancing" | "final";
	presentationVersion: number;
};

/** Immutable application state projected for rendering. */
export type AppRenderSnapshot = Omit<AppStateSnapshot, "messages"> &
	Readonly<{ messages: readonly AppMessage[] }>;
