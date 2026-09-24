import type { Terminal } from "@earendil-works/pi-tui";

/** Default grid used when a client has not yet reported a measured cell size. */
export const defaultTerminalColumns = 100;
export const defaultTerminalRows = 30;

/** Defensive caps: an untrusted client-reported grid size must stay small. */
export const maxTerminalColumns = 500;
export const maxTerminalRows = 300;
const minTerminalColumns = 10;
const minTerminalRows = 4;

export function clampTerminalSize(size: { columns: number; rows: number }) {
	return {
		columns: Math.min(
			maxTerminalColumns,
			Math.max(
				minTerminalColumns,
				Math.trunc(size.columns) || defaultTerminalColumns,
			),
		),
		rows: Math.min(
			maxTerminalRows,
			Math.max(minTerminalRows, Math.trunc(size.rows) || defaultTerminalRows),
		),
	};
}

/**
 * A `pi-tui` `Terminal` with no real TTY behind it: `start`/`stop`/`write`
 * are no-ops that only capture (for tests/diagnostics), and `columns`/`rows`
 * come from the client-measured grid the browser reports on mount/resize
 * (see `TerminalSurfaceController.resize`) rather than a real terminal size
 * query. This is the "headless Terminal" half of the terminal surface host —
 * every `pi-tui` `TUI`/`Component` in this module is built against this
 * interface, never `node:tty`, so it runs identically under Bun with no
 * process stdin/stdout attached.
 */
export class HeadlessTerminal implements Terminal {
	#columns: number;
	#rows: number;
	#onInput: ((data: string) => void) | undefined;
	#onResize: (() => void) | undefined;
	#title = "";
	#writes: string[] = [];
	readonly kittyProtocolActive = false;

	constructor(
		size: { columns: number; rows: number } = {
			columns: defaultTerminalColumns,
			rows: defaultTerminalRows,
		},
	) {
		const clamped = clampTerminalSize(size);
		this.#columns = clamped.columns;
		this.#rows = clamped.rows;
	}

	get columns(): number {
		return this.#columns;
	}

	get rows(): number {
		return this.#rows;
	}

	get title(): string {
		return this.#title;
	}

	/** Captured `write()` calls, bounded, for tests/diagnostics only — never replayed. */
	get writes(): readonly string[] {
		return this.#writes;
	}

	start(onInput: (data: string) => void, onResize: () => void): void {
		this.#onInput = onInput;
		this.#onResize = onResize;
	}

	stop(): void {
		this.#onInput = undefined;
		this.#onResize = undefined;
	}

	async drainInput(): Promise<void> {
		// No real stdin to drain.
	}

	write(data: string): void {
		this.#writes.push(data);
		if (this.#writes.length > 64) this.#writes.shift();
	}

	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}

	setTitle(title: string): void {
		this.#title = title;
	}

	setProgress(): void {}

	/** Feeds a raw terminal byte sequence to the started listener, if any. */
	emitInput(data: string): void {
		this.#onInput?.(data);
	}

	/** Applies a client-reported resize and notifies the started listener. */
	setSize(size: { columns: number; rows: number }): void {
		const clamped = clampTerminalSize(size);
		if (clamped.columns === this.#columns && clamped.rows === this.#rows) return;
		this.#columns = clamped.columns;
		this.#rows = clamped.rows;
		this.#onResize?.();
	}
}
