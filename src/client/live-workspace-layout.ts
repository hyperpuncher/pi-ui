/**
 * Pure, side-effect-free layout query for the Live Workspace pane, split out of
 * `live-workspace.ts` (which has import-time side effects: binding listeners and starting a
 * ticking interval) so it can be unit-tested without triggering that bootstrap (O11).
 */

/**
 * True while the pane WOULD render docked (grid-folded, not an overlay to dismiss) at the
 * current container width, whether or not it's actually open right now — used to decide whether
 * the persisted `open` preference should auto-restore on load (O10): a docked-desktop preference
 * must not pop open as a phone/tablet sheet covering the chat.
 *
 * Measures `#workspace-shell` (the element `live-workspace.css` declares as the `workspace`
 * named container) directly against that same file's `@container workspace (width >= 64rem)`
 * breakpoint, converting `rem` the same way the browser does (against the root element's font
 * size) — rather than the more obvious design of reading the breakpoint's result back off a CSS
 * custom property set inside that `@container` rule. That was tried first and found unreliable:
 * on a real Chrome build, a custom property toggled from inside this exact `@container` block
 * (on a plain descendant, not even `#workspace-shell` itself) computed to its un-overridden base
 * value on a fresh page load and only ever picked up the override after some unrelated
 * stylesheet was inserted into the document — while every non-custom-property declaration in the
 * very same `@container` block (`display`, `grid-template-columns`, …) applied correctly from
 * the start. Direct measurement sidesteps that bug entirely.
 *
 * NOTE: the `64` below must be kept in sync by hand with the `64rem` in `live-workspace.css`'s
 * `@container` condition; there's no way to read that threshold back out of the CSS.
 */
export function isDockedLayout(): boolean {
	const shell = document.getElementById("workspace-shell");
	if (!shell) return false;
	const rootFontSizePx =
		Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
	return shell.getBoundingClientRect().width >= 64 * rootFontSizePx;
}
