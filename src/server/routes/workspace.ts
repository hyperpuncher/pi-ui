import { pickNativeDirectoryPath } from "../../native-file-picker.ts";
import { renderWorkspaceSearchResults } from "../../ui/pickers.tsx";
import { formatHomePath } from "../../utils/workspace.ts";
import { readActionSignals, requiredString, stringField } from "../action-input.ts";
import { datastarResponse, signalsResponse } from "../datastar.ts";
import { RouteError, type ExactRouter } from "../router.ts";
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

function filterWorkspaces(workspaces: readonly string[], query: string): string[] {
	const normalizedQuery = query.toLowerCase();
	if (!normalizedQuery) return [...workspaces];
	return workspaces.filter((workspacePath) =>
		`${formatHomePath(workspacePath)} ${workspacePath}`
			.toLowerCase()
			.includes(normalizedQuery),
	);
}
