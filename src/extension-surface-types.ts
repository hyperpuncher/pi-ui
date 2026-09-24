import type { JsonObject, JsonValue } from "./utils/json-types.ts";

/**
 * Pi UI Bridge ("PIUI") wire vocabulary emitted by bridge-aware extensions in RPC mode
 * through `ctx.ui.notify("PIUI " + json)` (see `~/.pi/agent/extensions/lib/bridge.ts`).
 */
export const piUiMarker = "PIUI ";

export const piUiPlacements = ["status", "pinned", "inline", "sheet", "screen"] as const;
export type PiUiPlacement = (typeof piUiPlacements)[number];

export const piUiKinds = [
	"status",
	"widget",
	"panel",
	"progress",
	"roster",
	"log",
	"markdown",
	"diff",
	"form",
	"composer",
] as const;
export type PiUiKind = (typeof piUiKinds)[number];

export type PiUiTone = "default" | "accent" | "success" | "warning" | "error";

export type PiUiAction = {
	id: string;
	label: string;
	variant?: "primary" | "secondary" | "danger";
	confirm?: string;
};

/**
 * A decoded element. Known envelope fields are typed; every other field the extension sent
 * (`text`, `lines`, `rows`, `sections`, `fields`, `value`, `payload`, …) is kept in `data`
 * so renderers can read kind-specific content without the decoder dropping it.
 */
export type PiUiElement = {
	id: string;
	ns: string;
	kind: PiUiKind;
	placement: PiUiPlacement;
	title?: string;
	actions?: readonly PiUiAction[];
	durable?: boolean;
	data: JsonObject;
	/** Monotonic per-element revision, bumped on every set/patch/append. */
	revision: number;
	/**
	 * Monotonic counter bumped only by a genuine `set`/`upsert` (the extension deliberately
	 * (re)showing this element), never by `patch`/`append` (an incremental content update to an
	 * already-open sheet). Sheet open/dismissal tracking keys on this instead of `revision` — see
	 * `piUiDismissedStorageKey` and `AppStore.setExtensionElements` — so a streaming sheet's
	 * `patch`/`append` frames don't reopen it after the user dismisses it (round-2 audit M4b),
	 * while an explicit re-`set` of an already-known id does reopen it (M4a).
	 */
	openGeneration: number;
	updatedAt: number;
};

/** Latest payload published on an extension event-bus / PIUI channel. */
export type ExtensionChannelSnapshot = {
	channel: string;
	payload: JsonValue;
	updatedAt: number;
};

/** A user action on a rendered element, routed back to the extension's `pi_ui_event` command. */
export type PiUiActionRequest = {
	elementId: string;
	actionId: string;
	value?: JsonValue;
};

/**
 * A DOM-safe slug for an element's `ns`/`id`. Shared between `AppStore` (which
 * must name the exact dialog id to open when a `sheet`/`screen` element first
 * appears) and the renderer that gives a `<dialog>` that same id — keeping a
 * single source of truth prevents the two from drifting apart.
 *
 * Substituting disallowed characters can collide two different inputs onto
 * the same slug (`"a.b"` and `"a_b"` both become `"a_b"`). Whenever the
 * substitution actually changed the value, a short deterministic hash of the
 * original is appended so the two remain distinct; a value that was already
 * a clean slug (the common case) passes through unchanged.
 */
export function piUiSlug(value: string): string {
	const slug = value.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
	return slug === value ? slug : `${slug}-${shortHash(value)}`;
}

/**
 * A short, deterministic, non-cryptographic (FNV-1a) hash, used only to
 * disambiguate slugs — never as an identifier or security boundary.
 */
function shortHash(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

/** Whether an element renders as a native `<dialog>` sheet rather than inline. */
export function isPiUiSheetElement(element: Pick<PiUiElement, "placement">): boolean {
	return element.placement === "sheet" || element.placement === "screen";
}

/** The `<dialog>` element id a `sheet`/`screen`-placement element renders under. */
export function piUiDialogId(element: Pick<PiUiElement, "id" | "ns">): string {
	return `piui-sheet-${piUiSlug(element.ns)}-${piUiSlug(element.id)}`;
}

/**
 * `localStorage` key a browser tab uses to remember that it dismissed a `sheet`/`screen`
 * element (Esc, backdrop, Close) — shared between the sheet's `close` handler (which writes
 * the element's current `openGeneration`) and the initial-connect script that decides whether
 * to auto-`showModal()` it (which skips the sheet when the stored generation still matches,
 * i.e. the extension hasn't deliberately re-shown it since). A `durable` sheet that the
 * extension never removes would otherwise reopen on every reload/reconnect even after the user
 * closed it (round-2 audit A#16); keying on `openGeneration` rather than `revision` also keeps
 * a streaming sheet's incremental `patch`/`append` updates from reopening it (M4b). Single
 * source of truth so the two call sites can't drift apart.
 */
export function piUiDismissedStorageKey(element: Pick<PiUiElement, "id" | "ns">): string {
	return `piui-dismissed-${piUiDialogId(element)}`;
}
