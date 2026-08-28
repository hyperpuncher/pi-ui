import os from "node:os";

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
