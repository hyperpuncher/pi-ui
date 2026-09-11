import { watch } from "node:fs";
import { join } from "node:path";

const sessionExtension = ".jsonl";

export type SessionCatalogWatch = (
	sessionDir: string,
	onChange: (path: string) => void,
) => () => void;

export const watchSessionCatalog: SessionCatalogWatch = (sessionDir, onChange) => {
	try {
		const watcher = watch(sessionDir, { recursive: true }, (_event, fileName) => {
			if (!fileName) return;
			const path = join(sessionDir, fileName.toString());
			if (path.endsWith(sessionExtension)) onChange(path);
		});
		watcher.on("error", (error) => {
			console.warn("Session catalogue watcher stopped", error);
		});
		return () => watcher.close();
	} catch {
		return () => {};
	}
};
