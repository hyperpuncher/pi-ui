import { test } from "bun:test";

import { FileTree } from "@pierre/trees";

import { assertEquals } from "#testing/assertions";

import { syncWorkspaceTreePaths } from "./workspace-tree.ts";

function directory(tree: FileTree, path: string) {
	const item = tree.getItem(path);
	if (!item || !("isExpanded" in item)) throw new Error(`Missing directory: ${path}`);
	return item;
}

test("workspace refresh preserves collapsed folders and hidden descendant expansion", () => {
	const paths = ["src/nested/a.ts", "src/b.ts", "docs/a.md", "docs/b.md"];
	const tree = new FileTree({ paths, initialExpansion: "open" });
	try {
		tree.getItem("src/nested/a.ts")?.select();
		directory(tree, "src/").collapse();
		directory(tree, "docs/").collapse();
		syncWorkspaceTreePaths(tree, paths, [...paths]);
		assertEquals(directory(tree, "src/").isExpanded(), false);
		const next = ["src/nested/a.ts", "src/new.ts", "docs/b.md", "new/file.ts"];
		syncWorkspaceTreePaths(tree, paths, next);
		assertEquals(directory(tree, "src/").isExpanded(), false);
		assertEquals(directory(tree, "docs/").isExpanded(), false);
		assertEquals(directory(tree, "src/nested/").isExpanded(), true);
		assertEquals(tree.getItem("src/b.ts"), null);
		assertEquals(tree.getItem("src/new.ts")?.getPath(), "src/new.ts");
		assertEquals(tree.getSelectedPaths(), ["src/nested/a.ts"]);
	} finally {
		tree.cleanUp();
	}
});

test("workspace refresh removes listed folders and preserves a folder when its last file is replaced", () => {
	const paths = ["src/a.ts", "docs/", "docs/nested/", "docs/nested/a.md"];
	const tree = new FileTree({ paths, initialExpansion: "open" });
	try {
		directory(tree, "src/").collapse();
		syncWorkspaceTreePaths(tree, paths, ["src/b.ts"]);
		assertEquals(directory(tree, "src/").isExpanded(), false);
		assertEquals(tree.getItem("docs/"), null);
		assertEquals(tree.getItem("src/a.ts"), null);
		assertEquals(tree.getItem("src/b.ts")?.getPath(), "src/b.ts");
	} finally {
		tree.cleanUp();
	}
});

test("file tree refresh keeps manually opened folders and resets for a new workspace", () => {
	const paths = ["src/a.ts", "src/b.ts", "docs/a.md"];
	const tree = new FileTree({ paths, initialExpansion: "closed" });
	try {
		directory(tree, "src/").expand();
		const next = [...paths, "docs/b.md"];
		syncWorkspaceTreePaths(tree, paths, next);
		assertEquals(directory(tree, "src/").isExpanded(), true);
		assertEquals(directory(tree, "docs/").isExpanded(), false);
		syncWorkspaceTreePaths(tree, undefined, next);
		assertEquals(directory(tree, "src/").isExpanded(), false);
	} finally {
		tree.cleanUp();
	}
});
