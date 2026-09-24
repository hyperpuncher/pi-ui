import type { Component } from "@earendil-works/pi-tui";

import { errorMessage } from "../utils/errors.ts";
import { ansiLineToHtml } from "./terminal-surface/ansi-to-html.ts";
import type { TerminalSurfaceColorScheme } from "./terminal-surface/theme.ts";
import {
	maxTerminalSurfaceLineLength,
	maxTerminalSurfaceLines,
} from "./terminal-surface/types.ts";

export type CustomRenderOptions = {
	readonly width: number;
	readonly colorScheme: TerminalSurfaceColorScheme;
	readonly expanded: boolean;
};

export type CustomRenderOutcome =
	| { readonly ok: true; readonly lines: readonly string[] }
	| { readonly ok: false; readonly error: string };

/** Bounds `CustomRendererHost`'s cache so an unbounded session can't grow it forever. */
const maxCacheEntries = 400;

/**
 * Renders `pi.registerMessageRenderer`/`registerEntryRenderer` output (a
 * `pi-tui` `Component`) into safe HTML lines, through the same ANSI→HTML
 * pipeline `TerminalSurfaceController` uses for `custom()` overlays (see
 * that module's doc comment for why literal ANSI, not raw ANSI, is what a
 * `render()` call is documented to emit).
 *
 * Unlike a terminal surface, this is a one-shot, read-only snapshot: a
 * message/entry renderer hands back an already-built `Component` (no
 * `tui`/`keybindings`/`done` factory arguments the way `custom()` does), so
 * there is nothing to focus, forward keys to, or keep a live render loop
 * for — one `render(width)` call is the renderer's entire contract. The
 * real SDK's own `CustomMessageComponent`/`CustomEntryComponent` (`dist/
 * modes/interactive/components/custom-{message,entry}.js`) call it exactly
 * this way, synchronously, on every rebuild.
 *
 * A bounded, id-keyed LRU cache (oldest evicted first) keeps a long
 * transcript's repeat renders — session resume, a message revisited after
 * scrolling — cheap. Every session entry/message id is unique and immutable
 * once written, so a cache entry never needs invalidating on its own, only
 * bounding, and it's additionally keyed by the render inputs that *can*
 * change after the fact (width, color scheme, expanded state).
 */
export class CustomRendererHost {
	readonly #cache = new Map<string, CustomRenderOutcome | undefined>();

	/**
	 * Renders one `Component`, caching by `id` plus every input that affects
	 * its output. `produce()` is called at most once per distinct cache key;
	 * it must never throw across a promise boundary (it doesn't — every
	 * renderer call here is synchronous, matching the SDK's own contract).
	 */
	render(
		id: string,
		options: CustomRenderOptions,
		produce: () => Component | undefined,
	): CustomRenderOutcome | undefined {
		const key = `${id}\u0000${options.width}\u0000${options.colorScheme}\u0000${options.expanded}`;
		if (this.#cache.has(key)) {
			const cached = this.#cache.get(key);
			// Re-insert so the `Map`'s iteration order tracks recency for the LRU
			// eviction below (a `Map` re-yields an existing key in its original
			// position unless it's deleted and re-set).
			this.#cache.delete(key);
			this.#cache.set(key, cached);
			return cached;
		}
		const outcome = renderOnce(options, produce);
		this.#cache.set(key, outcome);
		if (this.#cache.size > maxCacheEntries) {
			const oldestKey = this.#cache.keys().next().value;
			if (oldestKey !== undefined) this.#cache.delete(oldestKey);
		}
		return outcome;
	}

	clear(): void {
		this.#cache.clear();
	}
}

function renderOnce(
	options: CustomRenderOptions,
	produce: () => Component | undefined,
): CustomRenderOutcome | undefined {
	let component: Component | undefined;
	try {
		component = produce();
	} catch (error) {
		return { ok: false, error: errorMessage(error) };
	}
	if (!component) return undefined;
	try {
		const rawLines = component
			.render(options.width)
			.slice(0, maxTerminalSurfaceLines);
		const lines = rawLines.map((line) => {
			const clipped =
				line.length > maxTerminalSurfaceLineLength
					? line.slice(0, maxTerminalSurfaceLineLength)
					: line;
			return ansiLineToHtml(clipped).html;
		});
		return { ok: true, lines };
	} catch (error) {
		return { ok: false, error: errorMessage(error) };
	} finally {
		try {
			// SAFETY: `Component` itself declares no `dispose()` (only
			// `DisposableComponent`, `TerminalSurfaceController`'s own local
			// widening, does) — a message/entry renderer's return type is the
			// plain SDK `Component`, but the concrete instances extensions hand
			// back (the same `pi-tui` primitives `custom()` overlays mount) may
			// still implement one; call it defensively, exactly as
			// `TerminalSurfaceController.dispose()` does for those.
			(component as Component & { dispose?(): void }).dispose?.();
		} catch {
			/* never throw into the caller over a dispose failure */
		}
	}
}
