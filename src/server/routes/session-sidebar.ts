import { normalizeSessionSidebarPreferences } from "../../session-sidebar-types.ts";
import { readActionSignals } from "../action-input.ts";
import { updateAppConfig } from "../app-config.ts";
import { datastarResponse } from "../datastar.ts";
import type { RouteMap } from "../route.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const sessionSidebarRoutes = {
	[endpoints.sessionSidebar]: {
		POST: async (request, context) => {
			const incoming = normalizeSessionSidebarPreferences(
				(await readActionSignals(request)).sessionSidebar,
			);
			const open = incoming.open ?? context.sessionSidebarOpen;
			const width = incoming.width ?? context.sessionSidebarWidth;
			await updateAppConfig((config) => {
				config.sessionSidebar = { open, width };
			});
			context.sessionSidebarOpen = open;
			context.sessionSidebarWidth = width;
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;
