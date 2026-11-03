import { expect, test } from "bun:test";

import { createWorkspaceFilesApi } from "#src/client/workspace-files-api.ts";

test("workspace reads accept preview data but reject converted field types", async () => {
	const file = {
		path: "notes.md",
		contents: "# notes",
		revision: "r1",
		size: 7,
		preview: {
			kind: "markdown" as const,
			html: "<h1>notes</h1>",
			mimeType: "text/markdown",
		},
		extra: true,
	};
	let size: number | string = file.size;
	const server = Bun.serve({ port: 0, fetch: () => Response.json({ ...file, size }) });
	try {
		const api = createWorkspaceFilesApi(`${server.url}files`);
		expect(await api.read(file.path)).toEqual(file);
		size = "7";
		await expect(api.read(file.path)).rejects.toThrow("Invalid workspace response.");
	} finally {
		await server.stop(true);
	}
});
