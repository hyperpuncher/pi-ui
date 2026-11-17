import { watch } from "node:fs";
import { join } from "node:path";

export type SessionCatalogWatch = (
	sessionDir: string,
	onChange: (path: string) => void,
) => () => void;

export const watchSessionCatalog: SessionCatalogWatch = (sessionDir, onChange) => {
	try {
		const watcher = watch(sessionDir, { recursive: true }, (_event, fileName) => {
			if (fileName) onChange(join(sessionDir, fileName.toString()));
		});
		watcher.on("error", (error) => {
			console.warn("Session catalogue watcher stopped", error);
		});
		return () => watcher.close();
	} catch {
		return () => {};
	}
};
