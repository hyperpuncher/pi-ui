import os from "node:os";
import { isAbsolute, relative, sep } from "node:path";

import { appDataPath } from "./app-dirs.ts";

export function defaultWorkspacePath(): string {
	return os.homedir() || process.cwd();
}

export function expandHomePath(path: string): string {
	const home = os.homedir();
	if (!home || (path !== "~" && !path.startsWith("~/") && !path.startsWith("~\\"))) {
		return path;
	}
	if (path === "~") return home;
	return `${home}${path.slice(1)}`;
}

export function formatHomePath(path: string): string {
	const home = os.homedir();
	if (!home) return path;
	if (path === home) return "~";
	if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
	if (path.startsWith(`${home}\\`)) return `~\\${path.slice(home.length + 1)}`;
	return path;
}

export function workspaceDisplayName(path: string): string {
	const display = formatHomePath(path).replaceAll("\\", "/");
	if (display === "~") return display;
	return display.split("/").filter(Boolean).at(-1) ?? display;
}

export function appWorktreeRoot(): string {
	return appDataPath("worktrees");
}

/** Git forbids `~` in ref names, so it encodes the path separator. */
export function managedWorktreeDirectoryName(branch: string): string {
	return `${branch.replaceAll("/", "~")}-${crypto.randomUUID().slice(0, 8)}`;
}

export function managedWorktreeParts(
	path: string,
): { project: string; branch: string } | undefined {
	const nested = relative(appWorktreeRoot(), path);
	if (!nested || isAbsolute(nested) || nested.startsWith(`..${sep}`)) return undefined;
	const [project, worktree] = nested.split(sep);
	if (!project || !worktree) return undefined;
	return {
		project,
		// Undoes managedWorktreeDirectoryName: drop the unique id, restore `/`.
		branch: worktree.replace(/-[0-9a-f]{8}$/i, "").replaceAll("~", "/"),
	};
}
