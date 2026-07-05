import os from "node:os";

export function defaultWorkspacePath(): string {
	return os.homedir() || Deno.cwd();
}

export function formatHomePath(path: string): string {
	const home = os.homedir();
	if (!home) return path;
	if (path === home) return "~";
	if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
	if (path.startsWith(`${home}\\`)) return `~\\${path.slice(home.length + 1)}`;
	return path;
}
