import { readActionSignals, requiredString } from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerWorkspaceRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.workspaceOpen, async (request, context) => {
		const path = requiredString(await readActionSignals(request), "workspacePath");
		if (!(await context.openWorkspace(path))) {
			throw new RouteError(422, "Workspace transition failed.");
		}
		return datastarResponse();
	});
}
