import { assertEquals } from "@std/assert";

import {
	calculateChangesSplit,
	calculateGitSplit,
	calculateSidebarSplit,
	changesRatioDefault,
	gitPaneRatioDefault,
	keyboardDelta,
	reviewSidebarWidthDefault,
	workspaceGap,
	workspaceInset,
	workspaceStructuralGap,
} from "./workspace-review-layout.ts";

Deno.test("Git split subtracts its gutter before an exact default 50/50", () => {
	assertEquals(calculateGitSplit(1600), {
		chat: 797,
		git: 797,
		ratio: gitPaneRatioDefault,
	});
	assertEquals(797 * 2 + workspaceStructuralGap, 1600);
	assertEquals(workspaceStructuralGap * 2, workspaceGap);
});

Deno.test("sidebar uses and resets to the 272px default with runtime clamping", () => {
	assertEquals(calculateSidebarSplit(900), reviewSidebarWidthDefault);
	assertEquals(calculateSidebarSplit(900, 900), 480);
	assertEquals(calculateSidebarSplit(560, reviewSidebarWidthDefault), 234);
});

Deno.test("Changes and History subtract insets and gutter before splitting", () => {
	const split = calculateChangesSplit(826);
	assertEquals(split, { changes: 400, history: 400, ratio: changesRatioDefault });
	assertEquals(split.changes + split.history + workspaceGap + workspaceInset * 2, 826);
});

Deno.test("split calculations clamp persisted and runtime values", () => {
	assertEquals(calculateGitSplit(1000, 0).ratio, 0.35);
	assertEquals(calculateGitSplit(1000, 1).ratio, 0.65);
	assertEquals(calculateChangesSplit(500, 0).ratio, 0.3);
	assertEquals(calculateChangesSplit(500, 1).ratio, 0.7);
	assertEquals(calculateGitSplit(400).git, 197);
	assertEquals(calculateChangesSplit(150).changes, 62);
});

Deno.test("keyboard resizing uses normal and Shift increments", () => {
	assertEquals(keyboardDelta("ArrowLeft"), -16);
	assertEquals(keyboardDelta("ArrowDown"), 16);
	assertEquals(keyboardDelta("ArrowUp", true), -48);
	assertEquals(keyboardDelta("Enter", true), 0);
});

Deno.test("persisted values survive resize while defaults reset independently", () => {
	assertEquals(calculateGitSplit(1200, 0.6).ratio, 0.6);
	assertEquals(calculateChangesSplit(700, 0.4).ratio, 0.4);
	assertEquals(calculateSidebarSplit(1000, 350), 350);
	assertEquals(calculateGitSplit(1200, gitPaneRatioDefault).ratio, 0.5);
	assertEquals(calculateSidebarSplit(1000, reviewSidebarWidthDefault), 272);
});
