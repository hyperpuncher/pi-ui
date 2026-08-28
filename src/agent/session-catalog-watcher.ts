import { watch } from "node:fs";
import { join } from "node:path";

const sessionExtension = ".jsonl";

export type SessionCatalogWatch = (
	agentDir: string,
	onChange: (path: string) => void,
) => () => void;

export const watchSessionCatalog: SessionCatalogWatch = (agentDir, onChange) => {
	const root = join(agentDir, "sessions");
	try {
		const watcher = watch(root, { recursive: true }, (_event, fileName) => {
			if (!fileName) return;
			const path = join(root, fileName.toString());
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
