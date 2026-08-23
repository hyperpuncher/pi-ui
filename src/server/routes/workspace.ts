import { pickNativeDirectoryPath } from "../../native-file-picker.ts";
import { renderWorkspaceSearchResults } from "../../ui/pickers.tsx";
import { isRecord, isString } from "../../utils/type-guards.ts";
import { formatHomePath } from "../../utils/workspace.ts";
import { readActionSignals, requiredString, stringField } from "../action-input.ts";
import { datastarResponse, signalsResponse } from "../datastar.ts";
import { RouteError, type ExactRouter } from "../router.ts";
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
import { searchWorkspaces } from "../workspace-search.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerWorkspaceRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.workspacePick, (_request, context) =>
		pickWorkspace(context),
	);

	router.register("GET", endpoints.workspaceSearch, async (request, context) => {
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
	});

	router.register("GET", endpoints.workspaceFiles, async (_request, context) => {
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
	});

	router.register("POST", endpoints.workspaceFileEntry, async (request, context) => {
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
	});

	router.register("PATCH", endpoints.workspaceFileEntry, async (request, context) => {
		const value: unknown = await request.json();
		if (!isRecord(value) || !isString(value.path) || !isString(value.destination))
			throw new RouteError(400, "Invalid workspace entry move.");
		const { destination, path } = value;
		return workspaceFileResponse(() =>
			moveWorkspaceEntry(context.store.workspacePath, path, destination),
		);
	});

	router.register("DELETE", endpoints.workspaceFileEntry, async (request, context) => {
		const value: unknown = await request.json();
		if (!isRecord(value) || !isString(value.path)) {
			throw new RouteError(400, "Invalid workspace entry deletion.");
		}
		const { path } = value;
		return workspaceFileResponse(async () => {
			await removeWorkspaceEntry(context.store.workspacePath, path);
			return { path };
		});
	});

	router.register("GET", endpoints.workspaceFileContent, async (request, context) => {
		const filePath = new URL(request.url).searchParams.get("path") ?? "";
		return workspaceFileResponse(() =>
			readWorkspaceFile(context.store.workspacePath, filePath),
		);
	});

	router.register("PUT", endpoints.workspaceFileContent, async (request, context) => {
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
	});

	router.register("POST", endpoints.workspaceOpen, async (request, context) => {
		const path = requiredString(await readActionSignals(request), "workspacePath");
		if (!(await context.openWorkspace(path))) {
			throw new RouteError(422, "Workspace transition failed.");
		}
		return datastarResponse();
	});
}

export async function pickWorkspace(
	context: Pick<RouteContext, "openWorkspace">,
	pickDirectory: () => Promise<string | undefined> = pickNativeDirectoryPath,
): Promise<Response> {
	try {
		const path = await pickDirectory();
		if (!path) return datastarResponse();
		if (!(await context.openWorkspace(path))) {
			return signalsResponse({
				_workspacePickerError: "Workspace transition failed.",
			});
		}
		return datastarResponse([
			{ type: "signals", signals: { _workspacePickerError: "" } },
			{ type: "effect", effect: { type: "close-workspace-picker" } },
		]);
	} catch (error) {
		console.error("Native workspace picker failed", error);
		return signalsResponse({
			_workspacePickerError: "Could not open the native folder picker.",
		});
	}
}

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
