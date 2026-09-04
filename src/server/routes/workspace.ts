import {
	renderWorkspaceBrowserContent,
	renderWorkspaceBrowserError,
	renderWorkspaceSearchResults,
} from "../../ui/pickers.tsx";
import { isRecord, isString } from "../../utils/type-guards.ts";
import { formatHomePath } from "../../utils/workspace.ts";
import {
	booleanField,
	readActionSignals,
	requiredString,
	stringField,
} from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type RouteMap } from "../route.ts";
import {
	createWorkspaceEntry,
	listWorkspaceFiles,
	moveWorkspaceEntry,
	readWorkspaceFile,
	removeWorkspaceEntry,
	WorkspaceFileError,
	writeWorkspaceFile,
} from "../workspace-files.ts";
import { findGitRoot } from "../workspace-review.ts";
import { browseWorkspaceDirectories, searchWorkspaces } from "../workspace-search.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const workspaceRoutes = {
	[endpoints.workspaceSearch]: {
		GET: async (request, context) => {
			const query = stringField(await readActionSignals(request), "workspaceDraft");
			const recent = filterWorkspaces(
				[context.store.workspacePath, ...context.store.recentWorkspaces],
				query,
			);
			const search = query.trim()
				? await searchWorkspaces(context.store.workspacePath, query)
				: [];
			return datastarResponse([
				{
					type: "elements",
					elements: renderWorkspaceSearchResults(
						recent,
						search,
						context.store.workspacePath,
					),
				},
				{ type: "effect", effect: { type: "refresh-workspace-picker" } },
			]);
		},
	},
	[endpoints.workspaceBrowse]: {
		GET: async (request, context) => {
			const signals = await readActionSignals(request);
			const value = stringField(signals, "workspacePath");
			const showHidden = booleanField(signals, "showHidden");
			const listing = await browseWorkspaceDirectories(
				context.store.workspacePath,
				value,
				showHidden,
			).catch(() => undefined);
			return datastarResponse([
				{
					type: "elements",
					elements: listing
						? renderWorkspaceBrowserContent(listing)
						: renderWorkspaceBrowserError(value),
				},
			]);
		},
	},
	[endpoints.workspaceFiles]: {
		GET: async (_request, context) => {
			const workspacePath = context.store.workspacePath;
			const includeHiddenDirectories = Boolean(await findGitRoot(workspacePath));
			return Response.json(
				{
					paths: await listWorkspaceFiles(workspacePath, {
						includeHiddenDirectories,
					}),
					workspacePath,
				},
				{ headers: { "cache-control": "no-store" } },
			);
		},
	},
	[endpoints.workspaceFileEntry]: {
		POST: async (request, context) => {
			const value: unknown = await request.json();
			if (
				!isRecord(value) ||
				!isString(value.path) ||
				(value.kind !== "file" && value.kind !== "folder")
			)
				throw new RouteError(400, "Invalid workspace entry.");
			const { kind, path } = value;
			return workspaceFileResponse(() =>
				createWorkspaceEntry(context.store.workspacePath, path, kind),
			);
		},
		PATCH: async (request, context) => {
			const value: unknown = await request.json();
			if (!isRecord(value) || !isString(value.path) || !isString(value.destination))
				throw new RouteError(400, "Invalid workspace entry move.");
			const { destination, path } = value;
			return workspaceFileResponse(() =>
				moveWorkspaceEntry(context.store.workspacePath, path, destination),
			);
		},
		DELETE: async (request, context) => {
			const value: unknown = await request.json();
			if (!isRecord(value) || !isString(value.path)) {
				throw new RouteError(400, "Invalid workspace entry deletion.");
			}
			const { path } = value;
			return workspaceFileResponse(async () => {
				await removeWorkspaceEntry(context.store.workspacePath, path);
				return { path };
			});
		},
	},
	[endpoints.workspaceFileContent]: {
		GET: async (request, context) => {
			const filePath = new URL(request.url).searchParams.get("path") ?? "";
			return workspaceFileResponse(() =>
				readWorkspaceFile(context.store.workspacePath, filePath),
			);
		},
		PUT: async (request, context) => {
			const value: unknown = await request.json();
			if (
				!isRecord(value) ||
				!isString(value.path) ||
				!isString(value.contents) ||
				!isString(value.revision)
			) {
				throw new RouteError(400, "Invalid workspace file update.");
			}
			const { path, contents, revision } = value;
			return workspaceFileResponse(() =>
				writeWorkspaceFile(context.store.workspacePath, path, contents, revision),
			);
		},
	},
	[endpoints.workspaceOpen]: {
		POST: async (request, context) => {
			const path = requiredString(
				await readActionSignals(request),
				"workspacePath",
			);
			if (!(await context.openWorkspace(path))) {
				throw new RouteError(422, "Workspace transition failed.");
			}
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;

async function workspaceFileResponse<Value>(
	operation: () => Promise<Value>,
): Promise<Response> {
	try {
		return Response.json(await operation(), {
			headers: { "cache-control": "no-store" },
		});
	} catch (error) {
		if (error instanceof WorkspaceFileError) {
			throw new RouteError(error.status, error.message);
		}
		throw error;
	}
}

function filterWorkspaces(workspaces: readonly string[], query: string): string[] {
	const normalizedQuery = query.toLowerCase();
	if (!normalizedQuery) return [...workspaces];
	return workspaces.filter((workspacePath) =>
		`${formatHomePath(workspacePath)} ${workspacePath}`
			.toLowerCase()
			.includes(normalizedQuery),
	);
}
