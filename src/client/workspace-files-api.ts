import {
	arr,
	bool,
	compile,
	lit,
	num,
	obj,
	oneOf,
	opt,
	type Schema,
	type Static,
	str,
	union,
} from "@earendil-works/pi-schema";

import { responseErrorMessage } from "#src/utils/errors.ts";

const workspaceFilePreviewSchema = union([
	obj(
		{
			kind: oneOf(["audio", "font", "html", "image", "pdf", "video"]),
			mimeType: str(),
			url: str(),
		},
		{ open: true },
	),
	obj(
		{
			html: str(),
			kind: lit("markdown"),
			mimeType: str(),
		},
		{ open: true },
	),
]);
const workspaceFileSchema = obj(
	{
		path: str(),
		contents: str(),
		preview: opt(workspaceFilePreviewSchema),
		revision: str(),
		size: num(),
	},
	{ open: true },
);
const workspaceFileViewSchema = union([
	workspaceFileSchema,
	obj(
		{
			path: str(),
			preview: workspaceFilePreviewSchema,
			revision: str(),
			size: num(),
		},
		{ open: true },
	),
	obj(
		{
			message: str(),
			path: str(),
			size: num(),
		},
		{ open: true },
	),
]);
const workspaceFilesSchema = obj(
	{
		paths: arr(str()),
		workspacePath: str(),
	},
	{ open: true },
);
const workspaceEntrySchema = obj({ path: str() }, { open: true });
const fileRevealSchema = obj({ available: bool() }, { open: true });

export type WorkspaceFileData = Static<typeof workspaceFileSchema>;
export type WorkspaceFilePreviewData = Static<typeof workspaceFilePreviewSchema>;
type WorkspaceFilesData = Static<typeof workspaceFilesSchema>;

export function createWorkspaceFilesApi(endpoint: string) {
	const contentEndpoint = `${endpoint}/content`;
	const entryEndpoint = `${endpoint}/entry`;
	return {
		async canReveal(): Promise<boolean> {
			return (await requestJson(`${endpoint}/reveal`, fileRevealSchema)).available;
		},
		async reveal(path: string): Promise<void> {
			await requestJson(`${endpoint}/reveal`, workspaceEntrySchema, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path }),
			});
		},
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

async function requestJson<S extends Schema>(
	url: string,
	schema: S,
	init?: RequestInit,
): Promise<Static<S>> {
	const response = await fetch(url, {
		...init,
		headers: { accept: "application/json", ...init?.headers },
	});
	if (!response.ok) {
		throw new Error(
			await responseErrorMessage(response, `Request failed (${response.status})`),
		);
	}
	const value: unknown = await response.json();
	const validator = compile(schema);
	if (!validator.check(value)) {
		throw new Error("Invalid workspace response.");
	}
	return value;
}
