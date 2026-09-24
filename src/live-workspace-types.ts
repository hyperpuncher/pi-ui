import { isBoolean, isNumber, isRecord, type JsonRecord } from "./utils/type-guards.ts";

/** Internal tabs of the Live Workspace pane, all pre-rendered and toggled via `data-show`. */
export const liveWorkspaceTabs = [
	"now",
	"agents",
	"usage",
	"activity",
	"extensions",
] as const;
export type LiveWorkspaceTab = (typeof liveWorkspaceTabs)[number];

export const liveWorkspaceRatioDefault = 0.32;
export const liveWorkspaceRatioMin = 0.22;
export const liveWorkspaceRatioMax = 0.5;
export const liveWorkspaceTabDefault: LiveWorkspaceTab = "now";

/** Bounded ring-buffer length for the Activity tab (see AGENTS.md: cap untrusted state). */
export const liveWorkspaceActivityLimit = 200;
/** Longest single activity line kept verbatim; longer text is truncated with an ellipsis. */
export const liveWorkspaceActivityTextLimit = 400;
/** Longest preview kept for a streaming tool's partial output. */
export const liveWorkspaceToolPreviewLimit = 240;
/** Upper bound on how many rows a single extension channel payload can contribute. */
export const liveWorkspaceChannelRowLimit = 50;
/** Upper bound on how many distinct extension channels are kept (oldest-published evicted). */
export const liveWorkspaceChannelLimit = 64;
/** Upper bound on the JSON text kept for an unrecognized channel payload's fallback view. */
export const liveWorkspaceChannelJsonLimit = 4000;

export type LiveWorkspacePreferences = Readonly<{
	open?: boolean;
	ratio?: number;
	tab?: LiveWorkspaceTab;
	/** Opt-in: request a browser Notification on turn completion / waiting-for-input while the
	 * page is hidden. Off by default — never enabled without the person asking. */
	notifications?: boolean;
}>;

/** Keeps only valid, clamped preference values so a partial update can merge. */
export function normalizeLiveWorkspacePreferences<Value>(
	value: Value,
): LiveWorkspacePreferences {
	if (!isRecord(value)) return {};
	return {
		open: isBoolean(value.open) ? value.open : undefined,
		ratio: normalizedRatio(value.ratio),
		tab: isLiveWorkspaceTab(value.tab) ? value.tab : undefined,
		notifications: isBoolean(value.notifications) ? value.notifications : undefined,
	};
}

function normalizedRatio(value: JsonRecord[string]): number | undefined {
	return isNumber(value)
		? Math.min(Math.max(value, liveWorkspaceRatioMin), liveWorkspaceRatioMax)
		: undefined;
}

function isLiveWorkspaceTab(value: unknown): value is LiveWorkspaceTab {
	// SAFETY: `includes` only ever compares `value` against the known tab strings; the
	// cast just widens the readonly tuple's element type so an arbitrary `value` type-checks.
	return (liveWorkspaceTabs as readonly unknown[]).includes(value);
}

export type LiveWorkspaceTurnPhase =
	| "running"
	| "retrying"
	| "compacting"
	| "waiting-for-extension";

/** Derived turn state for the "Now" tab, built from raw session events (not the flattened activity string). */
export type LiveWorkspaceTurnState = Readonly<{
	phase: LiveWorkspaceTurnPhase;
	detail?: string;
	retryAttempt?: number;
	retryMaxAttempts?: number;
	retryAt?: number;
	compactionReason?: "manual" | "threshold" | "overflow";
	waitingKind?: string;
	waitingTitle?: string;
}>;

export type LiveWorkspaceActiveTool = Readonly<{
	toolCallId: string;
	toolName: string;
	summary?: string;
	startedAt: number;
	preview?: string;
}>;

export type LiveWorkspaceAgentKind = "background-session" | "channel-entry";

/** One roster row: a pi-ui background session, or an entry surfaced by an extension channel. */
export type LiveWorkspaceAgentRow = Readonly<{
	id: string;
	kind: LiveWorkspaceAgentKind;
	source: string;
	label: string;
	detail?: string;
	status: string;
	depth: number;
	startedAt?: number;
	tokens?: number;
	activeToolCount?: number;
}>;

export type LiveWorkspaceActivityEntry = Readonly<{
	id: string;
	at: number;
	kind: string;
	text: string;
	background: boolean;
}>;

/**
 * Pane-specific aggregate state. Extension channel payloads are deliberately NOT part of this
 * snapshot: both sources (the `pi.events` tap and PIUI `channel` ops) feed the single
 * `AppStore.extensionChannels` field, which the Extensions tab reads directly.
 */
export type LiveWorkspaceSnapshot = Readonly<{
	/** Bumped only on a real change; lets `AppStore.setLiveWorkspace` no-op on an unchanged snapshot. */
	revision: number;
	turn: LiveWorkspaceTurnState | undefined;
	activeTools: readonly LiveWorkspaceActiveTool[];
	queuedSteering: number;
	queuedFollowUp: number;
	agents: readonly LiveWorkspaceAgentRow[];
	activity: readonly LiveWorkspaceActivityEntry[];
}>;

export const emptyLiveWorkspaceSnapshot: LiveWorkspaceSnapshot = {
	revision: 0,
	turn: undefined,
	activeTools: [],
	queuedSteering: 0,
	queuedFollowUp: 0,
	agents: [],
	activity: [],
};

/** Truncates untrusted extension-derived text defensively before it reaches the DOM. */
export function truncateForDisplay(value: string, limit: number): string {
	return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/**
 * Formats a retry countdown from milliseconds remaining. Shared between the server's initial
 * render and the client ticker (`src/client/live-workspace.ts`) so the two never drift apart
 * (A#26: the countdown must keep ticking client-side instead of freezing at the SSE-render
 * instant).
 */
export function formatRetryCountdown(remainingMs: number): string {
	return remainingMs > 0 ? `in ${Math.ceil(remainingMs / 1000)}s` : "retrying now";
}
