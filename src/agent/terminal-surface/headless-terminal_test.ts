import { test } from "bun:test";

import type { Terminal } from "@earendil-works/pi-tui";

import { assertEquals } from "#testing/assertions";

import {
	clampTerminalSize,
	defaultTerminalColumns,
	defaultTerminalRows,
	HeadlessTerminal,
	maxTerminalColumns,
	maxTerminalRows,
} from "./headless-terminal.ts";

test("clampTerminalSize keeps a valid size unchanged", () => {
	assertEquals(clampTerminalSize({ columns: 80, rows: 24 }), { columns: 80, rows: 24 });
});

test("clampTerminalSize falls back to defaults for zero/NaN and caps oversized grids", () => {
	assertEquals(clampTerminalSize({ columns: 0, rows: 0 }), {
		columns: defaultTerminalColumns,
		rows: defaultTerminalRows,
	});
	assertEquals(clampTerminalSize({ columns: Number.NaN, rows: Number.NaN }), {
		columns: defaultTerminalColumns,
		rows: defaultTerminalRows,
	});
	assertEquals(clampTerminalSize({ columns: 10_000, rows: 10_000 }), {
		columns: maxTerminalColumns,
		rows: maxTerminalRows,
	});
	// Below the minimum floor, not just non-positive.
	assertEquals(clampTerminalSize({ columns: 1, rows: 1 }).columns >= 10, true);
});

test("HeadlessTerminal defaults to the standard grid and reports it back", () => {
	const terminal = new HeadlessTerminal();
	assertEquals(terminal.columns, defaultTerminalColumns);
	assertEquals(terminal.rows, defaultTerminalRows);
});

test("HeadlessTerminal start/stop wire input and resize callbacks without touching a real TTY", () => {
	const terminal = new HeadlessTerminal({ columns: 40, rows: 10 });
	const inputs: string[] = [];
	let resizeCount = 0;
	terminal.start(
		(data) => inputs.push(data),
		() => {
			resizeCount += 1;
		},
	);
	terminal.emitInput("hello");
	assertEquals(inputs, ["hello"]);

	terminal.setSize({ columns: 60, rows: 20 });
	assertEquals(terminal.columns, 60);
	assertEquals(terminal.rows, 20);
	assertEquals(resizeCount, 1);

	// Setting the same (clamped) size again is a no-op, not a second resize.
	terminal.setSize({ columns: 60, rows: 20 });
	assertEquals(resizeCount, 1);

	terminal.stop();
	terminal.emitInput("ignored after stop");
	assertEquals(inputs, ["hello"]);
});

test("HeadlessTerminal write()/setTitle() only capture, never touch a TTY", () => {
	const terminal = new HeadlessTerminal();
	terminal.write("\u001b[31mred\u001b[0m");
	assertEquals(terminal.writes, ["\u001b[31mred\u001b[0m"]);
	terminal.setTitle("Extension surface");
	assertEquals(terminal.title, "Extension surface");
	// No-op terminal control methods must not throw.
	const terminalControls: Terminal = terminal;
	terminalControls.moveBy(1);
	terminalControls.hideCursor();
	terminalControls.showCursor();
	terminalControls.clearLine();
	terminalControls.clearFromCursor();
	terminalControls.clearScreen();
	terminalControls.setProgress(true);
});
