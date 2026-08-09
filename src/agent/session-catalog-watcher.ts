import { join } from "@std/path";

const sessionExtension = ".jsonl";

export type SessionCatalogWatch = (
	agentDir: string,
	onChange: (path: string) => void,
) => () => void;

export const watchSessionCatalog: SessionCatalogWatch = (agentDir, onChange) => {
	let watcher: Deno.FsWatcher;
	try {
		watcher = Deno.watchFs(join(agentDir, "sessions"), { recursive: true });
	} catch {
		return () => {};
	}

	void (async () => {
		try {
			for await (const event of watcher) {
				for (const path of event.paths) {
					if (path.endsWith(sessionExtension)) onChange(path);
				}
			}
		} catch (error) {
			if (!(error instanceof Deno.errors.BadResource)) {
				console.warn("Session catalogue watcher stopped", error);
			}
		}
	})();

	return () => watcher.close();
};
