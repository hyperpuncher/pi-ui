import os from "node:os";

export function defaultWorkspacePath(): string {
	return os.homedir() || Deno.cwd();
}
