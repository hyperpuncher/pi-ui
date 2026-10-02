import { afterEach, test } from "bun:test";

import { FileTree } from "@pierre/trees";

import {
	createWorkspaceTreeExpansion,
	syncWorkspaceTreePaths,
} from "#src/client/workspace-tree.ts";
import { assertEquals } from "#testing/assertions";

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
	};
}

const persistentTrees: FileTree[] = [];
afterEach(() => {
	for (const tree of persistentTrees) tree.cleanUp();
	persistentTrees.length = 0;
});

function persistentTree(
	storage: Pick<Storage, "getItem" | "setItem">,
	panel: "files" | "git" = "files",
	workspace = () => "/project",
) {
	const tree = new FileTree({ paths: [], fileTreeSearchMode: "hide-non-matches" });
	persistentTrees.push(tree);
	const state = createWorkspaceTreeExpansion(tree, panel, workspace, storage);
	return { tree, ...state };
}

test("expansion survives session changes, including hidden descendants", () => {
	const storage = memoryStorage();
	const paths = ["src/nested/a.ts", "src/b.ts", "docs/a.md"];
	const first = persistentTree(storage);
	first.sync(undefined, paths);
	directory(first.tree, "src/nested/").expand();
	directory(first.tree, "src/").collapse();
	directory(first.tree, "docs/").expand();
	first.save();

	const next = persistentTree(storage);
	next.sync(undefined, [...paths, "new/a.ts"]);
	assertEquals(directory(next.tree, "src/").isExpanded(), false);
	assertEquals(directory(next.tree, "src/nested/").isExpanded(), true);
	assertEquals(directory(next.tree, "docs/").isExpanded(), true);
	assertEquals(directory(next.tree, "new/").isExpanded(), false);
});

test("expansion is isolated by workspace and panel and restored when returning", () => {
	const storage = memoryStorage();
	const paths = ["src/a.ts"];
	let workspace = "/one";
	const files = persistentTree(storage, "files", () => workspace);
	files.sync(undefined, paths);
	directory(files.tree, "src/").expand();
	files.save();
	workspace = "/two";
	files.sync(undefined, paths);
	assertEquals(directory(files.tree, "src/").isExpanded(), false);
	workspace = "/one";
	files.sync(undefined, paths);
	assertEquals(directory(files.tree, "src/").isExpanded(), true);
	const git = persistentTree(storage, "git", () => workspace);
	git.sync(undefined, paths);
	assertEquals(directory(git.tree, "src/").isExpanded(), false);
});

test("search expansion is not remembered across sessions", () => {
	const storage = memoryStorage();
	const paths = ["src/nested/match.ts", "src/other.ts", "docs/a.md"];
	const first = persistentTree(storage);
	first.sync(undefined, paths);
	directory(first.tree, "docs/").expand();
	first.tree.setSearch("match");
	first.save();
	const next = persistentTree(storage);
	next.sync(undefined, paths);
	assertEquals(directory(next.tree, "src/").isExpanded(), false);
	assertEquals(directory(next.tree, "docs/").isExpanded(), true);
});

test("invalid or unavailable storage does not break tree loading", () => {
	const blocked = () => {
		throw new Error("blocked");
	};
	for (const storage of [
		{ getItem: () => "invalid json", setItem: () => {} },
		{ getItem: blocked, setItem: blocked },
	]) {
		const state = persistentTree(storage);
		state.sync(undefined, ["src/a.ts"]);
		assertEquals(directory(state.tree, "src/").isExpanded(), false);
		state.save();
	}
});

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

test("changes refresh removes implicit empty ancestors but keeps populated folders", () => {
	const paths = ["src/nested/a.ts", "src/b.ts", "scripts/check.ts", "README.md"];
	const tree = new FileTree({ paths, initialExpansion: "open" });
	try {
		const next = ["src/b.ts", "README.md"];
		syncWorkspaceTreePaths(tree, paths, next);
		assertEquals(tree.getItem("src/nested/"), null);
		assertEquals(tree.getItem("scripts/"), null);
		assertEquals(directory(tree, "src/").isExpanded(), true);
		syncWorkspaceTreePaths(tree, next, []);
		assertEquals(tree.getItem("src/"), null);
		assertEquals(tree.getItem("README.md"), null);
	} finally {
		tree.cleanUp();
	}
});

test("workspace refresh preserves explicitly listed empty folders", () => {
	const paths = ["docs/nested/a.md"];
	const tree = new FileTree({ paths });
	try {
		syncWorkspaceTreePaths(tree, paths, ["docs/nested/"]);
		assertEquals(tree.getItem("docs/nested/a.md"), null);
		assertEquals(directory(tree, "docs/nested/").getPath(), "docs/nested/");
		assertEquals(directory(tree, "docs/").getPath(), "docs/");
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
