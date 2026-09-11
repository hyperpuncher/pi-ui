import Type, { type Static, type StaticParse, type TSchema } from "typebox";
import { Parse } from "typebox/value";

import { responseErrorMessage } from "../utils/errors.ts";

const workspaceFileSchema = Type.Object({
	path: Type.String(),
	contents: Type.String(),
	revision: Type.String(),
	size: Type.Number(),
});
const workspaceFileViewSchema = Type.Union([
	workspaceFileSchema,
	Type.Object({
		message: Type.String(),
		path: Type.String(),
		size: Type.Number(),
	}),
]);
const workspaceFilesSchema = Type.Object({
	paths: Type.Array(Type.String()),
	workspacePath: Type.String(),
});
const workspaceEntrySchema = Type.Object({ path: Type.String() });

export type WorkspaceFileData = Static<typeof workspaceFileSchema>;
type WorkspaceFilesData = Static<typeof workspaceFilesSchema>;

export function createWorkspaceFilesApi(endpoint: string) {
	const contentEndpoint = `${endpoint}/content`;
	const entryEndpoint = `${endpoint}/entry`;
	return {
		async create(path: string, kind: "file" | "folder"): Promise<string> {
			return (
				await requestJson(entryEndpoint, workspaceEntrySchema, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ kind, path }),
				})
			).path;
		},
		async list(): Promise<WorkspaceFilesData> {
			return await requestJson(endpoint, workspaceFilesSchema);
		},
		async move(path: string, destination: string): Promise<string> {
			return (
				await requestJson(entryEndpoint, workspaceEntrySchema, {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ destination, path }),
				})
			).path;
		},
		async read(path: string): Promise<Static<typeof workspaceFileViewSchema>> {
			return await requestJson(
				`${contentEndpoint}?path=${encodeURIComponent(path)}`,
				workspaceFileViewSchema,
			);
		},
		async remove(path: string): Promise<void> {
			await requestJson(entryEndpoint, workspaceEntrySchema, {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path }),
			});
		},
		async save(
			path: string,
			contents: string,
			revision: string,
		): Promise<WorkspaceFileData> {
			return await requestJson(contentEndpoint, workspaceFileSchema, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ contents, path, revision }),
			});
		},
	};
}

async function requestJson<Schema extends TSchema>(
	url: string,
	schema: Schema,
	init?: RequestInit,
): Promise<StaticParse<Schema>> {
	const response = await fetch(url, {
		...init,
		headers: { accept: "application/json", ...init?.headers },
	});
	if (!response.ok) {
		throw new Error(
			await responseErrorMessage(response, `Request failed (${response.status})`),
		);
	}
	return Parse(schema, await response.json());
}
